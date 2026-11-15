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
  const isShell = request.mode === 'navigate' && url.origin === self.location.origin && (
    /^\/(?:index\.html)?$/.test(url.pathname) ||
    /^\/(assessment|assessments|measurements|guides|mission|research|crew|monitoring|scenarios)(\/|$)/.test(url.pathname)
  )
  if (!isShell && !urls.has(url.href)) return

  event.respondWith((async () => {
    const cache = await caches.open(name)
    if (isShell) {
      try {
        const response = await fetch(request, { cache: 'no-cache', signal: AbortSignal.timeout(2500) })
        if (response.ok) return response
      } catch {
        // Use the installed shell during a network interruption.
      }
      return (await cache.match(index)) || Response.error()
    }
    return (await cache.match(url.href, { ignoreVary: true })) || fetch(request)
  })())
})
