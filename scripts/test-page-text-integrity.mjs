import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync("index.html", "utf8");
const payload = JSON.parse(fs.readFileSync("page-changes-production.json", "utf8"));
const patch = fs.readFileSync("docs/page-text-integrity-apps-script-patch.md", "utf8");

const htmlIds = [...html.matchAll(/data-page-edit-id\s*=\s*["']([^"']+)["']/g)].map(match => match[1]);
assert.equal(htmlIds.length, 111, "Expected the reviewed page to contain 111 edit IDs.");
assert.equal(new Set(htmlIds).size, htmlIds.length, "HTML edit IDs must be unique.");
assert.equal(payload.success, true);
assert.equal(payload.changes.length, 111);
assert.equal(new Set(payload.changes.map(item => item.id)).size, 111);

const blocks = [...patch.matchAll(/```javascript\n([\s\S]*?)\n```/g)].map(match => match[1]);
assert.ok(blocks.length >= 4, "Expected helper and three complete Apps Script function blocks.");
for (const [index, source] of blocks.entries()) {
  new vm.Script(source, { filename: `apps-script-patch-block-${index + 1}.js` });
}

const helperContext = vm.createContext({});
vm.runInContext(blocks[0], helperContext);

function validateAgainstCanonical(changes, submittedIds) {
  helperContext.validatePageChangesExpectedIds_(changes, submittedIds);
  if (submittedIds.length !== htmlIds.length ||
      htmlIds.some(id => !submittedIds.includes(id))) {
    throw new Error("Submitted IDs differ from canonical HTML IDs.");
  }
  helperContext.validatePageChangesExpectedIds_(changes, htmlIds);
}

const goodChanges = payload.changes.map(item => ({ id: item.id, text: item.text }));
assert.doesNotThrow(() => validateAgainstCanonical(goodChanges, htmlIds));

assert.throws(
  () => validateAgainstCanonical(goodChanges.slice(0, 109), htmlIds),
  /لا تطابق|غير مكتملة/
);

const duplicateChanges = goodChanges.map(item => ({ ...item }));
duplicateChanges[1].id = duplicateChanges[0].id;
assert.throws(
  () => validateAgainstCanonical(duplicateChanges, htmlIds),
  /مكرر|لا تطابق/
);

const extraId = "auto-ffffffffffffffff";
assert.throws(
  () => validateAgainstCanonical(
    [...goodChanges, { id: extraId, text: "extra" }],
    [...htmlIds, extraId]
  ),
  /differ|تطابق/
);

const baseline = payload.updatedAt;
assert.doesNotThrow(() =>
  helperContext.assertPageChangesBaseUpdatedAt_(baseline, baseline)
);
assert.throws(
  () => helperContext.assertPageChangesBaseUpdatedAt_(baseline, "2026-11-18T00:00:00.000Z"),
  /نسخة قديمة/
);

// Simulate two tabs opened on the same base: after the first save advances
// the version, the second tab's unchanged base must be rejected.
const afterFirstSave = new Date(Date.parse(baseline) + 1).toISOString();
assert.throws(
  () => helperContext.assertPageChangesBaseUpdatedAt_(baseline, afterFirstSave),
  /نسخة قديمة/
);

console.log("Page-text tests passed: 111 complete IDs; 109/missing, duplicate, extra, stale and concurrent stale snapshots rejected.");
console.log("Apps Script patch JavaScript syntax passed for " + blocks.length + " code blocks.");
