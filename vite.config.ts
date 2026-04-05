import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
      manifest: {
        name: 'Tower',
        short_name: 'Tower',
        description: 'Stack your own tower of AI and systems.',
        theme_color: '#d97706',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'business'],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/valuelens/, /^\/hub\//, /^\/edge\//, /^\/pulse\//, /^\/miroball\//, /^\/text2sql\//, /^\/collectors\//, /^\/sites\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-cache',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  root: 'packages/frontend',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'packages/frontend/src'),
      '@tower/shared': path.resolve(__dirname, 'packages/shared/index.ts'),
    },
  },
  server: {
    port: 32354,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:32355',
      '/ws': {
        target: 'ws://localhost:32355',
        ws: true,
      },
      '/hub': 'http://localhost:32400',
      '/sites': 'http://localhost:80',
    },
  },
  build: {
    outDir: '../../dist/frontend',
    emptyOutDir: true,
  },
});
