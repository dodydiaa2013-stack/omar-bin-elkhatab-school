# GitHub main to Google Drive page-text synchronization

This patch adds the reverse synchronization path without changing the existing website save or Refresh flows. For an HTML-only text edit, it overlays only IDs whose text differs from the push-base HTML onto the approved JSON snapshot, preserving untouched JSON values. CSS/layout-only changes do not select HTML text as the source. When only page-changes-production.json changes, that JSON is the source. If both files change and HTML text changed, their full ID-to-text maps must match exactly or the workflow refuses to write to Drive. A manual initial sync uses the JSON snapshot.

## Data contract

- page-changes-production.json on main is the canonical repository source for editable page text.
- index.html supplies the canonical set of data-page-edit-id values.
- The workflow runs only after a push to main that changes index.html or page-changes-production.json, or by manual dispatch for the initial synchronization.
- Pull requests and non-main branches never write to Drive.
- The browser's existing savePageChanges request and the current Drive-to-GitHub workflow remain unchanged.

The selected snapshot must contain exactly the unique IDs declared by index.html. The current reviewed snapshot contains 111 IDs. These two ticker IDs are preserved and tested:

- auto-7b3e91c4a62d805f
- auto-c81f4a2d96b7305e

## 1. Update doPost while preserving all current actions

The complete function below is based on the doPost(e) supplied in the current project discussion. Before deployment, compare it once against the latest live Apps Script editor version to catch any newer action added after that copy.

~~~~javascript
function doPost(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  let jsonBody = {};

  const postType = String(e && e.postData && e.postData.type || "").toLowerCase();
  if (postType.indexOf("application/json") !== -1 &&
      e && e.postData && e.postData.contents) {
    try {
      jsonBody = JSON.parse(e.postData.contents);
    } catch (error) {
      return jsonOutput({
        success: false,
        message: "صيغة طلب المزامنة غير صحيحة."
      });
    }
  }

  const action = p.action || jsonBody.action || "";

  try {
    if (action === "syncPageChangesFromGitHub") {
      return jsonOutput(syncPageChangesFromGitHub_(jsonBody));
    }

    if (action === "adminLogin") return adminLogin(p);
    if (action === "adminLogout") return adminLogout(p);
    if (action === "requestPasswordRecovery") return requestPasswordRecovery(p);
    if (action === "verifyPasswordRecoveryCode") return verifyPasswordRecoveryCode(p);
    if (action === "resetAdminPassword") return resetAdminPassword(p);
    if (action === "verifyDeveloperGoogle") return verifyDeveloperGoogle(p);
    if (action === "savePageChanges") return savePageChanges(p);
    if (action === "uploadGalleryImage") return uploadGalleryImage(p);
    if (action === "replaceGalleryImage") return replaceGalleryImage(p);
    if (action === "delete") return deleteGalleryImage(p);
    if (action === "uploadSchedule") return uploadScheduleImage(p);
    if (action === "deleteSchedule") return deleteScheduleImage(p);
    if (action === "bulkDeleteSchedules") return bulkDeleteSchedules(p);
    if (action === "createPhotoAlbum") return createPhotoAlbum(p);
    if (action === "updatePhotoAlbum") return updatePhotoAlbum(p);
    if (action === "uploadPhotoAlbumImage") return uploadPhotoAlbumImage(p);
    if (action === "updatePhotoAlbumCover") return updatePhotoAlbumCover(p);
    if (action === "replacePhotoAlbumImage") return replacePhotoAlbumImage(p);
    if (action === "savePhotoContentOrder") return savePhotoContentOrder(p);
    if (action === "bulkDeletePhotoContent") return bulkDeletePhotoContent(p);
    if (action === "deletePhotoAlbumImage") return deletePhotoAlbumImage(p);
    if (action === "deletePhotoAlbum") return deletePhotoAlbum(p);

    return jsonOutput({
      success: false,
      message: "العملية المطلوبة غير معروفة أو غير مدعومة."
    });
  } catch (error) {
    const message = error.message || "تعذر تنفيذ العملية";

    if (action === "syncPageChangesFromGitHub") {
      return jsonOutput({ success: false, message: message });
    }
    if (action === "adminLogout") return adminLogoutPostMessage(p, { success: false, message });
    if (action === "verifyDeveloperGoogle") return developerGooglePostMessage(p, { success: false, message });
    if (action === "savePageChanges") return pageChangesPostMessage(p, { success: false, message });
    if (action === "uploadSchedule") return scheduleUploadPostMessage(p, { success: false, message });
    if (action === "uploadGalleryImage") return galleryUploadPostMessage(p, { success: false, message });
    if ([
      "createPhotoAlbum",
      "updatePhotoAlbum",
      "uploadPhotoAlbumImage",
      "updatePhotoAlbumCover",
      "replacePhotoAlbumImage",
      "deletePhotoAlbumImage",
      "deletePhotoAlbum",
      "savePhotoContentOrder",
      "bulkDeletePhotoContent"
    ].includes(action)) {
      return photoAlbumPostMessage(p, { success: false, message: message });
    }

    return jsonOutput({ success: false, message: message });
  }
}
~~~~

استبدل دالة doPost الحالية بهذه النسخة الكاملة بعد مطابقتها مع النسخة الحية الأخيرة. جميع مسارات الحفظ والرفع والحذف والألبومات الحالية محفوظة؛ أُضيف فقط تحليل JSON ومسار المزامنة الجديد.

## 2. Append the Apps Script helpers

These helpers rely on existing project functions/constants:
getPageChangesFile(), getSavedPageChanges(), jsonOutput(), and PAGE_CHANGES_FILE.
They write to the same Drive file used by the existing site-save mechanism.

~~~~javascript
function pageTextSha256Hex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(byte) {
    return ("0" + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join("");
}

function pageTextConstantTimeEquals_(left, right) {
  left = String(left || "");
  right = String(right || "");
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

function pageTextChangesMap_(changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 500) {
    throw new Error("قائمة نصوص GitHub فارغة أو غير صالحة.");
  }
  const map = new Map();
  changes.forEach(function(item) {
    if (!item || typeof item.id !== "string" || !item.id.trim() ||
        item.id.length > 200 || typeof item.text !== "string" ||
        item.text.length > 10000 || map.has(item.id)) {
      throw new Error("توجد بيانات نصوص غير صالحة أو معرفات مكررة.");
    }
    map.set(item.id, item.text);
  });
  return map;
}

function pageTextMapsEqual_(left, right) {
  if (left.size !== right.size) return false;
  for (const entry of left.entries()) {
    if (!right.has(entry[0]) || right.get(entry[0]) !== entry[1]) return false;
  }
  return true;
}

function syncPageChangesFromGitHub_(p) {
  p = p || {};
  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty("GITHUB_MAIN_TO_DRIVE_HMAC_SECRET");
  if (!secret) throw new Error("سر مزامنة GitHub غير مضبوط في Script Properties.");

  const ref = String(p.ref || "");
  const timestamp = Number(p.timestamp);
  const nonce = String(p.nonce || "");
  const commitSha = String(p.commitSha || "").toLowerCase();
  const commitTime = Date.parse(String(p.commitTimestamp || ""));
  const payloadRaw = String(p.payloadRaw || "");
  const payloadHash = String(p.payloadHash || "").toLowerCase();
  const expectedIds = p.expectedIds;
  const expectedIdsHash = String(p.expectedIdsHash || "").toLowerCase();
  const signature = String(p.signature || "");

  if (ref !== "refs/heads/main" ||
      !/^[a-f0-9]{40}$/.test(commitSha) ||
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > 5 * 60 * 1000 ||
      !/^[A-Za-z0-9-]{20,80}$/.test(nonce) ||
      !Number.isFinite(commitTime) ||
      !payloadRaw || payloadRaw.length > 100000 ||
      !Array.isArray(expectedIds) || !expectedIds.length ||
      expectedIds.length > 500) {
    throw new Error("بيانات إصدار GitHub أو التوقيت أو المعرفات غير صالحة.");
  }

  const actualPayloadHash = pageTextSha256Hex_(payloadRaw);
  const actualExpectedIdsHash = pageTextSha256Hex_(JSON.stringify(expectedIds));
  if (!pageTextConstantTimeEquals_(payloadHash, actualPayloadHash) ||
      !pageTextConstantTimeEquals_(expectedIdsHash, actualExpectedIdsHash)) {
    throw new Error("فشل التحقق من بصمة بيانات المزامنة.");
  }

  const signedMessage = [
    "syncPageChangesFromGitHub",
    ref,
    String(timestamp),
    nonce,
    commitSha,
    new Date(commitTime).toISOString(),
    actualPayloadHash,
    actualExpectedIdsHash
  ].join("\n");

  const expectedSignature = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(
      signedMessage,
      secret,
      Utilities.Charset.UTF_8
    )
  );
  if (!pageTextConstantTimeEquals_(signature, expectedSignature)) {
    throw new Error("توقيع مزامنة GitHub غير صحيح.");
  }

  let incoming;
  try {
    incoming = JSON.parse(payloadRaw);
  } catch (error) {
    throw new Error("ملف JSON القادم من GitHub غير قابل للقراءة.");
  }
  if (!incoming || incoming.success !== true) {
    throw new Error("بنية ملف التعديلات القادم من GitHub غير صحيحة.");
  }

  const incomingMap = pageTextChangesMap_(incoming.changes);
  const expectedSet = new Set(expectedIds);
  if (expectedSet.size !== expectedIds.length ||
      expectedIds.some(function(id) {
        return typeof id !== "string" || !id.trim() || !incomingMap.has(id);
      }) ||
      incomingMap.size !== expectedSet.size) {
    throw new Error("معرفات JSON لا تطابق معرفات index.html المعتمدة.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const noncePrefix = "GITHUB_MAIN_DRIVE_NONCE_";
    const now = Date.now();
    const storedProperties = properties.getProperties();
    Object.keys(storedProperties).forEach(function(key) {
      if (key.indexOf(noncePrefix) === 0 &&
          now - Number(storedProperties[key] || "0") > 10 * 60 * 1000) {
        properties.deleteProperty(key);
      }
    });
    const nonceKey = noncePrefix + nonce;
    if (properties.getProperty(nonceKey)) {
      throw new Error("تم رفض طلب مزامنة مكرر.");
    }

    const lastCommitTime = Number(
      properties.getProperty("GITHUB_MAIN_TO_DRIVE_LAST_COMMIT_TIME") || "0"
    );
    const lastCommitSha = String(
      properties.getProperty("GITHUB_MAIN_TO_DRIVE_LAST_COMMIT_SHA") || ""
    );
    if (commitTime < lastCommitTime) {
      throw new Error("تم رفض Commit أقدم من آخر نسخة GitHub وصلت إلى Drive.");
    }

    const file = getPageChangesFile();
    const originalRaw = file.getBlob().getDataAsString("UTF-8");
    const current = getSavedPageChanges();
    if (!current || current.success !== true || !Array.isArray(current.changes)) {
      throw new Error("تعذر قراءة نسخة Drive الحالية؛ لم يتم استبدالها.");
    }
    const currentMap = pageTextChangesMap_(current.changes);

    if (commitSha === lastCommitSha && lastCommitSha &&
        !pageTextMapsEqual_(incomingMap, currentMap)) {
      throw new Error("تم رفض إعادة استخدام Commit SHA نفسه بمحتوى مختلف.");
    }

    // Idempotency: site-save may already have sent this exact snapshot to GitHub.
    if (pageTextMapsEqual_(incomingMap, currentMap)) {
      if (commitTime >= lastCommitTime) {
        properties.setProperties({
          GITHUB_MAIN_TO_DRIVE_LAST_COMMIT_TIME: String(commitTime),
          GITHUB_MAIN_TO_DRIVE_LAST_COMMIT_SHA: commitSha
        });
      }
      properties.setProperty(nonceKey, String(Date.now()));
      return {
        success: true,
        status: "already-current",
        count: incomingMap.size,
        updatedAt: current.updatedAt || null,
        commitSha: commitSha
      };
    }

    const currentTime = Date.parse(current.updatedAt || "");
    if (current.changes.length && !Number.isFinite(currentTime)) {
      throw new Error("نسخة Drive الحالية لا تحمل updatedAt صالحًا. يلزم فحصها يدويًا قبل الاستبدال.");
    }
    if (Number.isFinite(currentTime) && commitTime <= currentTime) {
      throw new Error("تم رفض نسخة GitHub لأنها ليست أحدث من نسخة Drive الحالية.");
    }
    if (commitTime === lastCommitTime && lastCommitSha && lastCommitSha !== commitSha) {
      throw new Error("تعارض إصدار: Commit مختلف يحمل توقيت آخر نسخة مطبقة.");
    }

    const parents = file.getParents();
    if (!parents.hasNext()) {
      throw new Error("تعذر تحديد مجلد ملف Drive لإنشاء نسخة احتياطية.");
    }
    const backupName =
      PAGE_CHANGES_FILE + ".backup-" +
      Utilities.formatDate(new Date(), "UTC", "yyyyMMdd'T'HHmmss'Z'") +
      "-" + commitSha.slice(0, 8);
    const backup = file.makeCopy(backupName, parents.next());

    const savedPayload = {
      success: true,
      changes: incoming.changes,
      updatedAt: new Date(commitTime).toISOString()
    };

    try {
      file.setContent(JSON.stringify(savedPayload));
      const verification = getSavedPageChanges();
      if (!verification || verification.success !== true ||
          !Array.isArray(verification.changes)) {
        throw new Error("تعذرت إعادة قراءة ملف Drive بعد المزامنة.");
      }
      const verifiedMap = pageTextChangesMap_(verification.changes);
      if (!pageTextMapsEqual_(incomingMap, verifiedMap) ||
          Date.parse(verification.updatedAt || "") !== commitTime) {
        throw new Error("فشل التحقق من تطابق نسخة Drive بعد الكتابة.");
      }
    } catch (writeError) {
      file.setContent(originalRaw);
      throw writeError;
    }

    properties.setProperties({
      GITHUB_MAIN_TO_DRIVE_LAST_COMMIT_TIME: String(commitTime),
      GITHUB_MAIN_TO_DRIVE_LAST_COMMIT_SHA: commitSha
    });
    properties.setProperty(nonceKey, String(Date.now()));

    return {
      success: true,
      status: "updated",
      count: incomingMap.size,
      updatedAt: savedPayload.updatedAt,
      backupFileId: backup.getId(),
      commitSha: commitSha
    };
  } finally {
    lock.releaseLock();
  }
}
~~~~

## 3. Configure secrets

Create one random secret of at least 32 random bytes. Store the same value in both places; never put it in repository source.

Apps Script → Project Settings → Script Properties:
- GITHUB_MAIN_TO_DRIVE_HMAC_SECRET = the random secret.

GitHub repository → Settings → Secrets and variables → Actions:
- APPS_SCRIPT_SYNC_URL = the existing deployed Apps Script Web App URL.
- APPS_SCRIPT_SYNC_HMAC_SECRET = the same random secret.

Update the existing Apps Script Web App deployment to a new version after adding the route and helpers. Keep its existing deployment URL and all existing actions. The HMAC signature authenticates this new server-to-server action.

## 4. Initial synchronization

After the Apps Script update and both GitHub secrets are configured:

1. Open GitHub Actions.
2. Run “Sync approved repository page text to Google Drive” manually against main.
3. Confirm the workflow succeeds and reports 111 IDs.
4. Confirm the Drive JSON contains both ticker IDs and their exact text.
5. Reload the school site and verify it displays the Drive version.

The first overwrite creates a timestamped backup beside the existing Drive JSON. If the existing Drive file has no valid updatedAt and contains data, the endpoint refuses to overwrite it; inspect that file first.

## 5. Refresh behavior

This PR must not replace, redesign, or independently alter the existing Refresh mechanism. The current index.html implementation remains byte-for-byte unchanged in the relevant DOMContentLoaded, receivePageChanges, loadSavedPageChanges, and applyCachedPageChanges functions. The sync change is server-side/repository-side only. The tests compare these functions against origin/main so later edits in this PR cannot silently change the established refresh behavior.

## 6. Intentionally unchanged

- saveAllPageChanges() and its existing savePageChanges form request.
- Admin password + authorized Google verification.
- Existing savePageChanges(p) Apps Script handler.
- Existing Drive-to-GitHub synchronization branch and workflow.
- Website layout, section structure, the existing Refresh implementation, and all 111 page edit IDs.
- The text extraction contract used by the website: element.textContent.trim().

No deployment or merge is performed by this patch. Apps Script deployment and initial workflow dispatch require the repository owner to configure the secret and deploy the updated Apps Script version.


## 7. Source selection and change detection

The workflow checks the exact files changed between the push's before-SHA and current SHA (not only the last commit). It then selects the snapshot as follows:

- index.html with actual editable-text changes and no JSON change: compare against push-base HTML, then overlay only changed IDs onto the approved JSON map; all untouched IDs retain their JSON values.
- page-changes-production.json only: use the JSON changes array, after validating exact ID coverage.
- both files: if editable HTML text also changed, compare every ID and text exactly; any conflict stops before the Apps Script request. If index.html changed only for layout/CSS and its editable text is unchanged, JSON remains the source.
- workflow_dispatch: use the JSON snapshot for the initial synchronization.

The workflow path filter includes both supported files. It checks out full history only to compute the push diff, and still sends only the exact approved main commit. It never sends a pull-request or feature-branch snapshot to Drive.

The PR deliberately restores index.html to the current main version. It does not modify the existing Refresh functions or the current website save flow. Future direct text edits to index.html on main will be picked up by the workflow after this change is merged.
