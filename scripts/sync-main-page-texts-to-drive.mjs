import fs from "node:fs";
import crypto from "node:crypto";
import { JSDOM } from "jsdom";

const endpoint = process.env.APPS_SCRIPT_SYNC_URL;
const secret = process.env.APPS_SCRIPT_SYNC_HMAC_SECRET;
const commitSha = process.env.GITHUB_SHA || "";
const ref = process.env.GITHUB_REF_NAME || "";
const commitTimestamp = process.env.GITHUB_COMMIT_TIMESTAMP || "";

function fail(message) { throw new Error(message); }
function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
function normalizeChanges(changes, label) {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 500) {
    fail(label + " must contain between 1 and 500 changes.");
  }
  const byId = new Map();
  for (const item of changes) {
    if (!item || typeof item.id !== "string" || !item.id.trim() ||
        item.id.length > 200 || typeof item.text !== "string" ||
        item.text.length > 10000 || byId.has(item.id)) {
      fail(label + " contains invalid or duplicate ID/text data.");
    }
    byId.set(item.id, item.text);
  }
  return byId;
}

if (!endpoint || !secret || !commitSha || !/^[a-f0-9]{40}$/i.test(commitSha) ||
    ref !== "main" || !Number.isFinite(Date.parse(commitTimestamp))) {
  fail("Required Apps Script sync settings are missing or the ref is not main.");
}

const html = fs.readFileSync("index.html", "utf8");
const dom = new JSDOM(html);
const expectedIds = Array.from(
  dom.window.document.querySelectorAll("[data-page-edit-id]")
).map(element => (element.getAttribute("data-page-edit-id") || "").trim());

if (!expectedIds.length || expectedIds.length > 500 ||
    expectedIds.some(id => !id) ||
    new Set(expectedIds).size !== expectedIds.length) {
  fail("index.html contains an empty, duplicate, or unsupported page edit ID.");
}

const repositoryPayload = JSON.parse(
  fs.readFileSync("page-changes-production.json", "utf8")
);
if (!repositoryPayload || repositoryPayload.success !== true ||
    !Array.isArray(repositoryPayload.changes)) {
  fail("page-changes-production.json has an invalid structure.");
}

const changesById = normalizeChanges(repositoryPayload.changes, "page-changes-production.json");
if (changesById.size !== expectedIds.length ||
    expectedIds.some(id => !changesById.has(id))) {
  fail("The repository JSON IDs do not exactly match index.html.");
}

const payload = {
  success: true,
  changes: repositoryPayload.changes,
  updatedAt: new Date(Date.parse(commitTimestamp)).toISOString()
};
const payloadRaw = JSON.stringify(payload);
const payloadHash = sha256Hex(payloadRaw);
const expectedIdsHash = sha256Hex(JSON.stringify(expectedIds));
const timestamp = String(Date.now());
const nonce = crypto.randomUUID();

const signedMessage = [
  "syncPageChangesFromGitHub",
  "refs/heads/main",
  timestamp,
  nonce,
  commitSha,
  payload.updatedAt,
  payloadHash,
  expectedIdsHash
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
  commitTimestamp: payload.updatedAt,
  payloadHash,
  expectedIds,
  expectedIdsHash,
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
try { result = JSON.parse(responseText); }
catch { fail("Apps Script returned non-JSON (HTTP " + response.status + ")."); }

if (!response.ok || !result || result.success !== true) {
  fail("GitHub-to-Drive synchronization was not confirmed: " +
    String(result && result.message || "HTTP " + response.status).slice(0, 400));
}

console.log("Drive synchronization confirmed: " +
  String(result.status || "success") + "; IDs: " + changesById.size +
  "; commit: " + commitSha + "; updatedAt: " +
  String(result.updatedAt || payload.updatedAt));
