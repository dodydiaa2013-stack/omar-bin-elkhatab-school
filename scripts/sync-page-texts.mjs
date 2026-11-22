import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const htmlPath = process.env.PAGE_TEXT_HTML_PATH || "index.html";
const payloadPath = process.env.PAGE_TEXT_PAYLOAD_PATH || "page-changes-production.json";
const baselinePath = process.argv[2] || process.env.PAGE_TEXT_BASELINE_PATH;

if (!baselinePath) {
  throw new Error("A baseline JSON path is required. Pass it as the first argument.");
}

const html = fs.readFileSync(htmlPath, "utf8");
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

function validatePayload(value, label) {
  if (!value || value.success !== true || !Array.isArray(value.changes)) {
    throw new Error(label + " has an invalid structure.");
  }
  if (value.changes.length > 500) {
    throw new Error(label + " contains too many page text changes.");
  }

  const records = new Map();
  for (const item of value.changes) {
    if (!item || typeof item.id !== "string" || !item.id ||
        item.id.length > 200 || typeof item.text !== "string" ||
        item.text.length > 10000) {
      throw new Error(label + " contains an invalid id/text item.");
    }
    if (records.has(item.id)) {
      throw new Error(label + " contains a duplicate edit id: " + item.id);
    }
    records.set(item.id, item.text);
  }
  return records;
}

const payloadRecords = validatePayload(payload, "Incoming page text payload");
const baselineRecords = validatePayload(baseline, "Main-branch baseline payload");

function parseWithLocations(source) {
  const hasBom = source.charCodeAt(0) === 0xFEFF;
  const dom = new JSDOM(hasBom ? source.slice(1) : source, {
    includeNodeLocations: true
  });

  return {
    window: dom.window,
    document: dom.window.document,
    nodeLocation(node) {
      const location = dom.nodeLocation(node);
      if (!location || !hasBom) return location;

      const shiftPart = part => part ? {
        ...part,
        startOffset: part.startOffset + 1,
        endOffset: part.endOffset + 1
      } : null;

      return {
        ...location,
        startOffset: location.startOffset + 1,
        endOffset: location.endOffset + 1,
        startTag: shiftPart(location.startTag),
        endTag: shiftPart(location.endTag)
      };
    }
  };
}

function assertDocumentStructure(document, stage) {
  if (!document.doctype || document.documentElement?.tagName !== "HTML" ||
      !document.head || !document.body ||
      !document.head.querySelector("title") ||
      !document.head.querySelector('meta[charset]') ||
      !document.head.querySelector('link[rel="stylesheet"]')) {
    throw new Error("HTML structure validation failed " + stage + ".");
  }
}

function collectHtmlTargets(document) {
  const targets = new Map();
  for (const element of document.querySelectorAll("[data-page-edit-id]")) {
    const id = element.getAttribute("data-page-edit-id");
    if (!id) {
      throw new Error("An empty data-page-edit-id was found in index.html.");
    }
    if (targets.has(id)) {
      throw new Error("Duplicate HTML edit id: " + id);
    }
    targets.set(id, element);
  }
  return targets;
}

function assertSameIds(left, right, label) {
  const missing = [];
  const extra = [];
  for (const id of left.keys()) if (!right.has(id)) missing.push(id);
  for (const id of right.keys()) if (!left.has(id)) extra.push(id);

  if (missing.length || extra.length) {
    throw new Error(
      label + " does not match. Missing: [" + missing.join(", ") +
      "]. Extra: [" + extra.join(", ") + "]. No files were written."
    );
  }
}

const initial = parseWithLocations(html);
assertDocumentStructure(initial.document, "before text synchronization");
const htmlTargets = collectHtmlTargets(initial.document);

// The current HTML, the main-branch baseline JSON, and the incoming JSON must
// describe exactly the same editable elements. The script never invents IDs.
assertSameIds(htmlTargets, baselineRecords, "HTML IDs versus main baseline JSON IDs");
assertSameIds(htmlTargets, payloadRecords, "HTML IDs versus incoming JSON IDs");

// A mismatch between the checked-out HTML and the main baseline means somebody
// changed page text directly without updating its saved record. Stop rather
// than silently overwriting that work with an older JSON value.
for (const [id, element] of htmlTargets) {
  const baselineText = baselineRecords.get(id);
  if (element.textContent !== baselineText) {
    throw new Error(
      "HTML/JSON conflict for edit id " + id +
      ". The current HTML differs from the main-branch saved text. " +
      "Update HTML and JSON together, then retry. No files were written."
    );
  }
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const textEdits = [];
let changedCount = 0;
for (const [id, incomingText] of payloadRecords) {
  const baselineText = baselineRecords.get(id);
  if (incomingText === baselineText) continue;

  const target = htmlTargets.get(id);
  if (target.children.length !== 0) {
    throw new Error(
      "Refusing to replace edit id " + id +
      " because it contains nested HTML. Preserve its markup and edit only its text node."
    );
  }

  const location = initial.nodeLocation(target);
  if (!location?.startTag || !location?.endTag ||
      location.endTag.startOffset < location.startTag.endOffset) {
    throw new Error("Could not safely locate the content for edit id: " + id);
  }

  textEdits.push({
    start: location.startTag.endOffset,
    end: location.endTag.startOffset,
    replacement: escapeHtml(incomingText)
  });
  changedCount++;
}

textEdits.sort((a, b) => b.start - a.start);
let output = html;
let previousStart = html.length + 1;
for (const edit of textEdits) {
  if (edit.end > previousStart) {
    throw new Error("Overlapping text replacements detected; refusing to write index.html.");
  }
  output = output.slice(0, edit.start) +
    edit.replacement +
    output.slice(edit.end);
  previousStart = edit.start;
}

const finalDom = parseWithLocations(output);
assertDocumentStructure(finalDom.document, "after text synchronization");
const finalTargets = collectHtmlTargets(finalDom.document);
assertSameIds(finalTargets, payloadRecords, "Final HTML IDs versus incoming JSON IDs");

for (const [id, expectedText] of payloadRecords) {
  if (finalTargets.get(id).textContent !== expectedText) {
    throw new Error("Final text verification failed for edit id " + id + ".");
  }
}

if (finalDom.document.head.querySelectorAll("meta").length < 5 ||
    finalDom.document.body.querySelectorAll("script").length < 1) {
  throw new Error("The document appears incomplete; refusing to write index.html.");
}

if (output !== html) {
  fs.writeFileSync(htmlPath, output, "utf8");
}

console.log("Validated " + payloadRecords.size + " editable text records.");
console.log("Applied " + changedCount + " saved text changes.");
console.log("HTML IDs, baseline JSON IDs, and incoming JSON IDs match exactly.");
console.log("No automatic edit IDs were generated.");
console.log("Original HTML source structure was preserved.");
