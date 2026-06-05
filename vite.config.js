import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 2026-06-05 (PageSpeed Tier 3):
//  - target: 'es2020' → kills ~16 KiB of legacy polyfills Lighthouse flagged
//    ("Legacy JavaScript — Est savings of 16 KiB"). Safari 14+ / iOS 14+ /
//    Chrome 80+ all support es2020 natively, which covers >97% of our
//    audience (iPhone-first app — installed users are on modern iOS).
//  - manualChunks: split React/MiniSearch/PostHog into stable vendor chunks
//    so they cache across SPA shell updates. Without splitting, every code
//    change invalidates the full 664 KiB index-*.js — with splitting, only
//    the small app shell hash changes.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // rolldown (Vite 8) requires manualChunks as a function rather
        // than the object form Vite 5/6 accepted.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-dom') || /node_modules\/react\//.test(id)) return 'vendor-react';
          if (id.includes('minisearch')) return 'vendor-minisearch';
          if (id.includes('posthog-js')) return 'vendor-posthog';
        },
      },
    },
  },
})
