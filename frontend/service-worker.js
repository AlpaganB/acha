const scope = self.registration.scope
const prefix = 'acha-shell:' + scope
const name = prefix + __CACHE_VERSION__
const urls = new Set(__SHELL_FILES__.map(path => new URL(path, scope).href))
const index = new URL('index.html', scope).href

self.addEventListener('install', event => {
  event.waitUntil(caches.open(name).then(cache =>
    cache.addAll([...urls].map(url => new Request(url, { cache: 'reload' })))
  ).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith(prefix) && key !== name)
      .map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  const pathname = url.origin + url.pathname
  const isShell = request.mode === 'navigate' && (pathname === scope || pathname === index)
  if (!isShell && !urls.has(url.href)) return

  event.respondWith((async () => {
    const cache = await caches.open(name)
    return (await cache.match(isShell ? index : url.href, { ignoreVary: true })) || fetch(request)
  })())
})
