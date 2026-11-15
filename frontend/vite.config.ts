import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

function offlineShell(): Plugin {
  return {
    name: 'acha-offline-shell',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const icon = readFileSync(new URL('./public/acha.svg', import.meta.url))
      const worker = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8')
      const version = createHash('sha256').update(worker).update(icon)
        .update(JSON.stringify(bundle)).digest('hex').slice(0, 12)
      const files = ['acha.svg', ...Object.keys(bundle).sort()]

      this.emitFile({
        type: 'asset',
        fileName: 'service-worker.js',
        source: worker.replace('__CACHE_VERSION__', JSON.stringify(version))
          .replace('__SHELL_FILES__', JSON.stringify(files)),
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  if (mode === 'restricted') {
    const { VITE_API_URL: apiUrl } = loadEnv(mode, process.cwd())
    const url = apiUrl && URL.canParse(apiUrl) ? new URL(apiUrl) : null
    const loopback = url?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (!url || (url.protocol !== 'https:' && !loopback) || !/^\/api\/v1\/?$/.test(url.pathname)
      || apiUrl !== url.origin + url.pathname) {
      throw new Error('The restricted workspace requires VITE_API_URL to be an absolute HTTPS URL ending in /api/v1. Local loopback may use HTTP.')
    }
    return { plugins: [react()], base: '/', build: { outDir: 'dist-restricted' } }
  }

  return {
    plugins: [react(), offlineShell()],
    base: '/',
    server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
    preview: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  }
})
