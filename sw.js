// GENERATED ASSET DIGESTS: computed from final file bytes; do not hand-edit.
const RELEASE = "manual-backup-20261106-1";
const CONTENT_ID = "4f87124406593129";
const ASSETS = [
  {
    "url": "./index.html?v=manual-backup-20261106-1",
    "sha256": "e28171a9eba8e168c353be95b12d1bf9cce8ca5718259cb43d6928f0d74d6f4e"
  },
  {
    "url": "./app.js?v=manual-backup-20261106-1",
    "sha256": "a6869226f0fae30edc65828d7c7795bbcc22cb0344cbc67f9235612db9872d6b"
  },
  {
    "url": "./app.css?v=manual-backup-20261106-1",
    "sha256": "c1c96e78bb6ecdb1963f62eafcf8dd8d14473c42115112a1e47b16588470b7b4"
  },
  {
    "url": "./search.js?v=manual-backup-20261106-1",
    "sha256": "31461c0213b424cab0606fccaa42c5d1f312fbd264539d9fab74271e2a8e8945"
  },
  {
    "url": "./manifest.json",
    "sha256": "c58282ac1f7196da5bf98f047c7f15cc3a9ae78c3e9c765c2e33b45bb9278c13"
  },
  {
    "url": "./icon.svg",
    "sha256": "c675a95888018b7b46581b7af72c055d36aeb67fc38ebc7cf93b646e33cbe154"
  },
  {
    "url": "https://cdn.jsdelivr.net/npm/pinyin-match@1.2.10/dist/main.js",
    "sha256": "11fbf02727f6eb90d842a3e9c29eda191b38e293bf01202756e7d7be94867ee7"
  },
  {
    "url": "https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.min.js",
    "sha256": "c57339c3fa16b1d69d9a6b46749a8139ef8d4fc9bbfe48144ff897aa7d4222ec"
  }
];

// Releases are immutable. After editing a runtime file, regenerate its SRI and
// this manifest from the final bytes, and use a new RELEASE for a new publish.
const BASE_URL = new URL('./', self.registration.scope);
const CACHE_PREFIX = 'shouna-assistant-release:' + encodeURIComponent(BASE_URL.pathname) + ':';
const CACHE_NAME = CACHE_PREFIX + RELEASE + ':' + CONTENT_ID;
const ASSET_URLS = new Map(ASSETS.map(asset => [new URL(asset.url, BASE_URL).href, asset]));
const LOCAL_PATHS = new Set(ASSETS.filter(asset => !asset.url.startsWith('https:')).map(asset => new URL(asset.url, BASE_URL).pathname));
const INDEX_URL = new URL('./index.html?v=' + RELEASE, BASE_URL).href;

async function sha256(response) {
  const bytes = await response.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function matchesAsset(response, asset) {
  return !!response && response.status === 200 && !response.redirected &&
    await sha256(response.clone()) === asset.sha256;
}
async function completeCache(cache) {
  for (const [url, asset] of ASSET_URLS) {
    if (!await matchesAsset(await cache.match(url), asset)) return false;
  }
  return true;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const existed = await caches.has(CACHE_NAME);
    if (existed && await completeCache(await caches.open(CACHE_NAME))) return;
    // Fetch and verify EVERYTHING before publishing any new cache entries.
    // Fetches made inside this worker do not use the old worker's fetch handler.
    const responses = await Promise.all([...ASSET_URLS].map(async ([url, asset]) => {
      const local = new URL(url).origin === BASE_URL.origin;
      const response = await fetch(url, {
        cache: 'reload', redirect: 'error', mode: 'cors',
        credentials: local ? 'same-origin' : 'omit'
      });
      if (!await matchesAsset(response, asset)) throw new Error('Release asset verification failed: ' + asset.url);
      return [url, response];
    }));
    try {
      const cache = await caches.open(CACHE_NAME);
      for (const [url, response] of responses) await cache.put(url, response);
      if (!await completeCache(cache)) throw new Error('Release cache is incomplete');
    } catch (error) {
      // Never remove a pre-existing cache (it might already belong to a live worker).
      if (!existed) await caches.delete(CACHE_NAME);
      throw error;
    }
    // No skipWaiting: keep the existing worker and open pages in control.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    if (!await completeCache(await caches.open(CACHE_NAME))) throw new Error('Cannot activate an incomplete release');
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    // Leave legacy item-storage-v1 alone: its unscoped name may belong to another
    // app on this origin. It is NEVER used as a fallback by this worker.
    // No clients.claim: do not take over a document from another release.
  })());
});
function unavailable(message, code = 503) {
  return new Response(message, { status: code, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
async function releaseResponse(url) {
  if (!await caches.has(CACHE_NAME)) return unavailable('离线版本资源缺失，请联网后关闭并重新打开应用。');
  const response = await (await caches.open(CACHE_NAME)).match(url);
  return response || unavailable('当前版本资源不完整，未使用其他版本替代。请联网后重新打开应用。');
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const local = url.origin === BASE_URL.origin;
  const home = local && (url.pathname === BASE_URL.pathname || url.pathname === new URL('index.html', BASE_URL).pathname);
  if (event.request.mode === 'navigate' && home) {
    if (url.searchParams.has('v') && url.searchParams.get('v') !== RELEASE) {
      event.respondWith(unavailable('页面版本与离线版本不同，请关闭旧页面后重新打开原入口。', 409));
    } else event.respondWith(releaseResponse(INDEX_URL));
    return;
  }
  if (ASSET_URLS.has(url.href)) {
    event.respondWith(releaseResponse(url.href));
  } else if (local && LOCAL_PATHS.has(url.pathname)) {
    // A missing/different version must fail closed, never fall back to a stale
    // unversioned file, another release cache, or the network's latest bytes.
    event.respondWith(unavailable('资源版本不匹配，请关闭旧页面后重新打开应用。', 409));
  }
  // Unrelated requests are not cached or intercepted.
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SHOUNA_GET_RELEASE' && event.ports[0]) {
    event.ports[0].postMessage({ release: RELEASE, contentId: CONTENT_ID, cacheName: CACHE_NAME });
  }
});
