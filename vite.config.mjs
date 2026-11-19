import { defineConfig } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Generates an offline-ready service worker in dist/sw.js that explicitly
 * precaches all built assets (HTML, JS, CSS, manifest, icons) using relative URLs
 * so the PWA works both at root and under a subpath (e.g. GitHub Pages).
 */
function pwaServiceWorkerPlugin() {
  return {
    name: 'citadelle-pwa-sw',
    apply: 'build',
    async writeBundle(options, bundle) {
      const outDir = options.dir ? path.resolve(options.dir) : path.resolve('dist');
      const assetUrls = new Set([
        './',
        './index.html',
        './manifest.webmanifest',
        './icons/icon.svg',
        './icons/icon-192.png',
        './icons/icon-512.png',
        './icons/apple-touch-icon.png',
      ]);

      for (const fileName of Object.keys(bundle)) {
        if (!fileName.endsWith('.map')) {
          assetUrls.add(`./${fileName}`);
        }
      }

      const versionHash = Array.from(assetUrls).sort().join('|');
      let hash = 2166136261;
      for (let i = 0; i < versionHash.length; i++) {
        hash ^= versionHash.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      const cacheName = `citadelle-marees-${(hash >>> 0).toString(36)}`;

      const swPath = path.join(outDir, 'sw.js');
      const swContent = `const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE_URLS = ${JSON.stringify(Array.from(assetUrls), null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('citadelle-marees-') && key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
`;
      await fs.writeFile(swPath, swContent, 'utf8');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [pwaServiceWorkerPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
