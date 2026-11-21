(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const endpoint = () => typeof GOOGLE_SCRIPT_URL === 'string' ? GOOGLE_SCRIPT_URL : '';
  const allowedRatios = ['5/6', '3/4', '4/5', '1/1', '4/3'];
  const ratioValue = value => allowedRatios.includes(value) ? value : '5/6';

  const state = {
    file: null,
    objectUrl: '',
    originalSrc: '',
    zoom: 1,
    brightness: 100,
    aspectRatio: '5/6',
    savedAspectRatio: '5 / 6',
    saving: false,
    loadGeneration: 0
  };

  function status(message, error) {
    const el = $('heroImageEditorStatus');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.error = error ? 'true' : 'false';
  }

  function authorized() {
    try {
      return typeof hasDualAdminAuthorization === 'function' &&
        hasDualAdminAuthorization() === true;
    } catch (_) {
      return false;
    }
  }

  function setControlsDisabled(disabled) {
    ['heroImageAspect', 'heroImageZoom', 'heroImageBrightness', 'heroImageReset']
      .forEach(id => {
        const control = $(id);
        if (control) control.disabled = disabled;
      });
  }

  function resetControlValues() {
    state.zoom = 1;
    state.brightness = 100;
    if ($('heroImageZoom')) $('heroImageZoom').value = '1';
    if ($('heroImageBrightness')) $('heroImageBrightness').value = '100';
  }

  function setSavedAspectFromImage(img) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    state.savedAspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
    if (!state.file) {
      const stage = $('schoolEntranceStage');
      if (stage) stage.style.aspectRatio = state.savedAspectRatio;
    }
  }

  function updatePreview() {
    const stage = $('schoolEntranceStage');
    const img = $('schoolEntranceImage');
    if (!stage || !img) return;

    stage.style.aspectRatio = state.aspectRatio.replace('/', ' / ');
    img.style.transform = 'scale(' + state.zoom + ')';
    img.style.filter = 'brightness(' + state.brightness + '%)';
  }

  function cancelSelection() {
    // لا تلمس مصدر الصورة المعروضة عند فتح الصفحة أو تحديث الصلاحيات.
    // استعادة المصدر مطلوبة فقط إذا كان المستخدم قد اختار معاينة محلية بالفعل.
    const hadSelection = !!state.file;

    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
    state.file = null;

    const img = $('schoolEntranceImage');
    if (img) {
      img.onload = null;
      img.onerror = null;
      img.style.transform = '';
      img.style.filter = '';
      img.style.objectFit = '';

      // تجنب إعادة طلب الصورة نفسها؛ أعد المصدر فقط بعد إلغاء معاينة محلية.
      if (hadSelection && state.originalSrc &&
          !isSameDisplayedImage(img, state.originalSrc)) {
        setResponsiveImageSource(img, state.originalSrc);
      }
    }

    resetControlValues();
    setControlsDisabled(true);

    const stage = $('schoolEntranceStage');
    if (stage) stage.style.aspectRatio = state.savedAspectRatio;
  }

  function refreshAuthorization() {
    const ok = authorized();
    const trigger = $('heroImageEditTrigger');
    const editor = $('heroImageEditor');

    if (trigger) trigger.hidden = !ok;

    if (!ok && editor) {
      editor.hidden = true;
      cancelSelection();
    }
  }

  window.refreshHeroImageEditorAuthorization = refreshAuthorization;

  function fileFromBase64(data, fileName, mimeType) {
    const binary = atob(String(data || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], fileName || 'school-entrance-current.jpg', {
      type: mimeType || 'image/jpeg',
      lastModified: Date.now()
    });
  }

  function chooseFile(file) {
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      status('اختر صورة JPG أو PNG أو WebP.', true);
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      status('حجم الصورة يجب ألا يتجاوز 15 ميجابايت.', true);
      return;
    }

    // أبطل أي استجابة قديمة بدأت قبل اختيار الصورة الجديدة.
    state.loadGeneration++;
    cancelSelection();
    state.file = file;
    state.aspectRatio = '5/6';
    $('schoolEntranceImage').style.objectFit = 'cover';

    if ($('heroImageAspect')) $('heroImageAspect').value = state.aspectRatio;
    setControlsDisabled(false);

    state.objectUrl = URL.createObjectURL(file);
    const img = $('schoolEntranceImage');
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');

    img.onload = () => {
      updatePreview();

      if (img.naturalWidth < 900 || img.naturalHeight < 900) {
        status('الصورة جاهزة، لكن دقتها منخفضة نسبيًا؛ قد تتأثر الجودة عند التكبير.', false);
      } else {
        status('الصورة جاهزة. اضبط الأبعاد والتكبير والإضاءة، ثم راجع المعاينة قبل الحفظ.', false);
      }
    };

    img.onerror = () => status('تعذر فتح الصورة المختارة. جرّب صورة أخرى.', true);
    img.src = state.objectUrl;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('تعذرت قراءة الصورة المختارة.'));
      };

      img.src = url;
    });
  }

  function toBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob
          ? resolve(blob)
          : reject(new Error('تعذر تجهيز الصورة النهائية.')),
        'image/jpeg',
        quality
      );
    });
  }

  async function prepareImage() {
    if (!state.file) throw new Error('لم يتم تحميل صورة للتحرير بعد.');

    const source = await loadImage(state.file);
    const parts = ratioValue(state.aspectRatio).split('/').map(Number);

    const width = 1200;
    const height = Math.round(width * parts[1] / parts[0]);
    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('تعذر إنشاء الصورة النهائية.');

    ctx.fillStyle = '#071b43';
    ctx.fillRect(0, 0, width, height);

    const scale = Math.max(
      width / source.naturalWidth,
      height / source.naturalHeight
    ) * state.zoom;

    const drawWidth = source.naturalWidth * scale;
    const drawHeight = source.naturalHeight * scale;
    const x = (width - drawWidth) / 2;
    const y = (height - drawHeight) / 2;

    ctx.filter = 'brightness(' + state.brightness + '%)';
    ctx.drawImage(source, x, y, drawWidth, drawHeight);
    ctx.filter = 'none';

    let blob = await toBlob(canvas, 0.92);
    if (blob.size > 3.8 * 1024 * 1024) blob = await toBlob(canvas, 0.84);
    if (blob.size > 3.8 * 1024 * 1024) blob = await toBlob(canvas, 0.76);

    if (blob.size > 4 * 1024 * 1024) {
      throw new Error('الصورة الناتجة أكبر من 4 ميجابايت. اختر صورة أصغر أو قلل التكبير.');
    }

    return blob;
  }

  function base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('تعذر تجهيز الصورة للإرسال.'));
      reader.readAsDataURL(blob);
    });
  }

  function post(fields, action, responseType, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!endpoint()) {
        reject(new Error('رابط خادم الموقع غير متاح.'));
        return;
      }

      const nonce = 'hero-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const frame = document.createElement('iframe');
      const form = document.createElement('form');
      const target = 'heroFrame_' + nonce.replace(/[^a-zA-Z0-9_]/g, '');

      frame.name = target;
      frame.hidden = true;
      form.method = 'POST';
      form.action = endpoint();
      form.target = target;
      form.hidden = true;

      // يحافظ على عقد Apps Script الحالي؛ أبعاد الصورة الفعلية محفوظة داخل ملف JPEG نفسه.
      const config = {
        version: 1,
        aspectRatio: '5:6',
        profiles: {
          desktop: { zoom: 1, x: 0, y: 0, brightness: 100 },
          mobile: { zoom: 1, x: 0, y: 0, brightness: 100 }
        }
      };

      const payload = Object.assign({
        action: action || 'saveHeroImage',
        environment: 'PRODUCTION',
        nonce: nonce,
        token: typeof googleUploadToken !== 'undefined' ? googleUploadToken : '',
        adminSessionToken: window.adminSessionToken || '',
        origin: location.origin,
        displayConfig: JSON.stringify(config)
      }, fields || {});

      Object.entries(payload).forEach(([name, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = String(value == null ? '' : value);
        form.appendChild(input);
      });

      let settled = false;

      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        form.remove();
        frame.remove();
      };

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };

      const onMessage = event => {
        if (
          typeof isTrustedAppsScriptMessage !== 'function' ||
          !isTrustedAppsScriptMessage(event, frame.contentWindow)
        ) return;

        const message = event.data;
        if (!message || message.type !== (responseType || 'heroImageSaveResult') || message.nonce !== nonce) return;

        if (message.result && message.result.success) {
          finish(resolve, message.result);
        } else {
          finish(reject, new Error(
            message.result && message.result.message || 'لم يتم حفظ الصورة.'
          ));
        }
      };

      const timer = setTimeout(
        () => finish(reject, new Error(action === 'getHeroImageForEditor'
          ? 'لم تصل الصورة الحالية من الخادم. حاول مرة أخرى.'
          : 'لم يصل تأكيد الحفظ من الخادم.')),
        Number(timeoutMs) > 0 ? Number(timeoutMs) : 90000
      );

      window.addEventListener('message', onMessage);
      document.body.append(frame, form);
      form.submit();
    });
  }

  function getDriveImageFileId(value) {
    if (!value) return '';
    try {
      const url = new URL(value, window.location.href);
      return url.searchParams.get('id') ||
        url.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
        '';
    } catch (_) {
      return '';
    }
  }

  function setResponsiveImageSource(img, source) {
    if (!img || !source) return;

    const fileId = getDriveImageFileId(source);
    if (!fileId) {
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.src = source;
      return;
    }

    const base = 'https://drive.google.com/thumbnail?id=' +
      encodeURIComponent(fileId);

    img.srcset = [
      base + '&sz=w640 640w',
      base + '&sz=w960 960w',
      base + '&sz=w1200 1200w'
    ].join(', ');

    // يتبع حجم العرض المسجل في PageSpeed، مع اختيار نسخة أدق للشاشات عالية الكثافة.
    img.sizes = '(max-width: 456px) calc(100vw - 1.6rem), 430px';
    img.src = source;
  }

  function isSameDisplayedImage(img, nextSrc) {
    if (!img || !nextSrc) return false;

    const currentSrc = img.getAttribute('src') || img.src || '';
    if (currentSrc === nextSrc) return true;

    const currentId = getDriveImageFileId(currentSrc);
    const nextId = getDriveImageFileId(nextSrc);

    // روابط Drive قد تختلف في الحجم أو الصيغة مع أنها تشير إلى الملف نفسه.
    if (currentId && nextId && currentId === nextId) {
      // لا تعِد بدء طلب صورة ما زالت تُحمّل أو اكتمل تحميلها بنجاح.
      return !img.complete || img.naturalWidth > 0;
    }

    return false;
  }

  function loadSavedImage() {
    if (!endpoint()) return;

    // كل طلب يحمل رقم جيل؛ لا يُسمح لرد قديم بتغيير صورة أحدث.
    const requestGeneration = ++state.loadGeneration;

    const callback = 'heroImageCallback_' + Date.now() + '_' +
      Math.random().toString(36).slice(2);

    let settled = false;
    const script = document.createElement('script');

    const cleanup = () => {
      script.remove();
      try {
        delete window[callback];
      } catch (_) {
        window[callback] = undefined;
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      console.warn('تعذر تحميل صورة المدخل المحفوظة.');
    }, 15000);

    window[callback] = data => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();

      if (requestGeneration !== state.loadGeneration || state.file) return;
      if (data && data.success && data.image) {
        const img = $('schoolEntranceImage');
        state.originalSrc = data.image;

        // لا تعِد تعيين src إذا كانت الصورة الابتدائية هي الملف المحفوظ نفسه.
        // هذا يمنع إيقاف الطلب الأول وإظهار مساحة فارغة أثناء إعادة التحميل.
        if (img && !isSameDisplayedImage(img, data.image)) {
          setResponsiveImageSource(img, data.image);
        }
      }
    };

    script.src = endpoint() + '?action=heroImageConfig&environment=PRODUCTION&callback=' +
      encodeURIComponent(callback) + '&_=' + Date.now();

    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
    };

    document.head.appendChild(script);
  }

  async function save() {
    if (state.saving) return;

    if (!authorized()) {
      status('يلزم تحقق الإدارة بكلمة المرور وحساب Google المعتمد.', true);
      refreshAuthorization();
      return;
    }

    if (!state.file) {
      status('حمّل الصورة الحالية أو اختر صورة جديدة قبل الحفظ.', true);
      return;
    }

    // إبطال طلب إعدادات الصورة الذي بدأ عند فتح الصفحة قبل بدء الحفظ.
    state.loadGeneration++;
    state.saving = true;
    const button = $('heroImageSave');
    if (button) button.disabled = true;
    if ($('heroImageChooseButton')) $('heroImageChooseButton').disabled = true;
    if ($('heroImageCancelSelection')) $('heroImageCancelSelection').disabled = true;
    if ($('heroImageClose')) $('heroImageClose').disabled = true;
    setControlsDisabled(true);

    status('جارٍ تجهيز الصورة بالإعدادات المختارة وحفظها...', false);

    try {
      const blob = await prepareImage();
      const data = await base64(blob);
      const result = await post({
        fileName: 'school-entrance-' + Date.now() + '.jpg',
        mimeType: 'image/jpeg',
        data: data
      });

      if (result.image) {
        state.originalSrc = result.image;
        const img = $('schoolEntranceImage');

        if (img) {
          img.onload = null;
          img.onerror = null;
          img.style.transform = '';
          img.style.filter = '';
          img.style.objectFit = '';
          setResponsiveImageSource(img, result.image);
        }
      }

      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = '';
      state.file = null;

      resetControlValues();
      setControlsDisabled(true);
      $('heroImageEditor').hidden = true;

      status(result.message || 'تم استبدال صورة المدخل وحفظها بنجاح.', false);
    } catch (error) {
      status(error.message || 'تعذر حفظ صورة المدخل.', true);
    } finally {
      state.saving = false;
      if (button) button.disabled = false;
      if ($('heroImageChooseButton')) $('heroImageChooseButton').disabled = false;
      if ($('heroImageCancelSelection')) $('heroImageCancelSelection').disabled = false;
      if ($('heroImageClose')) $('heroImageClose').disabled = false;
      setControlsDisabled(!state.file);
    }
  }

  async function open() {
    if (!authorized()) {
      status('يلزم تسجيل الدخول بكلمة مرور المسؤول والتحقق بحساب Google المعتمد.', true);
      return;
    }

    $('heroImageEditor').hidden = false;
    if (state.file) {
      setControlsDisabled(false);
      status('الصورة جاهزة للتحرير. يمكنك تعديلها أو اختيار صورة جديدة.', false);
      return;
    }

    const requestGeneration = ++state.loadGeneration;
    setControlsDisabled(true);
    status('جارٍ تحميل صورة المدخل الحالية إلى المحرر...', false);

    try {
      const result = await post({}, 'getHeroImageForEditor', 'heroImageLoadResult', 60000);
      if (requestGeneration !== state.loadGeneration || $('heroImageEditor').hidden || !authorized()) return;
      if (!result || !result.data) throw new Error('لم يُرجع الخادم بيانات الصورة الحالية.');
      const file = fileFromBase64(result.data, result.fileName, result.mimeType);
      chooseFile(file);
      status('تم تحميل الصورة الحالية. عدّلها وراجع المعاينة قبل الحفظ، أو اختر صورة جديدة.', false);
    } catch (error) {
      if (requestGeneration !== state.loadGeneration) return;
      setControlsDisabled(true);
      status(error.message || 'تعذر تحميل الصورة الحالية للتحرير.', true);
    }
  }

  function init() {
    const stage = $('schoolEntranceStage');
    const img = $('schoolEntranceImage');

    if (!stage || !img) return;

    state.originalSrc = img.getAttribute('src') || img.src || '';
    img.addEventListener('load', () => setSavedAspectFromImage(img));
    setSavedAspectFromImage(img);

    $('heroImageEditTrigger')?.addEventListener('click', open);
    $('heroImageChooseButton')?.addEventListener('click', () => $('heroImageFileInput')?.click());

    $('heroImageFileInput')?.addEventListener('change', event => {
      const file = event.target.files && event.target.files[0];
      if (file) chooseFile(file);
      event.target.value = '';
    });

    $('heroImageCancelSelection')?.addEventListener('click', () => {
      cancelSelection();
      status('تم إلغاء الصورة المختارة. الصورة الحالية لم تتغير.', false);
    });

    $('heroImageClose')?.addEventListener('click', () => {
      state.loadGeneration++;
      cancelSelection();
      $('heroImageEditor').hidden = true;
    });

    $('heroImageAspect')?.addEventListener('change', event => {
      state.aspectRatio = ratioValue(event.target.value);
      updatePreview();
    });

    $('heroImageZoom')?.addEventListener('input', event => {
      state.zoom = Math.max(1, Math.min(3, Number(event.target.value) || 1));
      updatePreview();
    });

    $('heroImageBrightness')?.addEventListener('input', event => {
      state.brightness = Math.max(70, Math.min(130, Number(event.target.value) || 100));
      updatePreview();
    });

    $('heroImageReset')?.addEventListener('click', () => {
      resetControlValues();
      if (state.file) updatePreview();
      status('تمت إعادة ضبط التكبير والإضاءة. احتفظنا بشكل الصورة المختار.', false);
    });

    $('heroImageSave')?.addEventListener('click', save);

    setControlsDisabled(true);
    refreshAuthorization();
    loadSavedImage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
