import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { JSDOM } from "jsdom";

const endpoint = process.env.APPS_SCRIPT_SYNC_URL;
const secret = process.env.APPS_SCRIPT_SYNC_HMAC_SECRET;
const commitSha = process.env.GITHUB_SHA || "";
const ref = process.env.GITHUB_REF_NAME || "";
const commitTimestamp = process.env.GITHUB_COMMIT_TIMESTAMP || "";
const eventName = process.env.GITHUB_EVENT_NAME || "";
const eventBefore = process.env.GITHUB_EVENT_BEFORE || "";
const changedPaths = new Set(
  String(process.env.GITHUB_CHANGED_PATHS || "")
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
);
const manualRun = eventName === "workflow_dispatch" || changedPaths.has("__manual__");
const htmlChanged = changedPaths.has("index.html");
const jsonChanged = changedPaths.has("page-changes-production.json");

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
        item.id !== item.id.trim() || item.id.length > 200 ||
        typeof item.text !== "string" || item.text.length > 10000 ||
        byId.has(item.id)) {
      fail(label + " contains invalid or duplicate ID/text data.");
    }
    byId.set(item.id, item.text);
  }
  return byId;
}
function mapsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const [id, text] of left) {
    if (!right.has(id) || right.get(id) !== text) return false;
  }
  return true;
}
function orderedChanges(expectedIds, byId) {
  return expectedIds.map(id => ({ id, text: byId.get(id) }));
}

if (!endpoint || !secret || !commitSha || !/^[a-f0-9]{40}$/i.test(commitSha) ||
    ref !== "main" || !Number.isFinite(Date.parse(commitTimestamp))) {
  fail("Required Apps Script sync settings are missing or the ref is not main.");
}
if (!manualRun && !htmlChanged && !jsonChanged) {
  fail("The push did not change either supported page-text source file.");
}

// Match the website's existing saveAllPageChanges() extraction exactly:
// each editable element is saved as element.textContent.trim().
const html = fs.readFileSync("index.html", "utf8");
function extractHtmlSnapshot(sourceHtml) {
  const sourceForParsing = sourceHtml.charCodeAt(0) === 0xFEFF
    ? sourceHtml.slice(1)
    : sourceHtml;
  const sourceDom = new JSDOM(sourceForParsing);
  const sourceElements = Array.from(
    sourceDom.window.document.querySelectorAll("[data-page-edit-id]")
  );
  const ids = sourceElements.map(element =>
    (element.getAttribute("data-page-edit-id") || "").trim()
  );
  if (!ids.length || ids.length > 500 || ids.some(id => !id) ||
      new Set(ids).size !== ids.length) {
    fail("index.html contains an empty, duplicate, or unsupported page edit ID.");
  }
  const changes = sourceElements.map((element, index) => ({
    id: ids[index],
    text: element.textContent.trim()
  }));
  return { ids, changes, byId: normalizeChanges(changes, "index.html editable text") };
}
const htmlSnapshot = extractHtmlSnapshot(html);
const expectedIds = htmlSnapshot.ids;
const htmlById = htmlSnapshot.byId;

// A CSS/layout-only edit to index.html must not roll back a newer JSON text snapshot.
// Compare editable text against the index.html at the push base, not just the changed path.
let htmlTextChanged = htmlChanged;
let previousHtmlById = null;
if (htmlChanged && eventBefore && !/^0+$/.test(eventBefore)) {
  let previousHtml;
  try {
    previousHtml = execFileSync("git", ["show", eventBefore + ":index.html"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    fail("Could not read index.html from the push base; refusing to guess the text source.");
  }
  const previousSnapshot = extractHtmlSnapshot(previousHtml);
  if (previousSnapshot.ids.length !== expectedIds.length ||
      previousSnapshot.ids.some((id, index) => id !== expectedIds[index])) {
    fail("The editable page IDs changed in index.html; reconcile the ID migration before syncing.");
  }
  previousHtmlById = previousSnapshot.byId;
  htmlTextChanged = !mapsEqual(previousSnapshot.byId, htmlById);
} else if (htmlChanged) {
  fail("Cannot safely isolate changed HTML text without the push-base index.html; refusing to overwrite the Drive snapshot.");
}

const repositoryPayload = JSON.parse(
  fs.readFileSync("page-changes-production.json", "utf8")
);
if (!repositoryPayload || repositoryPayload.success !== true ||
    !Array.isArray(repositoryPayload.changes)) {
  fail("page-changes-production.json has an invalid structure.");
}
const jsonById = normalizeChanges(
  repositoryPayload.changes,
  "page-changes-production.json"
);
if (jsonById.size !== expectedIds.length ||
    expectedIds.some(id => !jsonById.has(id))) {
  fail("The repository JSON IDs do not exactly match index.html.");
}

// Source selection:
// - index.html only: take the actual editable DOM text.
// - JSON only: take the approved JSON snapshot.
// - both files: require exact text equality; reject conflicting edits.
// - manual first sync: use JSON as the canonical repository snapshot.
let selectedById;
if (htmlTextChanged && jsonChanged) {
  if (!mapsEqual(htmlById, jsonById)) {
    fail("index.html and page-changes-production.json changed together but their editable texts differ.");
  }
  selectedById = htmlById;
} else if (htmlTextChanged && !jsonChanged) {
  // Apply only the IDs whose HTML text changed in this push.
  // Keep every untouched value from the approved main JSON snapshot.
  if (!previousHtmlById) {
    fail("Missing push-base HTML snapshot; refusing a full-page text replacement.");
  }
  selectedById = new Map(jsonById);
  for (const id of expectedIds) {
    if (previousHtmlById.get(id) !== htmlById.get(id)) {
      selectedById.set(id, htmlById.get(id));
    }
  }
} else {
  selectedById = jsonById;
}
const changes = orderedChanges(expectedIds, selectedById);
const payload = {
  success: true,
  changes,
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
  String(result.status || "success") + "; IDs: " + changes.length +
  "; source: " + (manualRun ? "manual-json" : htmlTextChanged && jsonChanged ? "html+json" : htmlTextChanged ? "index.html" : "json") +
  "; commit: " + commitSha + "; updatedAt: " +
  String(result.updatedAt || payload.updatedAt));
