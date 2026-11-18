import assert from "node:assert/strict";
import fs from "node:fs";
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
assert.match(syncScript, /selectedById = new Map\(jsonById\)/);
assert.match(syncScript, /previousHtmlById\.get\(id\) !== htmlById\.get\(id\)/);
assert.match(syncScript, /selectedById\.set\(id, htmlById\.get\(id\)\)/);
assert.match(syncScript, /Cannot safely isolate changed HTML text without the push-base index\.html/);
assert.match(syncScript, /element\.textContent\.trim\(\)/);
assert.match(syncScript, /createHmac\("sha256"/);
assert.match(syncScript, /refs\/heads\/main/);
assert.match(workflow, /"index\.html"/);
assert.match(workflow, /"page-changes-production\.json"/);
assert.match(workflow, /GITHUB_EVENT_BEFORE/);
assert.match(workflow, /GITHUB_EVENT_BEFORE: \\?\$\{\{ github\.event\.before \}\}/);

// The page must never render cached or default text before the verified Drive response.
assert.match(html, /setAttribute\(['"]data-page-edits-pending['"],\s*['"]['"]\)/);
assert.match(html, /html\[data-page-edits-pending\] body/);
assert.match(html, /html\[data-page-edits-error\] body/);
assert.match(html, /جارٍ تحميل النصوص المعتمدة/);
assert.match(html, /تعذر تحميل النصوص المعتمدة/);
assert.doesNotMatch(html, /applyCachedPageChanges/);
assert.doesNotMatch(html, /وصلت قائمة تعديلات فارغة من الخادم/);
assert.match(html, /function validatePageChangesSnapshot\(changes\)/);
assert.match(html, /changes\.length !== 111/);
assert.match(html, /new Set\(expectedIds\)\.size !== 111/);
assert.match(html, /byId\.size !== expectedIds\.length/);
assert.match(html, /expectedIds\.some\(id => !byId\.has\(id\)\)/);
assert.match(html, /markPageChangesUnavailable\(/);
assert.match(html, /markPageChangesReady\(\)/);
assert.ok(
  html.indexOf("validatePageChangesSnapshot(data.changes)") <
    html.indexOf("applyPageChangesList(normalizedChanges)"),
  "The complete snapshot must be validated before any text is applied."
);
assert.equal(
  (html.match(/removeAttribute\(["']data-page-edits-pending["']\)/g) || []).length,
  2,
  "Only the success and explicit failure handlers may end the pending state."
);

console.log("Page-text integrity checks passed: 111 unique IDs, ticker text, unchanged save contract, no stale cache rendering, strict full-snapshot validation, and fail-closed loading.");
