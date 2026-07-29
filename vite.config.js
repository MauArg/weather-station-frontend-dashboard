import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
