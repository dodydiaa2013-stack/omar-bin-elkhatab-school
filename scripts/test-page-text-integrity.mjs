import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { JSDOM } from "jsdom";

const html = fs.readFileSync("index.html", "utf8");
const payload = JSON.parse(fs.readFileSync("page-changes-production.json", "utf8"));
const syncScript = fs.readFileSync("scripts/sync-main-page-texts-to-drive.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/sync-main-page-texts-to-drive.yml", "utf8");
const htmlForParsing = html.charCodeAt(0) === 0xFEFF ? html.slice(1) : html;
const htmlDom = new JSDOM(htmlForParsing);
const elements = Array.from(htmlDom.window.document.querySelectorAll("[data-page-edit-id]"));
const htmlIds = elements.map(element => (element.getAttribute("data-page-edit-id") || "").trim());
const htmlChanges = elements.map((element, index) => ({
  id: htmlIds[index],
  text: element.textContent.trim()
}));
const jsonIds = (payload.changes || []).map(item => item && item.id);
const jsonById = new Map((payload.changes || []).map(item => [item.id, item.text]));
const htmlById = new Map(htmlChanges.map(item => [item.id, item.text]));

assert.equal(payload.success, true);
assert.equal(htmlIds.length, 111, "Expected exactly 111 editable elements in the reviewed page.");
assert.equal(new Set(htmlIds).size, 111, "HTML IDs must be unique.");
assert.equal(payload.changes.length, 111, "The JSON snapshot must contain all 111 page texts.");
assert.equal(new Set(jsonIds).size, 111, "JSON IDs must be unique.");
assert.deepEqual([...jsonIds].sort(), [...htmlIds].sort(),
  "The JSON and HTML ID sets must match exactly.");

const tickerExpected = new Map([
  ["auto-7b3e91c4a62d805f", "تابعوا الموقع لمعرفة موعد تسليم التابلت والأوراق المطلوبة."],
  ["auto-c81f4a2d96b7305e", "يمكنكم الحصول على كود الطالب والدخول إلى منصة البرمجة من قسم الاستعلامات الطلابية."]
]);
for (const [id, expectedText] of tickerExpected) {
  assert.equal(jsonById.get(id), expectedText, "Approved ticker text changed: " + id);
  assert.equal(htmlById.get(id), expectedText, "HTML ticker text differs from JSON: " + id);
}

// Guard the existing website save contract: the repository sync must use the same text extraction.
const saveStart = html.indexOf("function saveAllPageChanges() {");
const saveEnd = html.indexOf("window.addEventListener('message', function(event)", saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart);
const saveFunction = html.slice(saveStart, saveEnd);
assert.match(saveFunction, /text:\s*el\.textContent\.trim\(\)/);
assert.match(saveFunction, /action:'savePageChanges'/);
assert.doesNotMatch(saveFunction, /baseUpdatedAt|expectedIds/);

assert.match(syncScript, /htmlTextChanged && jsonChanged/);
assert.match(syncScript, /git", \["show", eventBefore \+ ":index.html"\]/);
assert.match(syncScript, /CSS\/layout-only edit/);
assert.match(syncScript, /selectedById = htmlById/);
assert.match(syncScript, /selectedById = jsonById/);
assert.match(syncScript, /element\.textContent\.trim\(\)/);
assert.match(syncScript, /createHmac\("sha256"/);
assert.match(syncScript, /refs\/heads\/main/);
assert.match(workflow, /"index\.html"/);
assert.match(workflow, /"page-changes-production\.json"/);
assert.match(workflow, /GITHUB_EVENT_BEFORE/);
assert.match(workflow, /GITHUB_EVENT_BEFORE: \\?\$\{\{ github\.event\.before \}\}/);

// This PR must not rewrite the existing refresh implementation.
const mainHtml = execFileSync("git", ["show", "origin/main:index.html"], { encoding: "utf8" });
function extractFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, "Missing function marker: " + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, "Missing end marker for: " + startMarker);
  return source.slice(start, end);
}
for (const [startMarker, endMarker] of [
  ["window.addEventListener('DOMContentLoaded', () => {", "function initLocalStorage()"],
  ["function loadSavedPageChanges() {", "function receivePageChanges(data) {"],
  ["function receivePageChanges(data) {", "function exportUpdatedHTML()"],
  ["function applyCachedPageChanges() {", "function cacheCurrentPageChanges()"]
]) {
  assert.equal(
    extractFunction(html, startMarker, endMarker),
    extractFunction(mainHtml, startMarker, endMarker),
    "Existing refresh/cache behavior was changed: " + startMarker
  );
}

console.log("Page-text sync checks passed: 111 unique IDs, both ticker texts, same extraction as site save, index.html + JSON source routing, and unchanged refresh functions.");
