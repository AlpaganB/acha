import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

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

export default defineConfig({
  plugins: [react(), offlineShell()],
  base: './',
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:8000' } },
})
