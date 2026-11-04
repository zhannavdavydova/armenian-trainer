// Офлайн-кэш: оболочка приложения из кэша, словарь — сначала из сети (чтобы новые слова приходили сами)
const CACHE = 'hy-trainer-v6';
const SHELL = ['./', 'index.html', 'app.js', 'words.json', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // всё своё: сначала сеть, при неудаче — кэш; так обновления подтягиваются, а офлайн всё работает
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request, { ignoreSearch: true }).then(hit =>
        hit || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())
      )
    )
  );
});
