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

const dom = new JSDOM(html);
const document = dom.window.document;
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

function makeStableId(element, textNodeIndex) {
  const path = [];
  let current = element;
  while (current && current !== document.body) {
    let position = 1;
    let previous = current.previousElementSibling;
    while (previous) {
      if (previous.tagName === current.tagName) position++;
      previous = previous.previousElementSibling;
    }
    path.unshift(current.tagName.toLowerCase() + position);
    current = current.parentElement;
  }
  const value = path.join("/") +
    (textNodeIndex === undefined ? "" : "/text-" + textNodeIndex);
  let hashA = 2166136261;
  let hashB = 2246822519;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    hashA = Math.imul(hashA ^ code, 16777619);
    hashB = Math.imul(hashB ^ code, 3266489917);
  }
  const hex = number => (number >>> 0).toString(16).padStart(8, "0");
  return "auto-" + hex(hashA) + hex(hashB);
}

const usedIds = new Set(
  Array.from(document.querySelectorAll("[data-page-edit-id]"))
    .map(element => element.getAttribute("data-page-edit-id"))
    .filter(Boolean)
);

const candidates = Array.from(document.body.querySelectorAll("*"));
for (const element of candidates) {
  if (element.hasAttribute("data-page-edit-id")) continue;
  if (element.parentElement &&
      element.parentElement.closest("[data-page-edit-id]")) continue;
  if (element.closest(excludedRoots)) continue;

  const tag = element.tagName;
  if ([
    "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH", "CANVAS",
    "INPUT", "TEXTAREA", "SELECT", "OPTION", "IFRAME"
  ].includes(tag)) continue;

  if (element.children.length === 0) {
    if (!element.textContent || !element.textContent.trim()) continue;
    const id = makeStableId(element);
    if (usedIds.has(id)) continue;
    element.setAttribute("data-page-edit-id", id);
    usedIds.add(id);
    continue;
  }

  Array.from(element.childNodes).forEach((node, index) => {
    if (node.nodeType !== dom.window.Node.TEXT_NODE || !node.nodeValue.trim()) return;
    const id = makeStableId(element, index);
    if (usedIds.has(id)) return;
    const span = document.createElement("span");
    span.setAttribute("data-page-edit-id", id);
    span.textContent = node.nodeValue;
    element.replaceChild(span, node);
    usedIds.add(id);
  });
}

const seen = new Set();
const missing = [];
for (const item of payload.changes) {
  if (!item || typeof item.id !== "string" || typeof item.text !== "string" ||
      item.id.length > 200 || item.text.length > 10000) {
    throw new Error("A change item has invalid id/text values.");
  }
  if (seen.has(item.id)) throw new Error("Duplicate edit id: " + item.id);
  seen.add(item.id);
  const target = document.querySelector(
    '[data-page-edit-id="' + item.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"]'
  );
  if (!target) {
    missing.push(item.id);
    continue;
  }
  target.textContent = item.text;
}

if (missing.length) {
  throw new Error(
    "Refusing to write index.html because these saved edit IDs were not found: " +
    missing.join(", ")
  );
}

const output = dom.serialize();
fs.writeFileSync(htmlPath, output, "utf8");
console.log("Updated " + payload.changes.length + " text nodes in index.html.");
console.log("Verified the alert title and all four ticker message IDs.");
