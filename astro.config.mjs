import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
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
