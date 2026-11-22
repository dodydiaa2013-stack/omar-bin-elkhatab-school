import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const scriptPath = path.join(root, "scripts", "sync-page-texts.mjs");
const sourceHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const baselinePayloadPath = fs.existsSync(
  path.join(root, "page-changes-production.baseline.json")
)
  ? path.join(root, "page-changes-production.baseline.json")
  : path.join(root, "page-changes-production.json");
const sourcePayload = JSON.parse(fs.readFileSync(baselinePayloadPath, "utf8"));

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "page-text-sync-"));
  const htmlPath = path.join(directory, "index.html");
  const payloadPath = path.join(directory, "page-changes-production.json");
  const baselinePath = path.join(directory, "baseline.json");

  fs.writeFileSync(htmlPath, sourceHtml, "utf8");
  fs.writeFileSync(payloadPath, JSON.stringify(sourcePayload, null, 2), "utf8");
  fs.writeFileSync(baselinePath, JSON.stringify(sourcePayload, null, 2), "utf8");

  return { directory, htmlPath, payloadPath, baselinePath };
}

function runSync(fixture) {
  return spawnSync(process.execPath, [scriptPath, fixture.baselinePath], {
    cwd: fixture.directory,
    encoding: "utf8",
    env: {
      ...process.env,
      PAGE_TEXT_HTML_PATH: fixture.htmlPath,
      PAGE_TEXT_PAYLOAD_PATH: fixture.payloadPath
    }
  });
}

function readPayload(fixture) {
  return JSON.parse(fs.readFileSync(fixture.payloadPath, "utf8"));
}

function writePayload(fixture, payload) {
  fs.writeFileSync(fixture.payloadPath, JSON.stringify(payload, null, 2), "utf8");
}

function replaceElementText(html, id, replacement) {
  const marker = 'data-page-edit-id="' + id + '"';
  const markerIndex = html.indexOf(marker);
  assert.notEqual(markerIndex, -1, "Expected edit marker " + id);
  const openEnd = html.indexOf(">", markerIndex) + 1;
  const closeStart = html.indexOf("</", openEnd);
  assert.ok(openEnd > 0 && closeStart >= openEnd, "Expected a simple text element");
  return html.slice(0, openEnd) + replacement + html.slice(closeStart);
}

test("current production HTML and JSON are a byte-for-byte no-op", t => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

  const before = fs.readFileSync(fixture.htmlPath, "utf8");
  const result = runSync(fixture);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(fixture.htmlPath, "utf8"), before);
  assert.match(result.stdout, /Applied 0 saved text changes/);
});

test("an admin-saved text change updates only its existing HTML target", t => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

  const payload = readPayload(fixture);
  const record = payload.changes.find(item => item.id === "schedules-title");
  assert.ok(record);
  record.text = "قوائم فصول الصف الأول الثانوي";
  payload.updatedAt = new Date(Date.parse(payload.updatedAt) + 60000).toISOString();
  writePayload(fixture, payload);

  const result = runSync(fixture);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const html = fs.readFileSync(fixture.htmlPath, "utf8");
  assert.ok(html.includes("قوائم فصول الصف الأول الثانوي"));
  const titleLine = html.split("\n").find(line => line.includes('data-page-edit-id="schedules-title"'));
  assert.ok(titleLine && !/[ \t]+$/.test(titleLine), "Updated title line must not retain trailing whitespace");
  assert.ok(!html.includes('data-page-edit-id="auto-new'));
  assert.equal((html.match(/data-page-edit-id=/g) || []).length,
    (sourceHtml.match(/data-page-edit-id=/g) || []).length);
});

test("a direct HTML edit without a matching saved JSON change is rejected safely", t => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

  const manuallyEdited = replaceElementText(
    fs.readFileSync(fixture.htmlPath, "utf8"),
    "schedules-title",
    "تعديل يدوي غير مسجل"
  );
  fs.writeFileSync(fixture.htmlPath, manuallyEdited, "utf8");

  const result = runSync(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HTML\/JSON conflict/);
  assert.equal(fs.readFileSync(fixture.htmlPath, "utf8"), manuallyEdited);
});

test("a stale input cannot overwrite a newer repository HTML and JSON edit", t => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

  const newerBaseline = readPayload(fixture);
  const record = newerBaseline.changes.find(item => item.id === "schedules-title");
  assert.ok(record);
  record.text = "تعديل محفوظ حديثًا في المستودع";
  newerBaseline.updatedAt = new Date(Date.parse(newerBaseline.updatedAt) + 60000).toISOString();

  fs.writeFileSync(
    fixture.baselinePath,
    JSON.stringify(newerBaseline, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    fixture.htmlPath,
    replaceElementText(
      fs.readFileSync(fixture.htmlPath, "utf8"),
      "schedules-title",
      record.text
    ),
    "utf8"
  );

  // The incoming payload intentionally remains older than the new main baseline.
  const before = fs.readFileSync(fixture.htmlPath, "utf8");
  const result = runSync(fixture);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale or conflicting page text payload/);
  assert.equal(fs.readFileSync(fixture.htmlPath, "utf8"), before);
});

test("an HTML-only edit ID is rejected", t => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

  const html = fs.readFileSync(fixture.htmlPath, "utf8");
  fs.writeFileSync(
    fixture.htmlPath,
    html.replace("<body", '<body data-page-edit-id="html-only-test"'),
    "utf8"
  );

  const result = runSync(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match/);
});

test("a JSON record without an HTML target is rejected", t => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

  const payload = readPayload(fixture);
  payload.changes = payload.changes.filter(item => item.id !== "schedules-title");
  writePayload(fixture, payload);

  const result = runSync(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match/);
});

test("a JSON-only edit ID is rejected", t => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

  const payload = readPayload(fixture);
  payload.changes.push({ id: "json-only-test", text: "عنصر غير موجود" });
  writePayload(fixture, payload);

  const result = runSync(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match/);
});

test("duplicate JSON IDs are rejected", t => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

  const payload = readPayload(fixture);
  payload.changes.push({ ...payload.changes[0] });
  writePayload(fixture, payload);

  const result = runSync(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate edit id/);
});

test("editable text stays hidden until the server response or fallback is applied", () => {
  assert.match(
    sourceHtml,
    /html\[data-page-edits-pending="true"\]\s+\[data-page-edit-id\]\s*\{\s*visibility:\s*hidden\s*!important;/
  );

  const earlyStart = sourceHtml.indexOf("window.__pageChangesDomReady = false;");
  const pendingMarker = sourceHtml.indexOf(
    'document.documentElement.setAttribute("data-page-edits-pending", "true");',
    earlyStart
  );
  const requestAppend = sourceHtml.indexOf("document.head.appendChild(request);", earlyStart);
  assert.ok(earlyStart >= 0 && pendingMarker > earlyStart && requestAppend > pendingMarker,
    "The pending state must be set before the early request is started.");
  assert.match(sourceHtml, /window\.finishPageChangesInitialLoad = function\(\)/);

  const domReadyStart = sourceHtml.indexOf("window.addEventListener('DOMContentLoaded', () =>");
  const domReadyEnd = sourceHtml.indexOf("function initLocalStorage()", domReadyStart);
  assert.ok(domReadyStart >= 0 && domReadyEnd > domReadyStart);
  assert.doesNotMatch(
    sourceHtml.slice(domReadyStart, domReadyEnd),
    /removeAttribute\(["']data-page-edits-pending["']\)/,
    "DOMContentLoaded must not reveal stale text while the request is still pending."
  );

  const receiveStart = sourceHtml.indexOf("function receivePageChanges(data)");
  const receiveEnd = sourceHtml.indexOf("function exportUpdatedHTML()", receiveStart);
  const receiveBlock = sourceHtml.slice(receiveStart, receiveEnd);
  assert.equal(
    (receiveBlock.match(/finishPageChangesInitialLoad\(\)/g) || []).length,
    4,
    "Every server-response outcome must release the initial visibility lock."
  );

  const fallbackStart = sourceHtml.indexOf("function loadSavedPageChanges()");
  const fallbackEnd = sourceHtml.indexOf("function receivePageChanges(data)", fallbackStart);
  const fallbackBlock = sourceHtml.slice(fallbackStart, fallbackEnd);
  assert.equal(
    (fallbackBlock.match(/finishPageChangesInitialLoad\(\)/g) || []).length,
    3,
    "Fallback network error, missing callback, and timeout must release the visibility lock."
  );
});
