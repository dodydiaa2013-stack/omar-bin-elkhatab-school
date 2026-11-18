# Apps Script companion patch: page text integrity

**Apply this patch to the deployed Apps Script project only after reviewing the current live Code.gs.**
This patch is intentionally separate from the website branch because Apps Script is not stored in this repository and cannot be deployed from this workflow.

## What this patch changes

- Requires the browser to send both `changes` and the complete `expectedIds` list.
- Compares both lists against the edit IDs currently present in `main/index.html`.
- Creates a timestamped backup in the same Drive folder before replacing the JSON.
- Verifies every ID and text after writing; restores the original content if verification fails.
- Syncs only the verified Drive snapshot to `automation/page-text-sync-input`.
- Reports Drive success separately from GitHub sync success.
- Does not merge or publish the resulting pull request.

## 1. Add these helper functions

```javascript
function validatePageChangesExpectedIds_(changes, expectedIds) {
  if (!Array.isArray(changes) || !Array.isArray(expectedIds) ||
      !changes.length || changes.length !== expectedIds.length ||
      changes.length > 500) {
    throw new Error("قائمة التعديلات أو المعرفات المرجعية غير مكتملة.");
  }

  const expected = new Set();
  expectedIds.forEach(function(id) {
    if (typeof id !== "string" || !id.trim() || id.length > 200 || expected.has(id)) {
      throw new Error("قائمة المعرفات المرجعية تحتوي على قيمة فارغة أو مكررة.");
    }
    expected.add(id);
  });

  const seen = new Set();
  changes.forEach(function(item) {
    if (!item || typeof item.id !== "string" ||
        typeof item.text !== "string" || item.id.length > 200 ||
        item.text.length > 10000 || seen.has(item.id)) {
      throw new Error("قائمة النصوص تحتوي على عنصر غير صالح أو معرف مكرر.");
    }
    seen.add(item.id);
  });

  if (seen.size !== expected.size ||
      Array.from(expected).some(function(id) { return !seen.has(id); })) {
    throw new Error("قائمة النصوص لا تطابق جميع معرفات الصفحة.");
  }

  return expectedIds.slice();
}

function getCanonicalPageEditIdsFromGitHub_() {
  const url = "https://raw.githubusercontent.com/dodydiaa2013-stack/omar-bin-elkhatab-school/main/index.html";
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: { "Cache-Control": "no-cache" }
  });

  if (response.getResponseCode() !== 200) {
    throw new Error("تعذر قراءة قائمة معرفات الصفحة المرجعية من GitHub.");
  }

  const html = response.getContentText("UTF-8");
  const ids = [];
  const seen = new Set();
  const pattern = /data-page-edit-id\\s*=\\s*["']([^"']+)["']/g;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    const id = String(match[1] || "").trim();
    if (!id || id.length > 200 || seen.has(id)) {
      throw new Error("الصفحة المرجعية تحتوي على معرف فارغ أو مكرر.");
    }
    seen.add(id);
    ids.push(id);
  }

  if (!ids.length || ids.length > 500) {
    throw new Error("عدد معرفات الصفحة المرجعية غير صحيح.");
  }
  return ids;
}

function createPageChangesBackup_(file, originalContent) {
  const stamp = Utilities.formatDate(
    new Date(),
    "UTC",
    "yyyyMMdd'T'HHmmss'Z'"
  );
  const backupName = "page-changes-production.backup-" + stamp + ".json";
  const parents = file.getParents();
  const folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  return folder.createFile(
    backupName,
    originalContent,
    MimeType.PLAIN_TEXT
  );
}
```

## 2. Replace getSavedPageChanges completely

```javascript
function getSavedPageChanges() {
  try {
    const file = getPageChangesFile();
    if (file.isTrashed()) throw new Error("ملف التعديلات موجود في سلة المهملات.");

    const raw = file.getBlob().getDataAsString("UTF-8");
    if (!raw || !raw.trim()) throw new Error("ملف التعديلات فارغ.");

    const data = JSON.parse(raw);
    if (!data || data.success !== true || !Array.isArray(data.changes)) {
      throw new Error("بنية ملف التعديلات غير صحيحة.");
    }

    const seen = new Set();
    data.changes.forEach(function(item) {
      if (!item || typeof item.id !== "string" ||
          typeof item.text !== "string" || !item.id.trim() ||
          item.id.length > 200 || item.text.length > 10000 ||
          seen.has(item.id)) {
        throw new Error("توجد بيانات غير صحيحة أو معرفات مكررة.");
      }
      seen.add(item.id);
    });

    return {
      success: true,
      changes: data.changes,
      expectedIds: Array.isArray(data.expectedIds) ? data.expectedIds : null,
      updatedAt: data.updatedAt || null
    };
  } catch (error) {
    console.error("خطأ استرجاع تعديلات الموقع: " + error.message);
    return {
      success: false,
      message: "تعذر قراءة تعديلات الموقع المحفوظة؛ لم يتم اعتبارها قائمة فارغة."
    };
  }
}
```

## 3. Replace savePageChanges completely

```javascript
function savePageChanges(p) {
  p = p || {};
  verifyAdminToken(p.googleUploadToken || p.token || "");
  verifyAdminSession(p.adminSessionToken || "");

  const rawChanges = p.changes || "";
  if (!rawChanges || rawChanges.length > 100000) {
    throw new Error("بيانات التعديلات فارغة أو أكبر من الحجم المسموح.");
  }

  let data;
  try {
    data = JSON.parse(rawChanges);
  } catch (error) {
    throw new Error("صيغة بيانات التعديلات غير صحيحة.");
  }

  if (!data || !Array.isArray(data.changes) ||
      !Array.isArray(data.expectedIds)) {
    throw new Error("لم تصل قائمة النصوص وقائمة المعرفات المرجعية معًا.");
  }

  const expectedIds = validatePageChangesExpectedIds_(
    data.changes,
    data.expectedIds
  );
  const canonicalIds = getCanonicalPageEditIdsFromGitHub_();
  validatePageChangesExpectedIds_(
    data.changes,
    canonicalIds
  );

  if (expectedIds.length !== canonicalIds.length ||
      canonicalIds.some(function(id) { return !expectedIds.includes(id); })) {
    throw new Error("معرفات المتصفح لا تطابق النسخة المرجعية الحالية للموقع.");
  }

  const cleanChanges = data.changes.map(function(item) {
    const isAutoId = /^auto-[0-9a-f]{16}$/.test(item.id);
    const allowedManualIds = [
      "school-title", "school-administration", "home-title",
      "home-vision-text", "home-mission-text", "results-card-title",
      "results-card-description", "support-card-title",
      "support-card-description", "schedules-card-title",
      "schedules-card-description", "tablet-title", "tablet-description",
      "server-title", "tablet-support-title", "schedules-title",
      "schedules-description", "alerts-title", "alerts-description",
      "republic-header", "academic-year", "header-manager", "home-intro",
      "footer-leadership", "footer-school-name", "quick-links-title",
      "quick-results-link", "quick-tablet-link", "quick-schedules-link",
      "quick-gallery-link", "quick-student-queries-link",
      "quick-leaders-link", "support-section-title", "footer-manager",
      "support-responsibles-title", "support-diaa-name", "support-mona-name",
      "motto-tablet-title", "motto-tablet-description", "motto-dev-title",
      "motto-dev-description", "student-queries-title",
      "student-queries-description", "student-query-one-title",
      "student-query-two-title", "server-tip-1", "server-tip-2",
      "server-tip-3", "server-tip-4", "tablet-support-tip-1",
      "tablet-support-tip-2", "tablet-support-tip-3", "tablet-support-tip-4",
      "ticker-message-1", "ticker-message-2", "ticker-message-3",
      "ticker-message-4"
    ];
    if (!isAutoId && !allowedManualIds.includes(item.id)) {
      throw new Error("يوجد معرّف عنصر غير مسموح بتعديله.");
    }
    return { id: item.id, text: item.text };
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  let savedPayload;
  let file;
  let originalContent = "";
  let backupFile = null;

  try {
    file = getPageChangesFile();
    originalContent = file.getBlob().getDataAsString("UTF-8");
    if (!originalContent || !originalContent.trim()) {
      throw new Error("تعذر أخذ نسخة سليمة من الملف السابق؛ أوقفنا الحفظ.");
    }

    backupFile = createPageChangesBackup_(file, originalContent);

    savedPayload = {
      success: true,
      changes: cleanChanges,
      expectedIds: canonicalIds,
      updatedAt: new Date().toISOString()
    };

    try {
      file.setContent(JSON.stringify(savedPayload));

      const verification = getSavedPageChanges();
      if (!verification || verification.success !== true ||
          !Array.isArray(verification.changes)) {
        throw new Error("تعذر إعادة قراءة الملف بعد الحفظ.");
      }

      validatePageChangesExpectedIds_(
        verification.changes,
        canonicalIds
      );

      if (verification.changes.length !== cleanChanges.length) {
        throw new Error("عدد النصوص بعد الحفظ لا يطابق العدد المرسل.");
      }

      const verified = new Map(
        verification.changes.map(function(item) { return [item.id, item.text]; })
      );
      cleanChanges.forEach(function(item) {
        if (!verified.has(item.id) || verified.get(item.id) !== item.text) {
          throw new Error("فشل التحقق من تطابق النصوص بعد الحفظ.");
        }
      });

      if (verification.updatedAt !== savedPayload.updatedAt) {
        throw new Error("تاريخ النسخة المقروءة لا يطابق النسخة التي تم حفظها.");
      }
    } catch (writeError) {
      try {
        file.setContent(originalContent);
      } catch (restoreError) {
        console.error(
          "فشل استرجاع المحتوى السابق. احتفظ بنسخة Drive الاحتياطية: " +
          (backupFile ? backupFile.getName() : "غير متاحة") +
          ". سبب الاستعادة: " + restoreError.message
        );
      }
      throw writeError;
    }
  } finally {
    lock.releaseLock();
  }

  const githubResult = syncPageChangesToGitHub_(savedPayload);
  if (githubResult && githubResult.success === true) {
    return pageChangesPostMessage(p, {
      success: true,
      driveSaved: true,
      githubSynced: true,
      message: "تم حفظ النصوص والتحقق منها وإرسالها إلى GitHub للمراجعة.",
      count: cleanChanges.length,
      backupName: backupFile ? backupFile.getName() : ""
    });
  }

  return pageChangesPostMessage(p, {
    success: false,
    partialSuccess: true,
    driveSaved: true,
    githubSynced: false,
    message: "تم حفظ النصوص في Drive والتحقق منها، لكن تعذرت مزامنتها مع GitHub. " +
      (githubResult && githubResult.message ? githubResult.message : ""),
    count: cleanChanges.length,
    backupName: backupFile ? backupFile.getName() : ""
  });
}
```

## 4. Add the GitHub sync function

Set these Script Properties before enabling sync:
- `GITHUB_PAGE_SYNC_TOKEN`: a fine-grained token with Contents: Read and write for this repository.
- `GITHUB_PAGE_SYNC_BRANCH`: exactly `automation/page-text-sync-input`.

```javascript
function syncPageChangesToGitHub_(savedPayload) {
  try {
    const latest = getSavedPageChanges();
    if (!latest || latest.success !== true || !Array.isArray(latest.changes)) {
      throw new Error("تعذر قراءة أحدث نسخة من Drive.");
    }

    const canonicalIds = getCanonicalPageEditIdsFromGitHub_();
    validatePageChangesExpectedIds_(latest.changes, canonicalIds);

    if (savedPayload.updatedAt !== latest.updatedAt ||
        JSON.stringify(savedPayload.changes) !== JSON.stringify(latest.changes)) {
      throw new Error("تغير ملف Drive بعد التحقق؛ أوقفنا إرسال نسخة قديمة.");
    }

    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty("GITHUB_PAGE_SYNC_TOKEN");
    const branch = props.getProperty("GITHUB_PAGE_SYNC_BRANCH");
    if (!token || branch !== "automation/page-text-sync-input") {
      throw new Error("إعدادات GitHub غير مكتملة أو فرع الاستقبال غير صحيح.");
    }

    const repository = "dodydiaa2013-stack/omar-bin-elkhatab-school";
    const path = "page-changes-production.json";
    const api = "https://api.github.com/repos/" + repository + "/contents/" + path;
    const headers = {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    const getOptions = { method: "get", headers: headers, muteHttpExceptions: true };
    const current = UrlFetchApp.fetch(api + "?ref=" + encodeURIComponent(branch), getOptions);
    let sha = "";
    if (current.getResponseCode() === 200) {
      sha = JSON.parse(current.getContentText()).sha || "";
      if (!sha) throw new Error("لم يُرجع GitHub SHA للملف الحالي.");
    } else if (current.getResponseCode() !== 404) {
      throw new Error("فشلت قراءة ملف GitHub. HTTP " + current.getResponseCode());
    }

    const content = JSON.stringify({
      success: true,
      changes: latest.changes,
      expectedIds: canonicalIds,
      updatedAt: latest.updatedAt
    }, null, 2) + "\n";
    const body = {
      message: "Sync verified school page text",
      content: Utilities.base64Encode(
        Utilities.newBlob(content, "application/json").getBytes()
      ),
      branch: branch
    };
    if (sha) body.sha = sha;

    const put = UrlFetchApp.fetch(api, {
      method: "put",
      contentType: "application/json",
      headers: headers,
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    if (put.getResponseCode() !== 200 && put.getResponseCode() !== 201) {
      throw new Error("رفض GitHub تحديث الملف. HTTP " + put.getResponseCode());
    }

    const verify = UrlFetchApp.fetch(api + "?ref=" + encodeURIComponent(branch), getOptions);
    if (verify.getResponseCode() !== 200) {
      throw new Error("تعذرت إعادة قراءة ملف GitHub بعد الكتابة.");
    }
    const remote = JSON.parse(verify.getContentText());
    const remoteText = Utilities.newBlob(
      Utilities.base64Decode(String(remote.content || "").replace(/\\s/g, ""))
    ).getDataAsString("UTF-8");
    const remotePayload = JSON.parse(remoteText);

    if (remotePayload.updatedAt !== latest.updatedAt ||
        JSON.stringify(remotePayload.changes) !== JSON.stringify(latest.changes) ||
        JSON.stringify(remotePayload.expectedIds) !== JSON.stringify(canonicalIds)) {
      throw new Error("محتوى GitHub لا يطابق النسخة المحفوظة في Drive.");
    }

    return { success: true };
  } catch (error) {
    console.error("فشل مزامنة نصوص الصفحة مع GitHub: " + error.message);
    return { success: false, message: error.message };
  }
}
```

## Deployment and test order

1. Review the deployed Apps Script project and confirm it still has `getPageChangesFile`, `pageChangesPostMessage`, `verifyAdminToken`, and `verifyAdminSession`.
2. Add the helpers and replace the two complete functions above.
3. Configure the GitHub Script Properties, if they are not already present.
4. Deploy a new Apps Script version.
5. Test a full page save (current `main` has 111 edit IDs). Confirm Drive backup, Drive verification, and GitHub input-branch verification.
6. Test a 109-item payload, one missing ID, a duplicate ID, and a changed text. All incomplete/duplicate cases must be rejected before Drive is modified.
7. Confirm the workflow opens a **draft PR only**. It must not merge or publish.
8. Do not overwrite the existing 109-item JSON export. It is retained as evidence and is rejected as incomplete until a full verified save is made.

**Important:** this patch is for the Apps Script project, not for `index.html`. Do not paste it into the website repository or deploy it without reviewing the currently deployed Apps Script version first.
