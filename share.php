<?php

declare(strict_types=1);

header_remove('X-Powered-By');
header('Cache-Control: no-store, max-age=0');
header('Pragma: no-cache');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
?>
<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex,nofollow,noarchive">
    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" content="#f7f6f8" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#121116" media="(prefers-color-scheme: dark)">
    <title>Portal de proyecto · CodePanel</title>
    <link rel="icon" href="favicon.ico" sizes="48x48">
    <link rel="icon" href="assets/icons/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="assets/css/share.css">
</head>
<body>
    <main class="share-shell">
        <header class="brand" aria-label="CodePanel">
            <svg class="brand-mark" viewBox="0 0 1098 383" aria-hidden="true"><path d="M7.7 0L80.9 0A50 50 0 0 1 121.8 21.3L287.7 258.3A4 4 0 0 0 294.3 258.3L377 140.2A45 45 0 0 1 413.8 121L491.3 121A4 4 0 0 1 494.6 127.3L334.5 356.1A52 52 0 0 1 249.2 356.1L4.4 6.3A4 4 0 0 1 7.7 0ZM300.7 0L594.7 0A95 95 0 0 1 675.4 44.9L812 265.2A80 80 0 0 0 880 303L989 303A30 30 0 0 0 1019 273L1019 263A30 30 0 0 0 989 233L833.7 233A4 4 0 0 1 830.4 226.7L876.8 160.4A22 22 0 0 1 894.9 151L1048 151A50 50 0 0 1 1098 201L1098 333A50 50 0 0 1 1048 383L860.5 383A150 150 0 0 1 733 312L605.3 106A55 55 0 0 0 558.6 80L360.5 80A22 22 0 0 1 342.4 70.6L297.4 6.3A4 4 0 0 1 300.7 0ZM333.4 376.7L378.4 312.4A22 22 0 0 1 396.5 303L557.9 303A55 55 0 0 0 604.7 277L732.4 71A150 150 0 0 1 859.9 0L1045.3 0A4 4 0 0 1 1048.6 6.3L1003.6 70.6A22 22 0 0 1 985.5 80L879.3 80A80 80 0 0 0 811.4 117.8L674.8 338.1A95 95 0 0 1 594.1 383L336.7 383A4 4 0 0 1 333.4 376.7Z"/></svg>
            <span class="brand-name">CodePanel</span>
            <span class="brand-label">Portal de proyecto</span>
        </header>

        <section class="project-card" id="project-card" aria-live="polite">
            <div class="eyebrow"><span></span> Espacio compartido</div>
            <h1 id="project-name">Comprobando el enlace…</h1>
            <p id="project-description">Estamos preparando el espacio para tus comentarios.</p>
            <div class="project-progress" id="project-progress" hidden>
                <div class="progress-copy">
                    <span id="project-status">Proyecto</span>
                    <strong id="project-progress-value">0%</strong>
                </div>
                <div class="progress-track" aria-hidden="true"><span id="project-progress-bar"></span></div>
            </div>
        </section>

        <section class="feedback-card" id="feedback-panel" hidden>
            <div class="section-heading">
                <div>
                    <div class="eyebrow"><span></span> Feedback</div>
                    <h2>Contanos qué encontraste</h2>
                </div>
                <p>Tu reporte llegará directamente a la persona responsable del proyecto.</p>
            </div>

            <form id="feedback-form" novalidate>
                <div class="type-picker" role="radiogroup" aria-label="Tipo de reporte">
                    <label><input type="radio" name="type" value="comment" checked><span>Comentario</span></label>
                    <label><input type="radio" name="type" value="bug"><span>Bug</span></label>
                    <label><input type="radio" name="type" value="error"><span>Error</span></label>
                </div>

                <div class="field-grid">
                    <label class="field">
                        <span>Tu nombre</span>
                        <input name="author_name" type="text" autocomplete="name" minlength="2" maxlength="100" required placeholder="¿Cómo te llamás?">
                        <small data-error="author_name"></small>
                    </label>
                    <label class="field">
                        <span>Email <em>opcional</em></span>
                        <input name="author_email" type="email" autocomplete="email" maxlength="190" placeholder="Para poder responderte">
                        <small data-error="author_email"></small>
                    </label>
                </div>

                <label class="field field-message">
                    <span>¿Qué pasó?</span>
                    <textarea name="message" minlength="10" maxlength="5000" required placeholder="Contá qué estabas haciendo, qué esperabas que ocurriera y qué viste…"></textarea>
                    <span class="field-meta"><small data-error="message"></small><output id="message-count">0 / 5000</output></span>
                </label>

                <input class="honeypot" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">

                <label class="upload-zone" for="feedback-images">
                    <input id="feedback-images" name="images[]" type="file" accept="image/jpeg,image/png,image/webp" multiple>
                    <span class="upload-icon" aria-hidden="true">＋</span>
                    <span><strong>Agregar capturas</strong><small>Hasta 4 imágenes JPG, PNG o WebP · 5 MiB cada una</small></span>
                </label>
                <div class="preview-grid" id="image-previews" aria-live="polite"></div>
                <small class="global-error" data-error="images"></small>

                <div class="form-footer">
                    <p>No compartas contraseñas, tokens ni información sensible.</p>
                    <button type="submit" id="submit-feedback"><span>Enviar reporte</span></button>
                </div>
            </form>
            <div class="success-panel" id="success-panel" hidden tabindex="-1">
                <span aria-hidden="true">✓</span>
                <h2>Reporte enviado</h2>
                <p>Gracias. Ya quedó registrado para que podamos revisarlo.</p>
                <small id="feedback-reference"></small>
                <button type="button" id="send-another">Enviar otro</button>
            </div>
        </section>

        <section class="unavailable-card" id="unavailable-panel" hidden role="alert">
            <span aria-hidden="true">×</span>
            <h1>Este enlace no está disponible</h1>
            <p>Puede haber vencido o haber sido reemplazado. Pedile un enlace nuevo a la persona responsable del proyecto.</p>
        </section>

        <footer>Feedback seguro gestionado con <strong>CodePanel</strong></footer>
    </main>
    <script src="assets/js/share.js" defer></script>
</body>
</html>
