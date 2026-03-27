// ═══════════════════════════════════════════════════════
//  ATOMIC TIME SYNCHRONIZER — SERVICE WORKER
//  © Manik Roy 2026. All Rights Reserved.
// ═══════════════════════════════════════════════════════

const CACHE_NAME    = 'atomic-sync-v1.0.0';
const RUNTIME_CACHE = 'atomic-runtime-v1.0.0';

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Google Fonts — cache at runtime on first fetch
];

// External origins allowed in runtime cache
const CACHEABLE_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// ── INSTALL ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and browser-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Same-origin: Cache-first, fall back to network then offline page
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Google Fonts: stale-while-revalidate
  if (CACHEABLE_ORIGINS.some(o => request.url.startsWith(o))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Everything else: network-only (NTP calls, etc.)
  event.respondWith(fetch(request).catch(() => new Response('', { status: 408 })));
});

// ── STRATEGIES ────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return offline fallback for navigation requests
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response(offlinePage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || await fetchPromise || new Response('', { status: 408 });
}

// ── OFFLINE FALLBACK PAGE ─────────────────────────────
function offlinePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atomic Sync — Offline</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a0e1a;color:#e2f0ff;font-family:'Share Tech Mono',monospace;
       display:flex;flex-direction:column;align-items:center;justify-content:center;
       min-height:100vh;gap:24px;padding:24px;text-align:center}
  h1{font-size:22px;color:#00d4ff;letter-spacing:.15em;text-shadow:0 0 20px rgba(0,212,255,.5)}
  p{font-size:12px;color:#6b8cae;letter-spacing:.1em;line-height:1.8}
  .dot{width:12px;height:12px;border-radius:50%;background:#ff6b35;
       box-shadow:0 0 12px #ff6b35;margin:0 auto;animation:blink .8s ease infinite}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
  .clock{font-size:52px;color:#00d4ff;letter-spacing:.05em;text-shadow:0 0 20px rgba(0,212,255,.4)}
</style>
</head>
<body>
<div class="dot"></div>
<h1>⚛ ATOMIC SYNC</h1>
<div class="clock" id="t">--:--:--</div>
<p>NTP SERVERS UNREACHABLE<br>RUNNING ON LOCAL OSCILLATOR<br>RECONNECT TO SYNCHRONIZE</p>
<script>
  setInterval(()=>{
    const n=new Date();
    document.getElementById('t').textContent=
      [n.getHours(),n.getMinutes(),n.getSeconds()]
        .map(x=>String(x).padStart(2,'0')).join(':');
  },1000);
</script>
</body>
</html>`;
}

// ── BACKGROUND SYNC (for deferred sync requests) ─────
self.addEventListener('sync', event => {
  if (event.tag === 'ntp-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Notify all clients that a background sync occurred
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'BACKGROUND_SYNC', timestamp: Date.now() });
  });
}

// ── PUSH NOTIFICATIONS ────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || '⚛ Atomic Sync', {
      body: data.body || 'NTP synchronization complete.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      tag: 'ntp-sync',
      renotify: false,
      data: { url: '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});

console.log('[SW] Atomic Time Synchronizer Service Worker loaded — © Manik Roy 2026');
