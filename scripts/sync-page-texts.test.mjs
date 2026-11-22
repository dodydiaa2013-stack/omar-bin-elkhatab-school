import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./sync-page-texts.mjs", import.meta.url));

function fixtureDocument(body) {
  return "\uFEFF<!doctype html><html><head><meta charset=\"UTF-8\"><title>Test</title><link rel=\"stylesheet\" href=\"test.css\"></head><body>" +
    body +
    "</body></html>";
}

function runSync(html, changes) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "page-text-sync-"));
  fs.writeFileSync(path.join(directory, "index.html"), html, "utf8");
  fs.writeFileSync(path.join(directory, "page-changes-production.json"), JSON.stringify({
    success: true,
    changes
  }), "utf8");

  try {
    execFileSync(process.execPath, [scriptPath], {
      cwd: directory,
      stdio: "pipe"
    });
    return {
      html: fs.readFileSync(path.join(directory, "index.html"), "utf8")
    };
  } catch (error) {
    const unchanged = fs.readFileSync(path.join(directory, "index.html"), "utf8");
    throw Object.assign(new Error(
      (error.stderr || error.stdout || error.message).toString()
    ), { unchanged });
  }
}

test("updates plain text and escapes HTML characters without changing the document shell", () => {
  const source = fixtureDocument('<p data-page-edit-id="plain">Old text</p>');
  const result = runSync(source, [{ id: "plain", text: "A & B < C" }]);
  assert.match(result.html, /<p data-page-edit-id="plain">A &amp; B &lt; C<\/p>/);
  assert.ok(result.html.startsWith("\uFEFF<!doctype html>"));
  assert.match(result.html, /<link rel="stylesheet" href="test\.css">/);
});

test("preserves link targets, icons, and nested editable markup", () => {
  const source = fixtureDocument(
    '<a data-page-edit-id="outer" href="/keep"><i class="fa-solid fa-link"></i>Open <span data-page-edit-id="inner">old</span> now</a>'
  );
  const result = runSync(source, [
    { id: "outer", text: "Read new now" },
    { id: "inner", text: "new" }
  ]);

  assert.match(result.html, /href="\/keep"/);
  assert.match(result.html, /<i class="fa-solid fa-link"><\/i>/);
  assert.match(result.html, /<span data-page-edit-id="inner">new<\/span>/);
  assert.match(result.html, /<i class="fa-solid fa-link"><\/i>Read <span data-page-edit-id="inner">new<\/span> now/);
});

test("keeps an empty icon before a link label while updating the label", () => {
  const source = fixtureDocument(
    '<a data-page-edit-id="link" href="/query"><i class="fa-solid fa-arrow-up-right-from-square"></i>Open directly</a>'
  );
  const result = runSync(source, [{ id: "link", text: "Open the query page" }]);
  assert.match(result.html, /href="\/query"/);
  assert.match(result.html, /<i class="fa-solid fa-arrow-up-right-from-square"><\/i>Open the query page/);
});

test("rejects missing IDs and leaves index.html untouched", () => {
  const source = fixtureDocument('<p data-page-edit-id="one">Original</p>');
  let failure;
  try {
    runSync(source, [{ id: "different", text: "Changed" }]);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.match(failure.message, /do not match index\.html|missing HTML edit ID|unknown HTML edit ID/i);
  assert.equal(failure.unchanged, source);
});

test("rejects duplicate saved IDs and leaves index.html untouched", () => {
  const source = fixtureDocument('<p data-page-edit-id="one">Original</p>');
  let failure;
  try {
    runSync(source, [
      { id: "one", text: "First" },
      { id: "one", text: "Second" }
    ]);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.match(failure.message, /Duplicate saved page edit ID/);
  assert.equal(failure.unchanged, source);
});

test("a second synchronization is idempotent", () => {
  const source = fixtureDocument('<p data-page-edit-id="plain">Old</p>');
  const first = runSync(source, [{ id: "plain", text: "New" }]);
  const second = runSync(first.html, [{ id: "plain", text: "New" }]);
  assert.equal(second.html, first.html);
});
