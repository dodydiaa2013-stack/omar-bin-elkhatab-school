/* ذاكرة محلية لصورة مدخل المدرسة لتجنب الفراغ أثناء إعادة تحميل الصفحة. */
'use strict';

const HERO_IMAGE_CACHE = 'school-hero-image-v1';
const HERO_IMAGE_PATH = '/thumbnail';
const HERO_IMAGE_SIZES = new Set(['w640', 'w960', 'w1200']);

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('school-hero-image-') && key !== HERO_IMAGE_CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isSchoolHeroImage(request) {
  if (!request || request.method !== 'GET') return false;

  try {
    const url = new URL(request.url);
    return url.protocol === 'https:' &&
      url.hostname === 'drive.google.com' &&
      url.pathname === HERO_IMAGE_PATH &&
      !!url.searchParams.get('id') &&
      HERO_IMAGE_SIZES.has(url.searchParams.get('sz'));
  } catch (_) {
    return false;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!isSchoolHeroImage(request)) return;

  event.respondWith((async () => {
    const cache = await caches.open(HERO_IMAGE_CACHE);
    const cached = await cache.match(request);

    const refresh = fetch(request).then(response => {
      if (response && (response.ok || response.type === 'opaque')) {
        event.waitUntil(cache.put(request, response.clone()).catch(error => {
          console.warn('تعذر تحديث ذاكرة صورة المدخل:', error);
        }));
      }
      return response;
    });

    // إذا وجدت نسخة سابقة، اعرضها فورًا ثم حدّثها من Drive دون تعطيل الرسم.
    if (cached) {
      event.waitUntil(refresh.catch(() => {}));
      return cached;
    }

    // في أول زيارة أو عند تغيير معرّف الصورة، استخدم المصدر الأصلي ثم خزّن الرد.
    return refresh;
  })());
});
