import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  base: '',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      path: 'path-browserify',
      fs: resolve(__dirname, './src/mocks/empty.ts'),
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/autofill.ts'),
        passkey: resolve(__dirname, 'src/content/passkey-inject.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  // Worker configuration for Web Worker support
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'workers/[name]-[hash].js',
        chunkFileNames: 'workers/chunks/[name]-[hash].js',
      },
    },
  },
})