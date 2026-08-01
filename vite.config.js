import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Import explícito en vez del global de Node: este archivo lo lintea la misma
// config que el código del browser, donde `process` no existe.
import process from 'node:process'
import { readFileSync } from 'node:fs'

// La versión del dashboard sale de package.json y de ningún otro lado, así que
// bumpearla es editar ese campo (o `npm version patch`) y nada más. Se lee acá y
// se inyecta como constante al bundle: el browser no puede importar el
// package.json en runtime, y duplicar el número en un .js sería otra fuente de
// verdad que se desincroniza en el primer release apurado.
//
// Se lee con readFileSync en vez de `import ... with { type: 'json' }` porque
// esa sintaxis todavía depende de la versión de Node, y esto tiene que compilar
// igual en la máquina de desarrollo y adentro del contenedor.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    proxy: {
      // Por defecto apunta al backend local. VITE_API_PROXY permite probar el
      // frontend de desarrollo contra el backend ya desplegado en la Pi:
      //   VITE_API_PROXY=http://192.168.18.250 npm run dev
      // Sirve para ver un cambio de UI contra datos reales del nodo sin tener
      // que levantar InfluxDB y Mosquitto localmente.
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:8080',
        changeOrigin: true,
      }
    }
  }
})
