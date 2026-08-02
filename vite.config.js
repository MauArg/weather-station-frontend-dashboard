import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Explicit import instead of Node's global: this file is linted by the same
// config as the browser code, where `process` doesn't exist.
import process from 'node:process'
import { readFileSync } from 'node:fs'

// The dashboard's version comes from package.json and nowhere else, so
// bumping it is editing that field (or `npm version patch`) and nothing more.
// It's read here and injected as a constant into the bundle: the browser
// can't import package.json at runtime, and duplicating the number in a .js
// file would be another source of truth that drifts out of sync on the first
// rushed release.
//
// Read with readFileSync instead of `import ... with { type: 'json' }`
// because that syntax still depends on the Node version, and this has to
// build the same way on the development machine and inside the container.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    proxy: {
      // Defaults to the local backend. VITE_API_PROXY makes it possible to test
      // the development frontend against the backend already deployed on the Pi:
      //   VITE_API_PROXY=http://192.168.18.250 npm run dev
      // Useful for checking a UI change against real node data without having
      // to run InfluxDB and Mosquitto locally.
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:8080',
        changeOrigin: true,
      }
    }
  }
})
