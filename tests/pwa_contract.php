<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$errors = [];

$assert = static function (bool $condition, string $message) use (&$errors): void {
    if (!$condition) {
        $errors[] = $message;
    }
};

$manifestPath = $root . '/manifest.webmanifest';
$manifestRaw = is_file($manifestPath) ? file_get_contents($manifestPath) : false;
$assert(is_string($manifestRaw), 'Falta manifest.webmanifest.');
$manifest = is_string($manifestRaw) ? json_decode($manifestRaw, true) : null;
$assert(is_array($manifest), 'El manifiesto no contiene JSON válido.');

if (is_array($manifest)) {
    $assert(($manifest['name'] ?? '') !== '', 'El manifiesto necesita un nombre.');
    $assert(($manifest['short_name'] ?? '') !== '', 'El manifiesto necesita un nombre corto.');
    $assert(($manifest['display'] ?? '') === 'standalone', 'La PWA debe abrirse en modo standalone.');
    $assert(($manifest['start_url'] ?? '') === './#dashboard', 'start_url debe ser relativo para funcionar en subcarpetas.');
    $assert(($manifest['scope'] ?? '') === './', 'scope debe ser relativo para funcionar en subcarpetas.');

    $purposes = [];
    foreach (($manifest['icons'] ?? []) as $icon) {
        if (!is_array($icon)) continue;
        $source = (string) ($icon['src'] ?? '');
        $expected = (string) ($icon['sizes'] ?? '');
        $purposes[] = (string) ($icon['purpose'] ?? 'any');
        $assert($source !== '' && !str_starts_with($source, '/'), "El icono {$source} debe usar una ruta relativa.");
        $path = $root . '/' . $source;
        $assert(is_file($path), "No existe el icono {$source}.");
        if (is_file($path)) {
            $size = getimagesize($path);
            $actual = is_array($size) ? $size[0] . 'x' . $size[1] : '';
            $assert($actual === $expected, "{$source} declara {$expected}, pero mide {$actual}.");
            $assert(is_array($size) && ($size['mime'] ?? '') === 'image/png', "{$source} debe ser PNG.");
        }
    }
    $assert(in_array('any', $purposes, true), 'Falta un icono de propósito any.');
    $assert(in_array('maskable', $purposes, true), 'Falta un icono maskable.');
}

foreach ([
    'service-worker.js',
    'offline.html',
    'assets/css/offline.css',
    'assets/js/pwa.js',
    'assets/icons/apple-touch-icon.png',
    'assets/icons/favicon-32.png',
] as $requiredFile) {
    $assert(is_file($root . '/' . $requiredFile), "Falta {$requiredFile}.");
}

$worker = file_get_contents($root . '/service-worker.js') ?: '';
$assert(str_contains($worker, "request.method !== 'GET'"), 'El service worker debe ignorar escrituras.');
$assert(str_contains($worker, '`${APP_ROOT_PATH}api/`'), 'El service worker debe excluir la API.');
$assert(str_contains($worker, '`${APP_ROOT_PATH}storage/`'), 'El service worker debe excluir almacenamiento privado.');
$assert(str_contains($worker, 'SENSITIVE_QUERY_KEY'), 'El service worker debe reconocer parámetros sensibles.');
$assert(str_contains($worker, 'isPhpRoute'), 'El service worker debe excluir páginas PHP dinámicas.');
$assert(str_contains($worker, 'no-store|private'), 'El service worker no debe almacenar respuestas privadas o no-store.');

if ($errors !== []) {
    fwrite(STDERR, "PWA: se encontraron " . count($errors) . " problema(s):\n");
    foreach ($errors as $error) {
        fwrite(STDERR, "- {$error}\n");
    }
    exit(1);
}

fwrite(STDOUT, "PWA: manifiesto, iconos, shell offline y límites de caché verificados.\n");
