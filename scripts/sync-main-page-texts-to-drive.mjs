import fs from "node:fs";
import crypto from "node:crypto";

const payloadPath = "page-changes-production.json";
const htmlPath = "index.html";

function fail(message) {
  throw new Error(message);
}

function normalizeIds(items, label) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 500) {
    fail(label + " must be a non-empty array of at most 500 IDs.");
  }
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id.trim() ||
        typeof item.text !== "string" || item.id.length > 200 ||
        item.text.length > 10000 || seen.has(item.id)) {
      fail(label + " contains an invalid or duplicate ID/text item.");
    }
    seen.add(item.id);
  }
  return seen;
}

const endpoint = process.env.APPS_SCRIPT_SYNC_URL;
const secret = process.env.APPS_SCRIPT_SYNC_HMAC_SECRET;
const commitSha = process.env.GITHUB_SHA;
const ref = process.env.GITHUB_REF_NAME;
const commitTimestamp = process.env.GITHUB_COMMIT_TIMESTAMP;

if (!endpoint || !secret || !commitSha || ref !== "main" || !commitTimestamp) {
  fail("Required Apps Script sync settings are missing or the ref is not main.");
}

const payloadRaw = fs.readFileSync(payloadPath, "utf8");
const payload = JSON.parse(payloadRaw);
if (!payload || payload.success !== true ||
    !Array.isArray(payload.changes) ||
    !Number.isFinite(Date.parse(payload.updatedAt || ""))) {
  fail("The main page-changes JSON payload is invalid.");
}

const html = fs.readFileSync(htmlPath, "utf8");
const htmlIds = [...html.matchAll(/data-page-edit-id\s*=\s*["']([^"']+)["']/g)]
  .map(match => match[1]);
const payloadIds = normalizeIds(payload.changes, "page-changes-production.json");

if (!htmlIds.length || new Set(htmlIds).size !== htmlIds.length ||
    htmlIds.length !== payload.changes.length ||
    htmlIds.some(id => !payloadIds.has(id))) {
  fail("The main JSON IDs do not exactly match the unique data-page-edit-id values in index.html.");
}

const timestamp = String(Date.now());
const nonce = crypto.randomUUID();
const payloadHash = crypto.createHash("sha256").update(payloadRaw, "utf8").digest("hex");
const signedMessage = [
  "syncPageChangesFromGitHub",
  "refs/heads/main",
  timestamp,
  nonce,
  commitSha,
  commitTimestamp,
  payloadHash
].join("\n");
const signature = crypto.createHmac("sha256", secret)
  .update(signedMessage, "utf8")
  .digest("base64");

const requestBody = {
  action: "syncPageChangesFromGitHub",
  ref: "refs/heads/main",
  timestamp,
  nonce,
  commitSha,
  commitTimestamp,
  payloadHash,
  payloadRaw,
  signature
};

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(requestBody),
  signal: AbortSignal.timeout(45000)
});

const responseText = await response.text();
let result;
try {
  result = JSON.parse(responseText);
} catch {
  fail("Apps Script returned a non-JSON response (HTTP " + response.status + ").");
}
if (!response.ok || !result || result.success !== true) {
  fail("GitHub-to-Drive synchronization was not confirmed: " +
    String(result && result.message || "HTTP " + response.status).slice(0, 300));
}

console.log("GitHub main page text was verified by Apps Script. " +
  "Drive status: " + String(result.status || "confirmed") +
  "; updatedAt: " + String(result.updatedAt || payload.updatedAt) + ".");
