import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Bibliotecas mudam pouco: num arquivo só delas, o navegador reaproveita o cache
        // a cada deploy. Os ícones juntos evitam dezenas de arquivinhos de 200 bytes.
        manualChunks(id) {
          if (id.includes('node_modules/lucide-react')) return 'icons';
          if (/node_modules\/(react|react-dom|scheduler|@hello-pangea)\//.test(id)) return 'vendor';
          return undefined;
        }
      }
    }
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
});
