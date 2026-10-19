import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds the unpacked extension into dist/: load it from chrome://extensions → Load unpacked.
// The side panel and the service worker are separate entries; page scripts are injected as
// functions (chrome.scripting), so there is no content-script bundle.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { sidepanel: path.resolve(__dirname, 'sidepanel.html'), background: path.resolve(__dirname, 'src/background.ts') },
      output: { entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js') },
    },
  },
})
