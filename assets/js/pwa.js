(() => {
    'use strict';

    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

    const script = document.currentScript;
    if (!script?.src) return;

    // La raíz se deduce desde /assets/js/pwa.js para que funcione igual en el
    // dominio principal, /CodePanel o cualquier otra subcarpeta del hosting.
    const appRoot = new URL('../../', script.src);
    const workerUrl = new URL('service-worker.js', appRoot);

    window.addEventListener('load', () => {
        navigator.serviceWorker.register(workerUrl, {
            scope: appRoot.pathname,
            updateViaCache: 'none',
        }).catch(error => {
            // No interrumpe la aplicación web si el navegador o el servidor
            // no admiten la instalación. Queda visible para depuración local.
            console.warn('No se pudo activar el modo instalable de CodePanel.', error);
        });
    }, { once: true });
})();
