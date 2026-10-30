'use strict';

/*
 * Solo se conserva el armazón estático de CodePanel. Los datos de usuario,
 * sesiones, API y adjuntos quedan deliberadamente fuera de Cache Storage.
 */
const CACHE_PREFIX = 'codepanel-shell-';
const CACHE_VERSION = '2026-10-23.2';
const SHELL_CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_ROOT = new URL('./', self.registration.scope);
const APP_ROOT_PATH = APP_ROOT.pathname.endsWith('/') ? APP_ROOT.pathname : `${APP_ROOT.pathname}/`;

const shellUrl = path => new URL(path, APP_ROOT).href;
const APP_SHELL = [
    shellUrl('./'),
    shellUrl('index.php'),
    shellUrl('offline.html'),
    shellUrl('manifest.webmanifest'),
    shellUrl('assets/css/app.css'),
    shellUrl('assets/css/offline.css'),
    shellUrl('assets/fonts/instrument-sans.woff2'),
    shellUrl('assets/fonts/dm-mono-400.woff2'),
    shellUrl('assets/fonts/dm-mono-500.woff2'),
    shellUrl('assets/js/app.js'),
    shellUrl('assets/js/pwa.js'),
    shellUrl('assets/icons/favicon.svg'),
    shellUrl('assets/icons/favicon-32.png'),
    shellUrl('assets/icons/apple-touch-icon.png'),
    shellUrl('assets/icons/app-icon-192.png'),
    shellUrl('assets/icons/app-icon-512.png'),
    shellUrl('assets/icons/app-icon-maskable-192.png'),
    shellUrl('assets/icons/app-icon-maskable-512.png'),
];

const PRIVATE_PATH_SEGMENTS = [
    `${APP_ROOT_PATH}api/`,
    `${APP_ROOT_PATH}storage/`,
    `${APP_ROOT_PATH}uploads/`,
];
const PRIVATE_PATH_MARKERS = ['/attachments/', '/adjuntos/', '/feedback/', '/public-feedback/'];
const SENSITIVE_QUERY_KEY = /(?:^|[_-])(?:auth|authorization|code|credential|key|password|secret|share|signature|sig|token)(?:$|[_-])/i;

function normalizedPath(url) {
    try {
        return decodeURIComponent(url.pathname).toLocaleLowerCase('en-US');
    } catch {
        return url.pathname.toLocaleLowerCase('en-US');
    }
}

function isPrivateRequest(url) {
    const path = normalizedPath(url);
    if (PRIVATE_PATH_SEGMENTS.some(segment => path.startsWith(segment.toLocaleLowerCase('en-US')))) {
        return true;
    }
    if (PRIVATE_PATH_MARKERS.some(marker => path.includes(marker))) return true;
    for (const key of url.searchParams.keys()) {
        if (SENSITIVE_QUERY_KEY.test(key)) return true;
    }

    // index.php es el único PHP que forma parte del shell. Cualquier otra
    // página dinámica (incluidos share.php y rutas con PATH_INFO) queda en red.
    const isPhpRoute = /(?:^|\/)[^/]+\.php(?:\/|$)/i.test(path);
    return isPhpRoute && path !== `${APP_ROOT_PATH.toLocaleLowerCase('en-US')}index.php`;
}

function canStoreResponse(response) {
    if (!response.ok || response.type !== 'basic') return false;
    const cacheControl = response.headers.get('Cache-Control') || '';
    return !/(?:^|,)\s*(?:no-store|private)\b/i.test(cacheControl);
}

async function precache(cache, url) {
    const request = new Request(url, { credentials: 'same-origin', cache: 'reload' });
    const response = await fetch(request);
    if (canStoreResponse(response)) await cache.put(request, response);
}

function isAppEntry(url) {
    const path = normalizedPath(url);
    const root = APP_ROOT_PATH.toLocaleLowerCase('en-US');
    return path === root || path === `${root}index.php`;
}

function isStaticShellRequest(url) {
    if (url.origin !== APP_ROOT.origin || !normalizedPath(url).startsWith(APP_ROOT_PATH.toLocaleLowerCase('en-US'))) {
        return false;
    }

    const path = normalizedPath(url);
    return path.startsWith(`${APP_ROOT_PATH.toLocaleLowerCase('en-US')}assets/`)
        || path === `${APP_ROOT_PATH.toLocaleLowerCase('en-US')}manifest.webmanifest`
        || path === `${APP_ROOT_PATH.toLocaleLowerCase('en-US')}offline.html`;
}

async function cachedShell(request) {
    const cache = await caches.open(SHELL_CACHE);
    const exact = await cache.match(request);
    if (exact) return exact;

    // Los query strings de versión del HTML pueden cambiar. Solo se ignoran
    // para assets estáticos conocidos, nunca para páginas o datos dinámicos.
    return cache.match(request, { ignoreSearch: true });
}

async function staticAsset(request) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cachedShell(request);
    const network = fetch(request).then(response => {
        if (canStoreResponse(response)) {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    });

    if (cached) {
        network.catch(() => {});
        return cached;
    }
    return network;
}

async function appNavigation(request) {
    try {
        return await fetch(request);
    } catch {
        return (await cachedShell(request))
            || (await caches.match(shellUrl('index.php')))
            || Response.error();
    }
}

async function dynamicNavigation(request) {
    try {
        return await fetch(request);
    } catch {
        return (await caches.match(shellUrl('offline.html'))) || Response.error();
    }
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => Promise.all(APP_SHELL.map(url => precache(cache, url))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== APP_ROOT.origin || isPrivateRequest(url)) return;

    if (request.mode === 'navigate') {
        event.respondWith(isAppEntry(url) ? appNavigation(request) : dynamicNavigation(request));
        return;
    }

    if (isStaticShellRequest(url)) {
        event.respondWith(staticAsset(request));
    }
});
