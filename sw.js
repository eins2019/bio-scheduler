// ===========================
// sw.js - Service Worker
// ===========================

const CACHE_NAME = 'bio-scheduler-v1.21';  // app.jsのAPP_VERと合わせて更新すること

// キャッシュするファイル一覧
// 相対パスにすること（GitHub Pagesのようなサブパス配下でも動くように）
const CACHE_FILES = [
  './',
  './index.html',
  './app.js',
  './gcal.js',
  './privacy.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
];

// ---------- インストール：キャッシュに保存 ----------
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('SW: キャッシュ保存中...');
      // 外部CDNは失敗してもインストールを続行
      return cache.addAll(CACHE_FILES).catch(err => {
        console.warn('SW: 一部キャッシュ失敗（続行）', err);
      });
    })
  );
  self.skipWaiting();
});

// ---------- アクティベート：古いキャッシュを削除 ----------
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('SW: 古いキャッシュ削除:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ---------- フェッチ：キャッシュ優先 ----------
self.addEventListener('fetch', event => {
  // Google API・認証系はキャッシュしない（常にネットワーク）
  const url = event.request.url;
  if (
    url.includes('accounts.google.com') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('google.com/gsi')
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // HTML・JSはネットワーク優先（更新が1回のリロードで届くように）。
  // オフライン時のみキャッシュにフォールバック。
  const dest = event.request.destination;
  if (dest === 'document' || dest === 'script') {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        caches.match(event.request).then(cached =>
          cached ?? (dest === 'document' ? caches.match('./index.html') : undefined))
      )
    );
    return;
  }

  // 画像などその他はキャッシュ優先、なければネットワーク
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // 正常レスポンスのみキャッシュに追加
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // オフライン時はindex.htmlを返す
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
