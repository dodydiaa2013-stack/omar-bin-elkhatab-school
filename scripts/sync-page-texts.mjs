import fs from "node:fs";
import { JSDOM } from "jsdom";

const htmlPath = "index.html";
const changesPath = "page-changes-production.json";
const html = fs.readFileSync(htmlPath, "utf8");
const payload = JSON.parse(fs.readFileSync(changesPath, "utf8"));

if (!payload || payload.success !== true || !Array.isArray(payload.changes)) {
  throw new Error("page-changes-production.json has an invalid structure.");
}
if (payload.changes.length > 500) {
  throw new Error("Too many page text changes.");
}

// Parse only for locating nodes. Never serialize the DOM: serialization can
// normalize or relocate markup and must not rewrite the page structure.
function parseWithLocations(source) {
  // The source file starts with a UTF-8 BOM. JSDOM treats a leading BOM in
  // an already-decoded string as text before the doctype, which moves the
  // entire head into the body. Strip it only for parsing and shift every
  // reported source offset by one so edits still target the original source.
  const hasBom = source.charCodeAt(0) === 0xFEFF;
  const dom = new JSDOM(hasBom ? source.slice(1) : source, {
    includeNodeLocations: true
  });

  return {
    window: dom.window,
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

const initialDom = parseWithLocations(html);
const document = initialDom.window.document;
assertDocumentStructure(document, "before text synchronization");

const excludedRoots = [
  "#devControlBar", "#loginBtn", "#adminBadge", "#adminModal",
  "#scheduleModal", "#passwordRecoveryPanel", "#tabletTeacherUpload",
  "#tabletImageUploadControls", "#tabletImageManagement", "#tabletGallery",
  "#googleSignInStatus", "#scheduleOperationStatus", "#scheduleTeacherControl",
  "#scheduleBulkManagement", "#scheduleBulkSelectionStatus", "#schedulesGrid",
  "#alertsTeacherControl", "#photoAlbumsStatus", "#photoAlbumsManagement",
  "#albumsSelectionStatus", "#photoAlbumsGrid", "#photoAlbumViewer",
  "#photoAlbumImagesGrid", "#photoAlbumEditor", "#photoAlbumUploadProgress",
  "#photoAlbumUploadStatus", "#photoAlbumUploadProgressText",
  "#photoAlbumUploadResults", "#albumImagesManagement",
  "#albumImagesSelectionStatus", "#scheduleClassFiles", "#adminErrorMsg",
  "#recoveryMessage", "#schoolImageViewer", '[data-page-no-auto-edit="true"]'
].join(",");

// Only update edit IDs that already exist in the production HTML.
// Never create or wrap elements while synchronizing text: missing IDs are
// rejected below, leaving the page structure byte-for-byte unchanged.
const markedHtml = html;
const markedDom = initialDom;
const markedDocument = document;

const seen = new Set();
const targets = new Map();
for (const element of markedDocument.querySelectorAll("[data-page-edit-id]")) {
  const id = element.getAttribute("data-page-edit-id");
  if (id) {
    if (targets.has(id)) throw new Error("Duplicate HTML edit id: " + id);
    targets.set(id, element);
  }
}

const missing = [];
const textEdits = [];
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

for (const item of payload.changes) {
  if (!item || typeof item.id !== "string" || typeof item.text !== "string" ||
      item.id.length > 200 || item.text.length > 10000) {
    throw new Error("A change item has invalid id/text values.");
  }
  if (seen.has(item.id)) throw new Error("Duplicate edit id: " + item.id);
  seen.add(item.id);

  const target = targets.get(item.id);
  if (!target) {
    missing.push(item.id);
    continue;
  }
  const location = markedDom.nodeLocation(target);
  if (!location?.startTag || !location?.endTag ||
      location.endTag.startOffset < location.startTag.endOffset) {
    throw new Error("Could not safely locate the content for edit id: " + item.id);
  }
  textEdits.push({
    start: location.startTag.endOffset,
    end: location.endTag.startOffset,
    replacement: escapeHtml(item.text)
  });
}

if (missing.length) {
  throw new Error(
    "Refusing to write index.html because these saved edit IDs were not found: " +
    missing.join(", ")
  );
}

textEdits.sort((a, b) => b.start - a.start);
let output = markedHtml;
let previousTextStart = markedHtml.length + 1;
for (const edit of textEdits) {
  if (edit.end > previousTextStart) {
    throw new Error("Overlapping text replacements detected; refusing to write.");
  }
  output =
    output.slice(0, edit.start) +
    edit.replacement +
    output.slice(edit.end);
  previousTextStart = edit.start;
}

const finalDom = parseWithLocations(output);
assertDocumentStructure(finalDom.window.document, "after text synchronization");
if (finalDom.window.document.head.querySelectorAll("meta").length < 5) {
  throw new Error("The document head appears incomplete; refusing to write index.html.");
}
if (finalDom.window.document.body.querySelectorAll("script").length < 1) {
  throw new Error("The document body appears incomplete; refusing to write index.html.");
}

fs.writeFileSync(htmlPath, output, "utf8");
console.log("Updated " + payload.changes.length + " text nodes in index.html.");
console.log("Preserved the original HTML source structure without DOM serialization.");
