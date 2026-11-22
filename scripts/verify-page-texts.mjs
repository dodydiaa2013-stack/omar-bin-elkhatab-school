import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const html = fs.readFileSync("index.html", "utf8");
const payload = JSON.parse(fs.readFileSync("page-changes-production.json", "utf8"));

assert.equal(payload?.success, true, "The production page-text payload must be successful.");
assert.ok(Array.isArray(payload.changes), "The production page-text payload must contain changes.");

const hasBom = html.charCodeAt(0) === 0xFEFF;
const dom = new JSDOM(hasBom ? html.slice(1) : html);
const document = dom.window.document;
assert.ok(document.doctype, "The HTML doctype must remain present.");
assert.ok(document.head?.querySelector("title"), "The HTML title must remain present.");
assert.ok(document.head?.querySelector('meta[charset]'), "The HTML charset must remain present.");

const htmlTargets = new Map();
for (const element of document.querySelectorAll("[data-page-edit-id]")) {
  const id = (element.getAttribute("data-page-edit-id") || "").trim();
  assert.ok(id, "HTML edit IDs must not be empty.");
  assert.ok(!htmlTargets.has(id), "HTML edit IDs must be unique: " + id);
  htmlTargets.set(id, element);
}

const savedTargets = new Map();
for (const item of payload.changes) {
  assert.ok(item && typeof item.id === "string" && typeof item.text === "string");
  assert.ok(!savedTargets.has(item.id), "Saved edit IDs must be unique: " + item.id);
  savedTargets.set(item.id, item.text);
}

assert.equal(htmlTargets.size, savedTargets.size, "HTML and JSON edit ID counts must match exactly.");
for (const [id, text] of savedTargets) {
  const target = htmlTargets.get(id);
  assert.ok(target, "Saved ID is missing from HTML: " + id);
  assert.equal(target.textContent, text, "Saved text does not match final HTML for ID: " + id);
}
for (const id of htmlTargets.keys()) {
  assert.ok(savedTargets.has(id), "HTML contains an ID absent from JSON: " + id);
}

assert.doesNotMatch(
  html,
  /html\[data-page-edits-pending=["']true["']\]\s*\[data-page-edit-id\][^{]*\{[^}]*visibility\s*:\s*hidden/i
);
assert.doesNotMatch(
  html,
  /html\[data-page-edits-pending=["']true["']\][^{]*\{[^}]*color\s*:\s*transparent/i
);

assert.match(html, /function startPageChangesPolling\(\)/);
assert.match(html, /setInterval\([\s\S]{0,220}20000\)/);

dom.window.close();
console.log("PASS: " + htmlTargets.size + "/" + savedTargets.size + " production text IDs match.");
console.log("PASS: every saved text is already present in index.html.");
console.log("PASS: no pending-state rule hides or makes page text transparent.");
console.log("PASS: visible tabs refresh saved page texts every 20 seconds.");
