import { defineConfig } from 'astro/config';

export default defineConfig({
  devToolbar: {
    enabled: false,
  },
  vite: {
    server: {
      fs: {
        // Prevent Windows absolute-path restrictions when dependencies resolve outside workspace root.
        allow: ['C:/Users/prats'],
      },
    },
  },
});
