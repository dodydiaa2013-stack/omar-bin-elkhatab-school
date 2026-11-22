import fs from "node:fs";
import { JSDOM } from "jsdom";

const htmlPath = "index.html";
const changesPath = "page-changes-production.json";
const html = fs.readFileSync(htmlPath, "utf8");
const payload = JSON.parse(fs.readFileSync(changesPath, "utf8"));

function parseWithLocations(source) {
  const hasBom = source.charCodeAt(0) === 0xFEFF;
  const dom = new JSDOM(hasBom ? source.slice(1) : source, {
    includeNodeLocations: true
  });

  return {
    dom,
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
  if (!document.doctype ||
      document.documentElement?.tagName !== "HTML" ||
      !document.head ||
      !document.body ||
      !document.head.querySelector("title") ||
      !document.head.querySelector('meta[charset]') ||
      !document.head.querySelector('link[rel="stylesheet"]')) {
    throw new Error("HTML structure validation failed " + stage + ".");
  }
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function updateVirtualTextPreservingMarkup(element, savedText) {
  if (!element.children.length) {
    element.textContent = savedText;
    return true;
  }

  const protectedChildren = Array.from(element.children)
    .filter(child => (child.textContent || "").length > 0);
  const segments = [];
  let cursor = 0;

  for (const child of protectedChildren) {
    const childText = child.textContent || "";
    const at = savedText.indexOf(childText, cursor);
    if (at < 0) return false;
    segments.push(savedText.slice(cursor, at));
    cursor = at + childText.length;
  }
  segments.push(savedText.slice(cursor));

  let segmentIndex = 0;
  let pending = [];
  let used = false;

  const flush = beforeNode => {
    const value = used ? "" : (segments[segmentIndex] || "");
    if (pending.length) {
      pending[0].nodeValue = value;
      pending.slice(1).forEach(node => { node.nodeValue = ""; });
      used = true;
    } else if (value) {
      const textNode = element.ownerDocument.createTextNode(value);
      if (beforeNode) element.insertBefore(textNode, beforeNode);
      else element.appendChild(textNode);
      used = true;
    }
    pending = [];
  };

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3) {
      pending.push(node);
      continue;
    }
    if (node.nodeType === 1) {
      if ((node.textContent || "").length) {
        flush(node);
        segmentIndex++;
        used = false;
      } else if (pending.length) {
        flush(node);
      }
    }
  }
  flush(null);
  return true;
}

function planSourceTextEdits(originalElement, virtualElement, savedText, parsed) {
  const edits = [];
  const originalLocation = parsed.nodeLocation(originalElement);

  if (!originalLocation?.startTag || !originalLocation?.endTag) {
    throw new Error("Could not safely locate the HTML element for a saved text ID.");
  }

  if (!originalElement.children.length) {
    edits.push({
      start: originalLocation.startTag.endOffset,
      end: originalLocation.endTag.startOffset,
      replacement: escapeHtml(savedText)
    });
    return edits;
  }

  const virtualChildren = Array.from(virtualElement.children);
  const protectedChildren = virtualChildren
    .filter(child => (child.textContent || "").length > 0);
  const segments = [];
  let cursor = 0;

  for (const child of protectedChildren) {
    const childText = child.textContent || "";
    const at = savedText.indexOf(childText, cursor);
    if (at < 0) {
      throw new Error("Saved text conflicts with nested markup for ID: " +
        originalElement.getAttribute("data-page-edit-id"));
    }
    segments.push(savedText.slice(cursor, at));
    cursor = at + childText.length;
  }
  segments.push(savedText.slice(cursor));

  let segmentIndex = 0;
  let pending = [];
  let used = false;
  let childIndex = 0;

  const flush = beforeNode => {
    const value = used ? "" : (segments[segmentIndex] || "");

    if (pending.length) {
      pending.forEach((node, index) => {
        const location = parsed.nodeLocation(node);
        if (!location) {
          throw new Error("Could not locate an HTML text node for a saved edit.");
        }
        edits.push({
          start: location.startOffset,
          end: location.endOffset,
          replacement: index === 0 ? escapeHtml(value) : ""
        });
      });
      used = true;
    } else if (value) {
      let insertionPoint;
      if (beforeNode) {
        const location = parsed.nodeLocation(beforeNode);
        if (!location?.startTag) {
          throw new Error("Could not locate an insertion point before nested markup.");
        }
        insertionPoint = location.startTag.startOffset;
      } else {
        insertionPoint = originalLocation.endTag.startOffset;
      }
      edits.push({
        start: insertionPoint,
        end: insertionPoint,
        replacement: escapeHtml(value)
      });
      used = true;
    }

    pending = [];
  };

  for (const node of Array.from(originalElement.childNodes)) {
    if (node.nodeType === 3) {
      pending.push(node);
      continue;
    }

    if (node.nodeType === 1) {
      const virtualChild = virtualChildren[childIndex++];
      if (!virtualChild) {
        throw new Error("The virtual HTML structure changed unexpectedly.");
      }

      if ((virtualChild.textContent || "").length) {
        flush(node);
        segmentIndex++;
        used = false;
      } else if (pending.length) {
        flush(node);
      }
    }
  }

  flush(null);
  return edits;
}

if (!payload ||
    payload.success !== true ||
    !Array.isArray(payload.changes) ||
    payload.changes.length > 500) {
  throw new Error("page-changes-production.json has an invalid structure.");
}

const parsed = parseWithLocations(html);
const document = parsed.document;
assertDocumentStructure(document, "before text synchronization");

const originalTargets = new Map();
for (const element of document.querySelectorAll("[data-page-edit-id]")) {
  const id = (element.getAttribute("data-page-edit-id") || "").trim();
  if (!id || id.length > 200) {
    throw new Error("The HTML contains an empty or invalid page edit ID.");
  }
  if (originalTargets.has(id)) {
    throw new Error("Duplicate HTML page edit ID: " + id);
  }
  originalTargets.set(id, element);
}

const changesById = new Map();
for (const item of payload.changes) {
  if (!item ||
      typeof item.id !== "string" ||
      typeof item.text !== "string" ||
      !item.id.trim() ||
      item.id.length > 200 ||
      item.text.length > 10000) {
    throw new Error("A saved page text item has invalid id/text values.");
  }
  if (changesById.has(item.id)) {
    throw new Error("Duplicate saved page edit ID: " + item.id);
  }
  changesById.set(item.id, item.text);
}

if (changesById.size !== originalTargets.size) {
  throw new Error(
    "Saved page text IDs do not match index.html. HTML IDs: " +
    originalTargets.size + "; saved IDs: " + changesById.size +
    ". Refusing to generate or remove IDs automatically."
  );
}

for (const id of originalTargets.keys()) {
  if (!changesById.has(id)) {
    throw new Error("Saved page text is missing HTML edit ID: " + id);
  }
}
for (const id of changesById.keys()) {
  if (!originalTargets.has(id)) {
    throw new Error("Saved page text contains an unknown HTML edit ID: " + id);
  }
}

const virtualDom = parseWithLocations(html);
const virtualTargets = new Map();
for (const element of virtualDom.document.querySelectorAll("[data-page-edit-id]")) {
  virtualTargets.set(element.getAttribute("data-page-edit-id"), element);
}

const depthOf = element => {
  let depth = 0;
  for (let node = element; node; node = node.parentElement) depth++;
  return depth;
};

const orderedChanges = Array.from(changesById, ([id, text]) => ({
  id,
  text,
  depth: depthOf(virtualTargets.get(id))
})).sort((a, b) => b.depth - a.depth);

for (const item of orderedChanges) {
  const target = virtualTargets.get(item.id);
  if (!target || !updateVirtualTextPreservingMarkup(target, item.text)) {
    throw new Error("Saved text cannot be applied without changing nested markup: " + item.id);
  }
}

for (const item of orderedChanges) {
  if (virtualTargets.get(item.id).textContent !== item.text) {
    throw new Error("Virtual text verification failed for ID: " + item.id);
  }
}

const sourceEdits = [];
for (const item of orderedChanges) {
  sourceEdits.push(...planSourceTextEdits(
    originalTargets.get(item.id),
    virtualTargets.get(item.id),
    item.text,
    parsed
  ));
}

sourceEdits.sort((a, b) => b.start - a.start || b.end - a.end);
let output = html;
let previousStart = html.length + 1;

for (const edit of sourceEdits) {
  if (!Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > html.length ||
      edit.end > previousStart) {
    throw new Error("Overlapping or invalid HTML source edits detected.");
  }

  output =
    output.slice(0, edit.start) +
    edit.replacement +
    output.slice(edit.end);
  previousStart = edit.start;
}

const finalParsed = parseWithLocations(output);
assertDocumentStructure(finalParsed.document, "after text synchronization");

const finalTargets = new Map();
for (const element of finalParsed.document.querySelectorAll("[data-page-edit-id]")) {
  const id = (element.getAttribute("data-page-edit-id") || "").trim();
  if (!id || finalTargets.has(id)) {
    throw new Error("The final HTML contains an empty or duplicate page edit ID.");
  }
  finalTargets.set(id, element);
}

if (finalTargets.size !== changesById.size) {
  throw new Error("The final HTML page edit ID count changed unexpectedly.");
}

for (const [id, text] of changesById) {
  const target = finalTargets.get(id);
  if (!target || target.textContent !== text) {
    throw new Error("Final HTML text verification failed for ID: " + id);
  }
}

virtualDom.dom.window.close();
parsed.dom.window.close();
finalParsed.dom.window.close();

fs.writeFileSync(htmlPath, output, "utf8");
console.log("Verified and synchronized " + changesById.size + " saved page text entries.");
console.log("HTML edit IDs were preserved exactly; no IDs were generated or removed.");
console.log("Nested icons, links, and child markup were preserved.");
