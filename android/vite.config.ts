import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = resolve(__dirname, '..')

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(repoRoot, 'src/shared'),
      '@main': resolve(repoRoot, 'src/main'),
      '@renderer': resolve(repoRoot, 'src/renderer/src'),
      '@app': resolve(__dirname, 'src')
    },
    dedupe: ['react', 'react-dom']
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome100',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 3000
  },
  optimizeDeps: {
    exclude: ['sql.js']
  },
  server: {
    port: 5174,
    fs: {
      allow: [repoRoot]
    }
  }
})
