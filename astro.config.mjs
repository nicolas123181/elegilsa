import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  devToolbar: {
    enabled: false,
  },
  vite: {
    build: {
      rollupOptions: {
        onwarn(warning, warn) {
          const message = String(warning?.message || '');
          const ignoredAstroAssetWarning =
            warning?.code === 'UNUSED_EXTERNAL_IMPORT' &&
            message.includes('@astrojs/internal-helpers/remote') &&
            message.includes('matchHostname') &&
            message.includes('matchPathname') &&
            message.includes('matchPort') &&
            message.includes('matchProtocol');

          if (ignoredAstroAssetWarning) return;
          warn(warning);
        },
      },
    },
    server: {
      fs: {
        // Permitir que Vite sirva archivos desde la raíz del proyecto actual
        allow: ['..'],
      },
    },
  },
});
