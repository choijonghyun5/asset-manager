// 1단계 기준 앱 셸 캐싱만 담당합니다.
// 데이터(자산/기록)는 localStorage에 저장되며 이 파일과 무관합니다.
const CACHE_NAME = "asset-tracker-cache-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/data.js",
  "./js/storage.js",
  "./js/exchange.js",
  "./js/drive.js",
  "./js/charts.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

// 네트워크 우선, 실패 시 캐시로 폴백 (오프라인에서도 앱이 열리도록)
// 앱 셸(같은 출처)만 캐싱하고, 환율 API 같은 외부 요청은 그대로 브라우저에 맡김
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
