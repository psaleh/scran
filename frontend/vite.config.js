import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In development the Vite dev server proxies API calls to the FastAPI
    // backend, so the browser sees a single origin (cookies just work).
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
