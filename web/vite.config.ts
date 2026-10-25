import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: {
    port: 5273,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3300', changeOrigin: true },
      '/s': { target: 'http://127.0.0.1:3300', changeOrigin: true },
      '/p': { target: 'http://127.0.0.1:3300', changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', 'zustand'],
          editor: ['vditor'],
          markdown: ['marked', 'dompurify', 'highlight.js', 'katex', 'mermaid']
        }
      }
    }
  }
})
