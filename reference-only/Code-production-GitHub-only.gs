const CLIENT_ID = "";
const ALLOWED_EMAIL = "";
const FOLDER_NAME = "صور مدرسة عمر بن الخطاب ث بنين";
const SCHEDULE_FOLDER_NAME = "قوائم فصول مدرسة عمر بن الخطاب ث بنين";
const PHOTO_ALBUMS_FOLDER_NAME = "ألبومات معرض مدرسة عمر بن الخطاب ث بنين";
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ALLOWED_CLASSES = ["1/1", "1/2", "1/3", "1/4", "1/5", "1/6", "1/7", "1/8"];
const RECOVERY_EMAIL = "";
const ALLOWED_PAGE_ORIGINS = [
  "https://dodydiaa2013-stack.github.io"
];
/* =========================
   المجلدات
========================= */

function getFolder() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  return folders.hasNext()
    ? folders.next()
    : DriveApp.createFolder(FOLDER_NAME);
}

function getScheduleFolder() {
  const folders = DriveApp.getFoldersByName(SCHEDULE_FOLDER_NAME);
  return folders.hasNext()
    ? folders.next()
    : DriveApp.createFolder(SCHEDULE_FOLDER_NAME);
}
/* =========================
   مجلدات معرض الألبومات
========================= */


function getPhotoAlbums() {
  const rootFolder = getPhotoAlbumsFolder();
  const folders = rootFolder.getFolders();
  const albums = [];

  while (folders.hasNext()) {
    const folder = folders.next();
    const metadata = getPhotoAlbumMetadata(folder);

    const files = folder.getFiles();
    let images = [];
    let coverUrl = "";

    while (files.hasNext()) {
      const file = files.next();

      if (!isImageMimeType(file.getMimeType())) {
        continue;
      }

      const fileId = file.getId();

      if (fileId === metadata.coverFileId) {
        coverUrl = getImageUrl(fileId);
        continue;
      }

      images.push({
        id: fileId,
        name: file.getName(),
        url: getImageUrl(fileId)
      });
    }

    images = applySavedPhotoContentOrder_(
      images,
      "albumImages",
      folder.getId()
    );

    albums.push({
      id: folder.getId(),
      title: metadata.title,
      description: metadata.description,
      coverFileId: metadata.coverFileId,
      coverUrl: coverUrl,
      imageCount: images.length,
      images: images,
      updatedAt: metadata.updatedAt
    });
  }

  return applySavedPhotoContentOrder_(
    albums,
    "albums",
    ""
  );
}

function isFolderInsideFolder(folder, parentFolderId) {
  const parents = folder.getParents();

  while (parents.hasNext()) {
    if (parents.next().getId() === parentFolderId) {
      return true;
    }
  }

  return false;
}
/* =========================
   بيانات الألبومات
========================= */

function getPhotoAlbumMetadata(folder) {
  const description = folder.getDescription();

  if (!description) {
    return {
      title: folder.getName(),
      description: "",
      coverFileId: "",
      updatedAt: ""
    };
  }

  try {
    const data = JSON.parse(description);

    return {
      title: data.title || folder.getName(),
      description: data.description || "",
      coverFileId: data.coverFileId || "",
      updatedAt: data.updatedAt || ""
    };
  } catch (error) {
    return {
      title: folder.getName(),
      description: "",
      coverFileId: "",
      updatedAt: ""
    };
  }
}

function savePhotoAlbumMetadata(folder, data) {
  const oldData = getPhotoAlbumMetadata(folder);

  const metadata = {
    title: data.title || oldData.title,
    description: data.description !== undefined
      ? data.description
      : oldData.description,
    coverFileId: data.coverFileId !== undefined
      ? data.coverFileId
      : oldData.coverFileId,
    updatedAt: new Date().toISOString()
  };

  folder.setDescription(JSON.stringify(metadata));

  return metadata;
}
/* =========================
   قراءة ألبومات معرض الصور
========================= */
function savePhotoAlbumCover(folder, p) {
  if (!p.coverData) {
    return getPhotoAlbumMetadata(folder);
  }

  const mimeType = String(p.coverMimeType || "").trim();
  const fileName = getSafeFileName(p.coverName || "album-cover");

  if (!isImageMimeType(mimeType)) {
    throw new Error("ملف الغلاف يجب أن يكون صورة");
  }

  const bytes = decodeImageData(p.coverData, mimeType);

  if (!bytes || bytes.length === 0) {
    throw new Error("بيانات صورة الغلاف غير صالحة");
  }

  if (bytes.length > MAX_FILE_SIZE) {
    throw new Error("حجم صورة الغلاف يجب ألا يتجاوز 4 ميجابايت");
  }

  const blob = Utilities.newBlob(
    bytes,
    mimeType,
    fileName
  );

  const file = folder.createFile(blob);

  setPublicImage(file);

  return savePhotoAlbumMetadata(folder, {
    coverFileId: file.getId()
  });
}

function jsonOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function scheduleUploadPostMessage(p, result) {
  p = p || {};

  const requestedOrigin = String(p.origin || "");
  const allowedOrigin = ALLOWED_PAGE_ORIGINS.includes(requestedOrigin)
    ? requestedOrigin
    : "";

  if (!allowedOrigin) {
    return jsonOutput({
      success: false,
      message: "مصدر الطلب غير مسموح"
    });
  }

  const payload = JSON.stringify({
    type: "scheduleUploadResult",
    nonce: String(p.nonce || ""),
    result: result || {}
  }).replace(/</g, "\\u003c");

  const html =
    "<!DOCTYPE html><html><body><script>" +
    "window.top.postMessage(" + payload + ", " +
    JSON.stringify(allowedOrigin) + ");" +
    "</script></body></html>";

  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function galleryUploadPostMessage(p, result) {
  p = p || {};

  const requestedOrigin = String(p.origin || "");
  const allowedOrigin = ALLOWED_PAGE_ORIGINS.includes(requestedOrigin)
    ? requestedOrigin
    : "";

  if (!allowedOrigin) {
    return jsonOutput({
      success: false,
      message: "مصدر الطلب غير مسموح"
    });
  }

  const payload = JSON.stringify({
    type: "galleryUploadResult",
    nonce: String(p.nonce || ""),
    result: result || {}
  }).replace(/</g, "\\u003c");

  const html =
    "<!DOCTYPE html><html><body><script>" +
    "window.top.postMessage(" + payload + ", " +
    JSON.stringify(allowedOrigin) + ");" +
    "</script></body></html>";

  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function pageChangesPostMessage(p, result) {
  const nonce = String(p && p.nonce || "");
  const requestedOrigin = String(p && p.origin || "");

  const allowedOrigin = ALLOWED_PAGE_ORIGINS.includes(requestedOrigin)
    ? requestedOrigin
    : "";

  if (!allowedOrigin) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        message: "مصدر الطلب غير مسموح"
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const payload = JSON.stringify({
    type: "savePageChangesResult",
    nonce: nonce,
    result: Object.assign({}, result || {}, { environment: "PRODUCTION" })
  }).replace(/</g, "\\u003c");

  const html = `
    <!DOCTYPE html>
    <html>
      <head><meta charset="UTF-8"></head>
      <body>
        <script>
          window.top.postMessage(
            ${payload},
            ${JSON.stringify(allowedOrigin)}
          );
        </script>
      </body>
    </html>
  `;

  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function productionPageReviewStatusPostMessage(p, result) {
  p = p || {};
  const requestedOrigin = String(p.origin || "");
  const allowedOrigin = ALLOWED_PAGE_ORIGINS.includes(requestedOrigin)
    ? requestedOrigin
    : "";

  if (!allowedOrigin) {
    return jsonOutput({
      success: false,
      status: "error",
      message: "مصدر الطلب غير مسموح"
    });
  }

  const payload = JSON.stringify({
    type: "productionPageReviewStatusResult",
    nonce: String(p.nonce || ""),
    result: Object.assign({}, result || {}, { environment: "PRODUCTION" })
  }).replace(/</g, "\\u003c");

  const html = `
    <!DOCTYPE html>
    <html>
      <head><meta charset="UTF-8"></head>
      <body>
        <script>
          window.top.postMessage(
            ${payload},
            ${JSON.stringify(allowedOrigin)}
          );
        </script>
      </body>
    </html>
  `;

  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


function checkProductionPageReviewStatus(p) {
  p = p || {};

  try {
    if (String(p.environment || "") !== "PRODUCTION") {
      throw new Error("تم رفض الطلب لأن البيئة المحددة ليست الإنتاج.");
    }

    verifyAdminToken(p.googleUploadToken || p.token || "");
    verifyAdminSession(p.adminSessionToken || "");

    const expectedHash = String(p.expectedHash || "").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(expectedHash)) {
      throw new Error("بصمة النصوص المطلوبة للتحقق غير صالحة.");
    }

    const settings = getProductionPageChangesGitHubSettings_();
    const apiRoot = "https://api.github.com/repos/" + settings.repository;
    const owner = settings.repository.split("/")[0];
    const reviewBranch = "automation/page-text-sync";
    const headers = {
      Authorization: "Bearer " + settings.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    function getGithubJson_(url, label) {
      const response = UrlFetchApp.fetch(url, {
        method: "get",
        headers: headers,
        muteHttpExceptions: true
      });
      const status = response.getResponseCode();
      if (status !== 200) {
        throw new Error("تعذرت قراءة " + label + " من GitHub (HTTP " + status + ").");
      }
      return JSON.parse(response.getContentText() || "null");
    }

    function readGithubTextFile_(path, ref) {
      const url = apiRoot + "/contents/" + path + "?ref=" + encodeURIComponent(ref);
      const file = getGithubJson_(url, path);
      if (!file || file.encoding !== "base64" || !file.content) {
        throw new Error("استجابة الملف " + path + " من GitHub غير مكتملة.");
      }
      return Utilities.newBlob(
        Utilities.base64Decode(String(file.content).replace(/\s/g, ""))
      ).getDataAsString("UTF-8");
    }

    function pending_(message, number, url) {
      return productionPageReviewStatusPostMessage(p, {
        success: true,
        status: "pending",
        created: false,
        number: number || null,
        url: url || null,
        message: message
      });
    }

    const pullsUrl = apiRoot +
      "/pulls?state=open&head=" +
      encodeURIComponent(owner + ":" + reviewBranch) +
      "&base=main&per_page=20";
    const pulls = getGithubJson_(pullsUrl, "قائمة طلبات المراجعة");
    const reviewPR = (Array.isArray(pulls) ? pulls : []).find(function(pr) {
      return pr &&
        pr.state === "open" &&
        pr.head &&
        pr.head.ref === reviewBranch &&
        pr.base &&
        pr.base.ref === "main" &&
        pr.html_url &&
        pr.number &&
        pr.head.sha;
    });

    if (!reviewPR) {
      return pending_("لم يظهر طلب المراجعة بعد.");
    }

    if (reviewPR.draft !== true) {
      return pending_(
        "طلب المراجعة موجود لكنه ليس في حالة المسودة المطلوبة للمراجعة الآمنة.",
        reviewPR.number,
        reviewPR.html_url
      );
    }

    // لا نؤكد الطلب إلا إذا اقتصر التغيير على ملفي النصوص والصفحة.
    const changedFiles = getGithubJson_(
      apiRoot + "/pulls/" + reviewPR.number + "/files?per_page=100",
      "الملفات المعدلة في طلب المراجعة"
    );
    const allowedFiles = ["index.html", "page-changes-production.json"];
    if (!Array.isArray(changedFiles) ||
        changedFiles.length !== allowedFiles.length ||
        changedFiles.some(function(file) {
          return !file ||
            !allowedFiles.includes(file.filename) ||
            file.status !== "modified";
        }) ||
        allowedFiles.some(function(path) {
          return !changedFiles.some(function(file) { return file.filename === path; });
        })) {
      return pending_(
        "طلب المراجعة لا يقتصر على ملف الصفحة وملف النصوص المتوقعين؛ أوقفنا تأكيده.",
        reviewPR.number,
        reviewPR.html_url
      );
    }

    const actualPayload = validateProductionPageChangesPayload_(
      JSON.parse(readGithubTextFile_("page-changes-production.json", reviewBranch))
    );
    const actualHash = getPageChangesSyncHash_(actualPayload);
    if (actualHash !== expectedHash) {
      return pending_(
        "طلب المراجعة موجود، لكنه لم يتضمن أحدث نسخة محفوظة من النصوص بعد.",
        reviewPR.number,
        reviewPR.html_url
      );
    }

    // فحص تطابق معرّفات HTML وJSON من نفس نسخة فرع طلب المراجعة.
    const html = readGithubTextFile_("index.html", reviewBranch);
    const htmlIds = [];
    const idPattern = /data-page-edit-id\s*=\s*(["'])(.*?)\1/g;
    let match;
    while ((match = idPattern.exec(html)) !== null) {
      const id = String(match[2] || "").trim();
      if (!id || htmlIds.indexOf(id) !== -1) {
        return pending_(
          "ملف الصفحة يحتوي على معرّف فارغ أو مكرر؛ لم نؤكد طلب المراجعة.",
          reviewPR.number,
          reviewPR.html_url
        );
      }
      htmlIds.push(id);
    }

    const jsonIds = actualPayload.changes.map(function(item) { return item.id; });
    if (htmlIds.length !== jsonIds.length ||
        htmlIds.some(function(id) { return jsonIds.indexOf(id) === -1; }) ||
        jsonIds.some(function(id) { return htmlIds.indexOf(id) === -1; })) {
      return pending_(
        "معرّفات عناصر الصفحة لا تطابق معرّفات ملف النصوص؛ لم نؤكد طلب المراجعة.",
        reviewPR.number,
        reviewPR.html_url
      );
    }

    // ننتظر فحص التحقق الخاص بطلب النصوص نفسه وعلى نفس SHA، ولا نقبل نتيجة قديمة.
    const checks = getGithubJson_(
      apiRoot + "/commits/" + encodeURIComponent(reviewPR.head.sha) +
        "/check-runs?per_page=100",
      "نتائج فحص تطابق نصوص الصفحة"
    );
    const validationCheck = checks && Array.isArray(checks.check_runs)
      ? checks.check_runs.find(function(check) {
          return check &&
            check.name === "validate-page-text" &&
            check.head_sha === reviewPR.head.sha &&
            check.app &&
            check.app.slug === "github-actions";
        })
      : null;

    if (!validationCheck || validationCheck.status !== "completed") {
      return pending_(
        "تم العثور على الطلب ومطابقة الملفات، وجارٍ انتظار فحص التحقق الآلي.",
        reviewPR.number,
        reviewPR.html_url
      );
    }

    if (validationCheck.conclusion !== "success") {
      return productionPageReviewStatusPostMessage(p, {
        success: false,
        status: "error",
        created: false,
        number: reviewPR.number,
        url: reviewPR.html_url,
        message: "فشل فحص تطابق نصوص الصفحة؛ لم نؤكد طلب المراجعة."
      });
    }

    return productionPageReviewStatusPostMessage(p, {
      success: true,
      status: "confirmed",
      created: true,
      number: reviewPR.number,
      url: reviewPR.html_url,
      message: "تم التأكد من تطابق بصمة النصوص ومعرّفات الصفحة والملفات المعدلة ونجاح الفحص الآلي."
    });

  } catch (error) {
    return productionPageReviewStatusPostMessage(p, {
      success: false,
      status: "error",
      created: false,
      message: error.message || "تعذر التحقق من حالة طلب المراجعة."
    });
  }
}

function photoAlbumPostMessage(p, result) {
  p = p || {};

  const requestedOrigin = String(p.origin || "");
  const allowedOrigin = ALLOWED_PAGE_ORIGINS.includes(requestedOrigin)
    ? requestedOrigin
    : "";

  if (!allowedOrigin) {
    return jsonOutput({
      success: false,
      message: "مصدر الطلب غير مسموح"
    });
  }

  const payload = JSON.stringify({
    type: "photoAlbumResult",
    nonce: String(p.nonce || ""),
    result: result || {}
  }).replace(/</g, "\\u003c");

  const html =
    "<!DOCTYPE html><html><body><script>" +
    "window.top.postMessage(" + payload + ", " +
    JSON.stringify(allowedOrigin) + ");" +
    "</script></body></html>";

  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function isPhotoAlbumAdminAuthorized(p) {
  if (!p || !p.token || !p.adminSessionToken) {
    return false;
  }

  return verifyAdminToken(p.token) &&
         verifyAdminSession(p.adminSessionToken);
}


/* =========================================
   ترتيب الصور والألبومات والحذف الجماعي
========================================= */


function getPhotoContentOrderKey_(scope, albumId) {
  const prefix = "PHOTO_CONTENT_ORDER_V1_";

  if (scope === "albumImages") {
    return prefix + "albumImages_" + encodeURIComponent(String(albumId));
  }

  return prefix + scope;
}


/* قراءة العناصر وفق الترتيب المحفوظ */
function applySavedPhotoContentOrder_(items, scope, albumId) {
  const key = getPhotoContentOrderKey_(scope, albumId);
  const savedValue = PropertiesService
    .getScriptProperties()
    .getProperty(key);

  if (!savedValue) return items;

  try {
    const savedIds = JSON.parse(savedValue);

    if (!Array.isArray(savedIds)) return items;

    const byId = new Map();

    items.forEach(function(item) {
      byId.set(String(item.id), item);
    });

    const ordered = [];
    const used = new Set();

    savedIds.forEach(function(id) {
      const normalizedId = String(id);

      if (byId.has(normalizedId) && !used.has(normalizedId)) {
        ordered.push(byId.get(normalizedId));
        used.add(normalizedId);
      }
    });

    // إضافة العناصر الجديدة التي لم تكن موجودة وقت حفظ الترتيب.
    items.forEach(function(item) {
      const id = String(item.id);

      if (!used.has(id)) {
        ordered.push(item);
        used.add(id);
      }
    });

    return ordered;

  } catch (error) {
    console.error("تعذر قراءة ترتيب المحتوى: " + error.message);
    return items;
  }
}


/* الحصول على العناصر الحالية حسب النطاق */
function getPhotoContentItemsForOrder_(scope, albumId) {
  const items = [];

  if (scope === "gallery") {
    const files = getFolder().getFiles();

    while (files.hasNext()) {
      const file = files.next();

      if (file.getMimeType().startsWith("image/")) {
        items.push({
          id: file.getId()
        });
      }
    }

    return items;
  }

  if (scope === "albums") {
    const folders = getPhotoAlbumsFolder().getFolders();

    while (folders.hasNext()) {
      const folder = folders.next();

      items.push({
        id: folder.getId()
      });
    }

    return items;
  }

  if (scope === "albumImages") {
    if (!albumId) {
      throw new Error("معرّف الألبوم غير موجود");
    }

    const folder = getPhotoAlbumFolder(albumId);
    const metadata = getPhotoAlbumMetadata(folder);
    const files = folder.getFiles();

    while (files.hasNext()) {
      const file = files.next();

      if (!isImageMimeType(file.getMimeType())) continue;

      // لا يدخل غلاف الألبوم ضمن ترتيب الصور أو الحذف الجماعي.
      if (file.getId() === metadata.coverFileId) continue;

      items.push({
        id: file.getId()
      });
    }

    return items;
  }

  throw new Error("نطاق المحتوى غير مسموح");
}


/* حفظ ترتيب المحتوى */

function savePhotoContentOrder(p) {
  p = p || {};

  try {
    if (!isPhotoAlbumAdminAuthorized(p)) {
      throw new Error("غير مصرح لك بتغيير ترتيب المحتوى");
    }

    const scope = String(p.scope || "").trim();
    const albumId = String(p.albumId || "").trim();

    if (!["gallery", "albums", "albumImages"].includes(scope)) {
      throw new Error("نطاق الترتيب غير صحيح");
    }

    if (scope === "albumImages" && !albumId) {
      throw new Error("معرّف الألبوم غير موجود");
    }

    let ids;

    try {
      ids = JSON.parse(String(p.ids || ""));
    } catch (error) {
      throw new Error("قائمة الترتيب غير صالحة");
    }

    if (!Array.isArray(ids) || ids.length > 5000 || !ids.length) {
      throw new Error("قائمة الترتيب فارغة أو أكبر من الحد المسموح");
    }

    ids = ids.map(function(id) {
      return String(id || "").trim();
    });

    if (ids.some(function(id) { return !id; })) {
      throw new Error("توجد معرّفات غير صالحة ضمن الترتيب");
    }

    if (new Set(ids).size !== ids.length) {
      throw new Error("توجد معرّفات مكررة ضمن الترتيب");
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);

    try {
      const currentItems = getPhotoContentItemsForOrder_(scope, albumId);
      const currentIds = new Set(
        currentItems.map(function(item) {
          return String(item.id);
        })
      );

      // يجب أن تكون القائمة المرسلة ترتيبًا كاملًا للعناصر الموجودة.
      if (
        ids.length !== currentIds.size ||
        ids.some(function(id) {
          return !currentIds.has(id);
        })
      ) {
        throw new Error(
          "تغيرت قائمة المحتوى. حدّث القائمة ثم حاول حفظ الترتيب مرة أخرى."
        );
      }

      const key = getPhotoContentOrderKey_(scope, albumId);

      PropertiesService.getScriptProperties().setProperty(
        key,
        JSON.stringify(ids)
      );

    } finally {
      lock.releaseLock();
    }

    return photoAlbumPostMessage(p, {
      success: true,
      message: "تم حفظ ترتيب المحتوى بنجاح",
      scope: scope,
      count: ids.length
    });

  } catch (error) {
    return photoAlbumPostMessage(p, {
      success: false,
      message: error.message || "تعذر حفظ الترتيب"
    });
  }
}


/* الحذف الجماعي الآمن */
/* الحذف الجماعي الآمن */
function bulkDeletePhotoContent(p) {
  p = p || {};

  try {
    if (!isPhotoAlbumAdminAuthorized(p)) {
      throw new Error("غير مصرح لك بحذف المحتوى");
    }

    const scope = String(p.scope || "").trim();
    const albumId = String(p.albumId || "").trim();

    if (!["gallery", "albums", "albumImages"].includes(scope)) {
      throw new Error("نطاق الحذف غير صحيح");
    }

    if (scope === "albumImages" && !albumId) {
      throw new Error("معرّف الألبوم غير موجود");
    }

    let ids;

    try {
      ids = JSON.parse(String(p.ids || ""));
    } catch (error) {
      throw new Error("قائمة الحذف غير صالحة");
    }

    if (!Array.isArray(ids) || !ids.length || ids.length > 5000) {
      throw new Error(
        "قائمة الحذف فارغة أو أكبر من الحد المسموح"
      );
    }

    ids = ids.map(function(id) {
      return String(id || "").trim();
    });

    if (ids.some(function(id) { return !id; })) {
      throw new Error("توجد معرّفات غير صالحة");
    }

    if (new Set(ids).size !== ids.length) {
      throw new Error(
        "توجد معرّفات مكررة في قائمة الحذف"
      );
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);

    try {
      const currentItems = getPhotoContentItemsForOrder_(
        scope,
        albumId
      );

      const currentIds = new Set(
        currentItems.map(function(item) {
          return String(item.id);
        })
      );

      // التحقق من جميع العناصر قبل حذف أي عنصر.
      if (ids.some(function(id) {
        return !currentIds.has(id);
      })) {
        throw new Error(
          "بعض العناصر المحددة غير موجودة أو لا تنتمي إلى هذا القسم"
        );
      }

      const targets = [];

      if (scope === "albums") {
        const rootFolder = getPhotoAlbumsFolder();

        ids.forEach(function(id) {
          const folder = DriveApp.getFolderById(id);

          if (!isFolderInsideFolder(folder, rootFolder.getId())) {
            throw new Error(
              "أحد الألبومات المحددة خارج مجلد المعرض"
            );
          }

          targets.push({
            id: id,
            item: folder
          });
        });

      } else {
        const parentFolder = scope === "gallery"
          ? getFolder()
          : getPhotoAlbumFolder(albumId);

        const metadata = scope === "albumImages"
          ? getPhotoAlbumMetadata(parentFolder)
          : null;

        ids.forEach(function(id) {
          const file = DriveApp.getFileById(id);

          if (!isFileInsideFolder(file, parentFolder.getId())) {
            throw new Error(
              "إحدى الصور المحددة خارج المجلد المطلوب"
            );
          }

          if (
            scope === "gallery" &&
            !file.getMimeType().startsWith("image/")
          ) {
            throw new Error(
              "أحد الملفات المحددة ليس صورة"
            );
          }

          if (
            scope === "albumImages" &&
            !isImageMimeType(file.getMimeType())
          ) {
            throw new Error(
              "أحد الملفات المحددة ليس صورة صالحة"
            );
          }

          if (
            scope === "albumImages" &&
            metadata.coverFileId === id
          ) {
            throw new Error(
              "لا يمكن حذف غلاف الألبوم ضمن الحذف الجماعي. غيّر الغلاف أولًا."
            );
          }

          targets.push({
            id: id,
            item: file
          });
        });
      }

      // بعد نجاح جميع عمليات التحقق تبدأ عمليات الحذف.
      targets.forEach(function(target) {
        target.item.setTrashed(true);
      });

      const props = PropertiesService.getScriptProperties();
      const orderKey = getPhotoContentOrderKey_(scope, albumId);

      const remainingIds = currentItems
        .map(function(item) {
          return String(item.id);
        })
        .filter(function(id) {
          return ids.indexOf(id) === -1;
        });

      props.setProperty(
        orderKey,
        JSON.stringify(remainingIds)
      );

      /*
       * لا نحذف ترتيب الصور الداخلية للألبومات المحذوفة.
       * نحتاج هذا الترتيب عند استعادة الألبوم.
       */

    } finally {
      lock.releaseLock();
    }

    return photoAlbumPostMessage(p, {