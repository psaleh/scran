// Scran service worker — makes the app installable and keeps the shopping
// list readable when the phone has no signal in the supermarket.
//
// Plain hand-written worker, no build step: it lives in public/ so Vite copies
// it to dist/ unchanged, and FastAPI serves it from the site root (/sw.js),
// which gives it control of the whole app.
//
// Strategy summary:
//   - Page navigations   → network first, fall back to the cached app shell.
//   - /assets/*          → cache first (Vite hashes these filenames, so a
//                          given URL never changes content).
//   - A few API GETs     → network first, fall back to the last good copy
//                          (OFFLINE_API below). Read-only: changes made
//                          offline still fail with the usual error toast.
//   - Everything else    → straight to the network, never cached.
//
// Bump SHELL_CACHE's version when changing this file's precache list; old
// caches are deleted on activate.

const SHELL_CACHE = 'scran-shell-v1'
const API_CACHE = 'scran-api-v1'

// Files the app needs to boot offline. Hashed JS/CSS under /assets is cached
// the first time it's fetched, so it doesn't need listing here.
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/favicon.ico',
  '/icons/icon-192.png',
]

// API GETs worth keeping a copy of for offline use. /api/auth/me matters:
// without it App.jsx can't confirm the session and drops to the login screen.
const OFFLINE_API = new Set([
  '/api/auth/me',
  '/api/shopping',
  '/api/shopping-lists',
  '/api/categories',
  '/api/stores',
])

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)),
  )
  // Take over from an older worker straight away rather than waiting for
  // every tab to close.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== SHELL_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name)),
      ),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  // Only same-origin GETs are ever cached; uploads, edits, deletes and any
  // cross-origin requests go straight through untouched.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/index.html'))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
  } else if (OFFLINE_API.has(url.pathname)) {
    event.respondWith(networkFirst(request, API_CACHE))
  }
  // Anything else (other /api calls, /api/uploads photos, ...) falls through
  // to the browser's normal network handling.
})

// Logout asks us to forget cached API data, so the next person to use a
// shared device can't see the previous session's list offline.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'clear-api-cache') {
    event.waitUntil(caches.delete(API_CACHE))
  }
})

/** Try the network and save a good response; on failure serve the cached
 *  copy (or `fallbackUrl`'s cached copy, e.g. the SPA shell). */
async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) {
      // For navigations, every client-side route serves the same index.html,
      // so store it under one key instead of one copy per URL.
      cache.put(fallbackUrl ?? request, response.clone())
    }
    return response
  } catch (err) {
    const cached = await cache.match(fallbackUrl ?? request)
    if (cached) return cached
    throw err
  }
}

/** Serve from cache if present, otherwise fetch and remember it. */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}
