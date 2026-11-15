import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

test('offline navigation restores every public workspace route without intercepting API requests', async () => {
  const handlers = new Map()
  const shell = new Response('<main>Cached workspace</main>')
  const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, {
    __CACHE_VERSION__: 'test', __SHELL_FILES__: ['index.html'], URL, AbortSignal, Response,
    self: {
      registration: { scope: 'https://acha.test/' }, location: { origin: 'https://acha.test' },
      addEventListener: (name, handler) => handlers.set(name, handler),
    },
    caches: { open: async () => ({ match: async url => url === 'https://acha.test/index.html' ? shell : undefined }) },
    fetch: async () => { throw new TypeError('Offline') },
  })
  for (const path of ['/', '/monitoring', '/measurements', '/assessment', '/assessments/check-in', '/guides', '/mission', '/research', '/crew']) {
    let response
    handlers.get('fetch')({
      request: { url: `https://acha.test${path}`, method: 'GET', mode: 'navigate' },
      respondWith: value => { response = value },
    })
    assert.equal(await response, shell, path)
  }
  for (const url of ['https://acha.test/api/v1/crew-members', 'https://other.test/monitoring']) {
    handlers.get('fetch')({
      request: { url, method: 'GET', mode: 'navigate' },
      respondWith: () => assert.fail(`Must not intercept ${url}`),
    })
  }
})
