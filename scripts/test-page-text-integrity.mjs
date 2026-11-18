import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync("index.html", "utf8");
const payload = JSON.parse(fs.readFileSync("page-changes-production.json", "utf8"));
const syncScript = fs.readFileSync("scripts/sync-main-page-texts-to-drive.mjs", "utf8");
const htmlForParsing = html.charCodeAt(0) === 0xFEFF ? html.slice(1) : html;
const htmlDom = new JSDOM(htmlForParsing);
const htmlIds = Array.from(htmlDom.window.document.querySelectorAll("[data-page-edit-id]"))
  .map(element => element.getAttribute("data-page-edit-id"));
const jsonIds = (payload.changes || []).map(item => item && item.id);

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
  const entry = payload.changes.find(item => item.id === id);
  assert.ok(entry, "Ticker ID is missing from JSON: " + id);
  assert.equal(entry.text, expectedText, "Ticker text changed unexpectedly: " + id);
}

assert.match(html, /data-page-edits-pending="true"/);
assert.match(html, /function showPageChangesLoadError\(/);
assert.match(html, /applyStats\.matched !== pageIds\.length/);
assert.match(html, /applyStats\.missing !== 0/);
assert.match(html, /applyStats\.invalid !== 0/);
assert.match(html, /applyStats\.skippedEditing !== 0/);
assert.doesNotMatch(html, /assignPageEditIds\(\);\s*applyCachedPageChanges\(\);/);

const saveStart = html.indexOf("function saveAllPageChanges() {");
const saveEnd = html.indexOf("window.addEventListener('message', function(event)", saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart);
const saveFunction = html.slice(saveStart, saveEnd);
assert.match(saveFunction, /action:\s*'savePageChanges'/);
assert.doesNotMatch(saveFunction, /baseUpdatedAt|expectedIds/);

assert.match(syncScript, /syncPageChangesFromGitHub/);
assert.match(syncScript, /expectedIdsHash/);
assert.match(syncScript, /createHmac\("sha256"/);
assert.match(syncScript, /refs\/heads\/main/);

console.log("Page text checks passed: 111 unique IDs, exact JSON coverage, both ticker texts, preserved site save contract, and no stale cache application.");
