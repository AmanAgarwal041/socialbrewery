import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds into ../public so `npm start` serves the dashboard with zero installs.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3847',
      '/mcp': 'http://127.0.0.1:3847',
    },
  },
})
