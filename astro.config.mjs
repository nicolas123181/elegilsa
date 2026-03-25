import { defineConfig } from 'astro/config';

export default defineConfig({
  devToolbar: {
    enabled: false,
  },
  vite: {
    server: {
      fs: {
        // Permitir que Vite sirva archivos desde la raíz del proyecto actual
        allow: ['..'],
      },
    },
  },
});
