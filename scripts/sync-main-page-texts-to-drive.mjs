import fs from "node:fs";
import crypto from "node:crypto";
import { JSDOM } from "jsdom";

const endpoint = process.env.APPS_SCRIPT_SYNC_URL;
const secret = process.env.APPS_SCRIPT_SYNC_HMAC_SECRET;
const commitSha = process.env.GITHUB_SHA;
const ref = process.env.GITHUB_REF_NAME;
const commitTimestamp = process.env.GITHUB_COMMIT_TIMESTAMP;
const changedPaths = new Set(
  String(process.env.GITHUB_CHANGED_PATHS || "")
    .split("\n")
    .map(value => value.trim())
    .filter(Boolean)
);

function fail(message) {
  throw new Error(message);
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
    byId.set(item.id, item.text.trim());
  }
  return byId;
}

if (!endpoint || !secret || !commitSha || ref !== "main" ||
    !Number.isFinite(Date.parse(commitTimestamp || ""))) {
  fail("Required Apps Script sync settings are missing or the ref is not main.");
}

const html = fs.readFileSync("index.html", "utf8");
const dom = new JSDOM(html);
const htmlChanges = Array.from(
  dom.window.document.querySelectorAll("[data-page-edit-id]")
).map(element => ({
  id: (element.getAttribute("data-page-edit-id") || "").trim(),
  text: element.textContent.trim()
}));
const htmlMap = normalizeChanges(htmlChanges, "index.html");
if (htmlMap.size !== htmlChanges.length) {
  fail("index.html contains duplicate page edit IDs.");
}

const jsonChanged = changedPaths.has("page-changes-production.json");
const htmlChanged = changedPaths.has("index.html");
const isDispatch = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";

let payload;
let payloadRaw;

if (htmlChanged && !jsonChanged && !isDispatch) {
  // A direct text edit in main/index.html is promoted to a Drive payload.
  payload = {
    success: true,
    changes: htmlChanges,
    updatedAt: new Date(Date.parse(commitTimestamp)).toISOString()
  };
  payloadRaw = JSON.stringify(payload);
} else {
  payloadRaw = fs.readFileSync("page-changes-production.json", "utf8");
  payload = JSON.parse(payloadRaw);
}

if (!payload || payload.success !== true ||
    !Array.isArray(payload.changes) ||
    !Number.isFinite(Date.parse(payload.updatedAt || ""))) {
  fail("The approved main page-text payload is invalid.");
}

const payloadMap = normalizeChanges(payload.changes, "page-changes-production.json");
if (payloadMap.size !== htmlMap.size ||
    [...htmlMap.keys()].some(id => !payloadMap.has(id))) {
  fail("The main JSON IDs do not exactly match the unique data-page-edit-id values in index.html.");
}

if (jsonChanged && htmlChanged) {
  const differs = [...htmlMap].some(([id, text]) => payloadMap.get(id) !== text);
  if (differs) {
    fail("Both main files changed, but their page text values differ. Refusing an ambiguous sync.");
  }
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

console.log("Approved main page text was verified by Apps Script. " +
  "Drive status: " + String(result.status || "confirmed") +
  "; updatedAt: " + String(result.updatedAt || payload.updatedAt) + ".");
