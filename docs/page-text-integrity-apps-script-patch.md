# Apps Script companion patch: page text integrity

**هذه الدوال مخصصة للاستبدال في مشروع Apps Script فقط بعد مطابقتها مع آخر نسخة منشورة من Code.gs.** لا ينفذ هذا الملف أي تعديل على Apps Script أو Drive تلقائيًا.

## التوافق مع Code.gs المراجع

تمت مطابقة أسماء نقاط الربط مع ملف Code.gs المرفوع بتاريخ 16 نوفمبر 2026:
- `getPageChangesFile()`
- `pageChangesPostMessage(p, result)`
- `verifyAdminToken(token)`
- `verifyAdminSession(token)`
- `PAGE_CHANGES_FOLDER` و `PAGE_CHANGES_FILE`
- `PAGE_CHANGES_PRODUCTION_FILE_ID`

يستخدم الحفظ `googleUploadToken` كما ترسله صفحة الموقع، مع دعم `token` للتوافق السابق.

**شرط التفعيل:** يجب أن تكون نسخة HTML المنشورة تحتوي على `meta[name="page-edits-updated-at"]`، وأن ترسل `baseUpdatedAt`. فرع الإصلاح يضيف ذلك. لا تنشر هذه الدوال قبل نشر نسخة HTML المتوافقة أو قبل التأكد من وجود هذا المرجع في الصفحة الحية.

## 1. أضف الدوال المساعدة التالية

```javascript
function validatePageChangesExpectedIds_(changes, expectedIds) {
  if (!Array.isArray(changes) || !Array.isArray(expectedIds) ||
      !changes.length || changes.length !== expectedIds.length ||
      changes.length > 500) {
    throw new Error("قائمة التعديلات أو المعرفات المرجعية غير مكتملة.");
  }

  const expected = new Set();
  expectedIds.forEach(function(id) {
    if (typeof id !== "string" || !id.trim() ||
        id.length > 200 || expected.has(id)) {
      throw new Error("قائمة المعرفات المرجعية تحتوي على قيمة فارغة أو مكررة.");
    }
    expected.add(id);
  });

  const seen = new Set();
  changes.forEach(function(item) {
    if (!item || typeof item.id !== "string" ||
        typeof item.text !== "string" || !item.id.trim() ||
        item.id.length > 200 || item.text.length > 10000 ||
        seen.has(item.id)) {
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

function assertPageChangesBaseUpdatedAt_(baseUpdatedAt, latestUpdatedAt) {
  if (!baseUpdatedAt || !latestUpdatedAt ||
      !Number.isFinite(Date.parse(baseUpdatedAt)) ||
      !Number.isFinite(Date.parse(latestUpdatedAt)) ||
      String(baseUpdatedAt) !== String(latestUpdatedAt)) {
    throw new Error(
      "هذا التبويب يعمل على نسخة قديمة. حدّث الصفحة ثم أعد التعديل والحفظ."
    );
  }
  return true;
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
  const pattern = /data-page-edit-id\s*=\s*["']([^"']+)["']/g;
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
  const backupName = "page-changes-production.backup-" +
    stamp + "-" + Utilities.getUuid().slice(0, 8) + ".json";
  const parents = file.getParents();
  const folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

  return folder.createFile(
    backupName,
    originalContent,
    MimeType.PLAIN_TEXT
  );
}
```

## 2. استبدل getSavedPageChanges() بالكامل

تُبقي هذه الدالة التوافق مع ملف Drive القديم الذي قد لا يحتوي `expectedIds`، لكنها لا تعتبر الملف الفارغ أو التالف قائمة تعديلات فارغة.

```javascript
function getSavedPageChanges() {
  try {
    const file = getPageChangesFile();
    if (file.isTrashed()) {
      throw new Error("ملف التعديلات موجود في سلة المهملات.");
    }

    const raw = file.getBlob().getDataAsString("UTF-8");
    if (!raw || !raw.trim()) {
      throw new Error("ملف التعديلات فارغ.");
    }

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

    if (!data.updatedAt || !Number.isFinite(Date.parse(data.updatedAt))) {
      throw new Error("تاريخ النسخة المحفوظة غير صالح.");
    }

    if (data.expectedIds !== undefined) {
      validatePageChangesExpectedIds_(data.changes, data.expectedIds);
    }

    return {
      success: true,
      changes: data.changes,
      expectedIds: Array.isArray(data.expectedIds) ? data.expectedIds : null,
      updatedAt: data.updatedAt
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

## 3. استبدل savePageChanges(p) بالكامل

الحفظ يقارن `baseUpdatedAt` بأحدث نسخة في Drive **داخل ScriptLock وقبل إنشاء النسخة الجديدة**. كما ينشئ Backup قبل الكتابة، ويتحقق من الاستعادة بإعادة قراءة الملف ومقارنة المحتوى حرفيًا.

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
      !Array.isArray(data.expectedIds) ||
      typeof data.baseUpdatedAt !== "string" ||
      !Number.isFinite(Date.parse(data.baseUpdatedAt))) {
    throw new Error("لم تصل بيانات الحفظ المرجعية كاملة أو أن تاريخ النسخة غير صالح.");
  }

  const canonicalIds = getCanonicalPageEditIdsFromGitHub_();
  const expectedIds = validatePageChangesExpectedIds_(
    data.changes,
    data.expectedIds
  );

  if (expectedIds.length !== canonicalIds.length ||
      canonicalIds.some(function(id) { return !expectedIds.includes(id); })) {
    throw new Error("معرفات المتصفح لا تطابق جميع معرفات النسخة المرجعية الحالية للموقع.");
  }

  validatePageChangesExpectedIds_(data.changes, canonicalIds);

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

  const cleanChanges = data.changes.map(function(item) {
    const isAutoId = /^auto-[0-9a-f]{16}$/.test(item.id);
    if (!isAutoId && !allowedManualIds.includes(item.id)) {
      throw new Error("يوجد معرّف عنصر غير مسموح بتعديله.");
    }
    return { id: item.id, text: item.text };
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  let savedPayload = null;
  let backupFile = null;
  let file = null;
  let originalContent = "";

  try {
    file = getPageChangesFile();
    originalContent = file.getBlob().getDataAsString("UTF-8");
    if (!originalContent || !originalContent.trim()) {
      throw new Error("تعذر أخذ نسخة سليمة من الملف السابق؛ أوقفنا الحفظ.");
    }

    let previous;
    try {
      previous = JSON.parse(originalContent);
    } catch (error) {
      throw new Error("ملف Drive الحالي غير صالح JSON؛ لم نكتب فوقه.");
    }

    if (!previous || previous.success !== true ||
        !Array.isArray(previous.changes) ||
        !previous.updatedAt ||
        !Number.isFinite(Date.parse(previous.updatedAt))) {
      throw new Error("النسخة الحالية في Drive لا تحتوي تاريخًا مرجعيًا صالحًا؛ أوقفنا الحفظ الآمن.");
    }

    assertPageChangesBaseUpdatedAt_(
      data.baseUpdatedAt,
      previous.updatedAt
    );

    validatePageChangesExpectedIds_(previous.changes, canonicalIds);

    backupFile = createPageChangesBackup_(file, originalContent);
    if (!backupFile) {
      throw new Error("تعذر إنشاء النسخة الاحتياطية؛ لم يتم تعديل ملف Drive.");
    }

    savedPayload = {
      success: true,
      changes: cleanChanges,
      expectedIds: canonicalIds,
      // اجعل التاريخ متزايدًا حتى لو حدث حفظان في المللي ثانية نفسها.
      updatedAt: new Date(
        Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)
      ).toISOString()
    };

    try {
      file.setContent(JSON.stringify(savedPayload));

      const verification = getSavedPageChanges();
      if (!verification || verification.success !== true ||
          !Array.isArray(verification.changes)) {
        throw new Error("تعذر إعادة قراءة الملف بعد الحفظ.");
      }

      validatePageChangesExpectedIds_(verification.changes, canonicalIds);

      if (verification.updatedAt !== savedPayload.updatedAt ||
          JSON.stringify(verification.expectedIds) !== JSON.stringify(canonicalIds)) {
        throw new Error("بيانات النسخة المقروءة لا تطابق بيانات النسخة الجديدة.");
      }

      const verified = new Map(
        verification.changes.map(function(item) { return [item.id, item.text]; })
      );
      cleanChanges.forEach(function(item) {
        if (!verified.has(item.id) || verified.get(item.id) !== item.text) {
          throw new Error("فشل التحقق من تطابق النصوص بعد الحفظ.");
        }
      });
    } catch (writeError) {
      let restored = false;
      let restoreDetails = "";

      try {
        file.setContent(originalContent);
        const restoredContent = file.getBlob().getDataAsString("UTF-8");
        restored = restoredContent === originalContent;
        if (!restored) {
          restoreDetails = "أُعيدت الكتابة لكن المحتوى المقروء لا يطابق النسخة الأصلية.";
        }
      } catch (restoreError) {
        restoreDetails = restoreError && restoreError.message
          ? restoreError.message
          : "حدث خطأ غير معروف أثناء الاستعادة.";
      }

      if (!restored) {
        throw new Error(
          "فشل التحقق من الحفظ وفشلت استعادة الملف السابق. " +
          "لا تحاول الحفظ مرة أخرى قبل مراجعة Drive. النسخة الاحتياطية: " +
          (backupFile ? backupFile.getName() : "غير متاحة") +
          ". تفاصيل الاستعادة: " + restoreDetails
        );
      }

      throw new Error(
        "فشل التحقق من الحفظ، لكن تمت استعادة المحتوى السابق والتحقق منه. " +
        "النسخة الاحتياطية: " + backupFile.getName() +
        ". السبب: " + (writeError.message || "خطأ غير معروف")
      );
    }
  } finally {
    lock.releaseLock();
  }

  // المزامنة بعد نجاح التحقق في Drive. الدالة التالية تستخدم القفل أيضًا
  // وتعيد قراءة أحدث نسخة قبل إرسالها إلى GitHub.
  const githubResult = syncPageChangesToGitHub_(savedPayload);

  if (githubResult && githubResult.success === true) {
    return pageChangesPostMessage(p, {
      success: true,
      driveSaved: true,
      githubSynced: true,
      htmlUpdatePending: true,
      updatedAt: savedPayload.updatedAt,
      backupName: backupFile.getName(),
      message: "تم حفظ النصوص والتحقق منها وإرسالها إلى GitHub للمراجعة.",
      count: cleanChanges.length
    });
  }

  return pageChangesPostMessage(p, {
    success: false,
    partialSuccess: true,
    driveSaved: true,
    githubSynced: false,
    htmlUpdatePending: false,
    updatedAt: savedPayload.updatedAt,
    backupName: backupFile.getName(),
    message: "تم حفظ النصوص في Drive والتحقق منها، لكن تعذرت مزامنتها مع GitHub. " +
      (githubResult && githubResult.message ? githubResult.message : ""),
    count: cleanChanges.length
  });
}
```

## 4. استبدل syncPageChangesToGitHub_(savedPayload) بالكامل

**هذه النسخة تحافظ على ScriptLock طوال قراءة Drive وقراءة GitHub والكتابة وإعادة القراءة والتحقق.** لا يتم إرسال نسخة قديمة إذا تغيرت بيانات Drive بين الحفظ وبدء المزامنة.

```javascript
function syncPageChangesToGitHub_(savedPayload) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  let stage = "validate";

  function safeMessage(value) {
    return String(value || "")
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[REDACTED]")
      .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED]")
      .substring(0, 300);
  }

  try {
    if (!savedPayload || !Array.isArray(savedPayload.changes) ||
        !Array.isArray(savedPayload.expectedIds) ||
        !savedPayload.updatedAt) {
      throw new Error("بيانات المزامنة غير مكتملة.");
    }

    stage = "acquire-lock";
    lock.waitLock(20000);
    lockAcquired = true;

    stage = "read-drive";
    const latest = getSavedPageChanges();
    if (!latest || latest.success !== true ||
        !Array.isArray(latest.changes) || !latest.updatedAt) {
      throw new Error("تعذر قراءة أحدث نسخة من Drive.");
    }

    if (latest.updatedAt !== savedPayload.updatedAt ||
        JSON.stringify(latest.changes) !== JSON.stringify(savedPayload.changes)) {
      throw new Error("توجد نسخة أحدث في Drive؛ أوقفنا إرسال نسخة قديمة إلى GitHub.");
    }

    stage = "validate-ids";
    const canonicalIds = getCanonicalPageEditIdsFromGitHub_();
    validatePageChangesExpectedIds_(latest.changes, canonicalIds);
    if (JSON.stringify(savedPayload.expectedIds) !== JSON.stringify(canonicalIds)) {
      throw new Error("قائمة المعرفات المرجعية لا تطابق الصفحة الحالية في GitHub.");
    }

    stage = "read-settings";
    const properties = PropertiesService.getScriptProperties();
    const token = properties.getProperty("GITHUB_PAGE_SYNC_TOKEN");
    const branch = properties.getProperty("GITHUB_PAGE_SYNC_BRANCH");
    if (!token || branch !== "automation/page-text-sync-input") {
      throw new Error("إعدادات GitHub غير مكتملة أو فرع الاستقبال غير صحيح.");
    }

    const repository = "dodydiaa2013-stack/omar-bin-elkhatab-school";
    const filePath = "page-changes-production.json";
    const apiUrl = "https://api.github.com/repos/" + repository + "/contents/" + filePath;
    const headers = {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    stage = "read-github";
    const getOptions = {
      method: "get",
      headers: headers,
      muteHttpExceptions: true
    };
    const current = UrlFetchApp.fetch(
      apiUrl + "?ref=" + encodeURIComponent(branch),
      getOptions
    );

    let currentSha = "";
    if (current.getResponseCode() === 200) {
      currentSha = JSON.parse(current.getContentText()).sha || "";
      if (!currentSha) throw new Error("لم يُرجع GitHub SHA للملف الحالي.");
    } else if (current.getResponseCode() !== 404) {
      throw new Error("فشلت قراءة ملف GitHub. HTTP " + current.getResponseCode());
    }

    stage = "write-github";
    const payloadToSync = {
      success: true,
      changes: latest.changes,
      expectedIds: canonicalIds,
      updatedAt: latest.updatedAt
    };
    const content = JSON.stringify(payloadToSync, null, 2) + "\n";
    const body = {
      message: "Sync verified school page text",
      content: Utilities.base64Encode(
        Utilities.newBlob(content, "application/json").getBytes()
      ),
      branch: branch
    };
    if (currentSha) body.sha = currentSha;

    const put = UrlFetchApp.fetch(apiUrl, {
      method: "put",
      contentType: "application/json",
      headers: headers,
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    if (put.getResponseCode() !== 200 && put.getResponseCode() !== 201) {
      throw new Error("رفض GitHub تحديث الملف. HTTP " + put.getResponseCode());
    }

    stage = "verify-github";
    const verify = UrlFetchApp.fetch(
      apiUrl + "?ref=" + encodeURIComponent(branch),
      getOptions
    );
    if (verify.getResponseCode() !== 200) {
      throw new Error("تعذرت إعادة قراءة ملف GitHub بعد الكتابة. HTTP " + verify.getResponseCode());
    }

    const remote = JSON.parse(verify.getContentText());
    if (remote.encoding !== "base64" || !remote.content) {
      throw new Error("لم يُرجع GitHub محتوى الملف بالشكل المتوقع.");
    }

    const remoteText = Utilities.newBlob(
      Utilities.base64Decode(String(remote.content).replace(/\s/g, ""))
    ).getDataAsString("UTF-8");
    const remotePayload = JSON.parse(remoteText);

    if (JSON.stringify(remotePayload) !== JSON.stringify(payloadToSync)) {
      throw new Error("محتوى GitHub لا يطابق النسخة المحفوظة في Drive.");
    }

    return { success: true };
  } catch (error) {
    const message = safeMessage(error && error.message ? error.message : error);
    console.error("[PageTextGitHubSync] " + stage + ": " + message);
    return {
      success: false,
      message: "تعذرت المزامنة في المرحلة " + stage + ". " + message
    };
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}
```

## ترتيب التطبيق والاختبار

1. راجع آخر نسخة منشورة من Apps Script، وتأكد من مطابقة الدوال المساعدة ونقاط الربط المذكورة أعلى الملف.
2. انشر أولًا نسخة HTML التي تحتوي على `page-edits-updated-at` و`baseUpdatedAt`، أو تحقق من وجودهما بالفعل في الصفحة الحية.
3. أضف الدوال المساعدة، ثم استبدل الدوال الثلاث كاملة: `getSavedPageChanges` و`savePageChanges` و`syncPageChangesToGitHub_`.
4. لا تغيّر `getPageChangesFile()` أو `pageChangesPostMessage()` أو التحقق الثنائي من المسؤول.
5. تأكد من إعداد Script Properties: `GITHUB_PAGE_SYNC_TOKEN` و`GITHUB_PAGE_SYNC_BRANCH=automation/page-text-sync-input`.
6. اختبر نسخة كاملة من 111 معرفًا، ثم 109 معرفات، ومعرفًا مكررًا، ومعرفًا زائدًا، و`baseUpdatedAt` قديمًا. حالات الرفض يجب ألا تغير ملف Drive.
7. اختبر حفظين متزامنين من تبويبين؛ يجب رفض التبويب القديم دون استبدال النص الأحدث.
8. اختبر فشل الكتابة والاستعادة؛ يجب إعادة قراءة الملف ومقارنة محتواه، وإظهار اسم Backup عند تعذر الاستعادة.
9. تحقق من مزامنة GitHub وفتح Draft PR فقط. لا يوجد دمج أو نشر تلقائي.

**حدود التحقق:** فحوص GitHub Actions لا تشغّل Apps Script ولا تختبر Drive. يجب إجراء اختبار runtime على مشروع Apps Script بعد موافقة منفصلة، مع الاحتفاظ بالنسخة الاحتياطية.
