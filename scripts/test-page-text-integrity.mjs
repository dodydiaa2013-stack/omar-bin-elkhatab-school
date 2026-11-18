import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync("index.html", "utf8");
const payload = JSON.parse(fs.readFileSync("page-changes-production.json", "utf8"));
const syncScript = fs.readFileSync("scripts/sync-page-texts.mjs", "utf8");
const patch = fs.readFileSync("docs/page-text-integrity-apps-script-patch.md", "utf8");
const workflow = fs.readFileSync(".github/workflows/sync-page-texts-main-to-drive.yml", "utf8");

const htmlIds = [...html.matchAll(/data-page-edit-id\\s*=\\s*["']([^"']+)["']/g)].map(match => match[1]);
const savedIds = payload.changes.map(item => item.id);
const meta = html.match(/<meta name="page-edits-updated-at" content="([^"]+)">/);

assert.equal(htmlIds.length, 111);
assert.equal(new Set(htmlIds).size, 111);
assert.equal(payload.success, true);
assert.equal(payload.changes.length, 111);
assert.equal(new Set(savedIds).size, 111);
assert.deepEqual([...payload.expectedIds], htmlIds);
assert.deepEqual([...savedIds].sort(), [...htmlIds].sort());
assert.ok(meta);
assert.equal(Date.parse(meta[1]), Date.parse(payload.updatedAt));
assert.ok(payload.changes.some(item => item.text.includes("TEST-1811")));

assert.match(syncScript, /htmlIdsMissingFromPayload/);
assert.match(syncScript, /payloadTime < baselineTime/);
assert.match(syncScript, /payload\\.expectedIds !== undefined/);
assert.match(html, /pageChangesLoadSucceeded/);
assert.match(html, /if \\(!pageChangesLoadSucceeded\\)/);
assert.match(workflow, /branches:\\s*\\n\\s*- main/);
assert.match(workflow, /PAGE_CHANGES_SYNC_HMAC_SECRET/);
assert.match(patch, /syncPageChangesFromGitHub_/);
assert.match(patch, /PAGE_CHANGES_LAST_GITHUB_COMMIT_SHA/);

const oldBlocks = [...patch.matchAll(/\x60\x60\x60javascript\\n([\\s\\S]*?)\\n\x60\x60\x60/ g)].map(match => match[1]);
const newBlocks = [...patch.matchAll(/~~~javascript\\n([\\s\\S]*?)\\n~~~/g)].map(match => match[1]);
const allBlocks = [...oldBlocks, ...newBlocks];
assert.ok(allBlocks.length >= 7);
for (const [index, source] of allBlocks.entries()) {
  new vm.Script(source, { filename: "apps-script-patch-block-" + (index + 1) + ".js" });
}

console.log("Page text integrity passed: 111 exact unique IDs, matching timestamp, TEST-1811 preservation and reverse-sync guards.");
console.log("Apps Script patch JavaScript syntax passed for " + allBlocks.length + " code blocks.");
