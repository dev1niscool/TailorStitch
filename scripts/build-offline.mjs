import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? collect(path) : [path];
  }));
  return groups.flat();
}
const files = (await collect('dist')).filter(path => !path.endsWith('sw.js') && !path.endsWith('.nojekyll')).sort();
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(file));
const version = hash.digest('hex').slice(0, 16);
const urls = ['./', ...files.map(path => './' + path.slice(5).replaceAll('\\', '/'))];
const worker = `// Generated from the complete production build. Never caches user screenshots.
const VERSION = ${JSON.stringify(version)};
const PREFIX = 'tailorstitch-' + self.registration.scope;
const CACHE = PREFIX + VERSION;
const ASSETS = ${JSON.stringify(urls)};
const URLS = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (!response.ok) throw new Error('Offline');
      return response;
    }).catch(() => caches.open(CACHE).then(cache => cache.match(new URL('./index.html', self.registration.scope).href, { ignoreVary: true }))));
  } else if (URLS.has(request.url)) {
    // The allowlisted files are immutable app assets. Preview/static hosts may
    // vary CORS headers even though the response bytes are identical.
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(request, { ignoreVary: true })) || fetch(request)));
  }
});
`;
await writeFile('dist/sw.js', worker);
console.log(`Offline app: ${files.length} assets, version ${version}`);
