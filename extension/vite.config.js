import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content/index.jsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        // Content script não é módulo ES: o import() dinâmico (usado para adiar
        // o React) precisa ficar embutido no mesmo arquivo.
        inlineDynamicImports: true
      }
    },
    outDir: 'dist',
    emptyOutDir: true
  }
})
