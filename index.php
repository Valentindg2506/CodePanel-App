<?php
declare(strict_types=1);

// El contenido de la aplicación se carga desde la API. PHP se usa aquí para
// mantener una entrada compatible con cualquier hosting tradicional.
$appVersion = '1.7.0';

header_remove('X-Powered-By');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: SAMEORIGIN');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header("Content-Security-Policy: default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'");
?>
<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#f7f6f8" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#121116" media="(prefers-color-scheme: dark)">
    <meta name="description" content="CodePanel: un espacio personal para ordenar proyectos, ideas y relaciones de trabajo.">
    <meta name="application-name" content="CodePanel">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="CodePanel">
    <title>CodePanel — Tu estudio de trabajo</title>
    <link rel="icon" href="favicon.ico" sizes="48x48">
    <link rel="icon" href="assets/icons/favicon.svg" type="image/svg+xml">
    <link rel="icon" href="assets/icons/favicon-32.png" type="image/png" sizes="32x32">
    <link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png" sizes="180x180">
    <link rel="manifest" href="manifest.webmanifest">
    <link rel="stylesheet" href="assets/css/app.css?v=<?= urlencode($appVersion) ?>">
</head>
<body>
    <svg hidden><symbol id="vdg" viewBox="0 0 1098 383"><path d="M7.7 0L80.9 0A50 50 0 0 1 121.8 21.3L287.7 258.3A4 4 0 0 0 294.3 258.3L377 140.2A45 45 0 0 1 413.8 121L491.3 121A4 4 0 0 1 494.6 127.3L334.5 356.1A52 52 0 0 1 249.2 356.1L4.4 6.3A4 4 0 0 1 7.7 0ZM300.7 0L594.7 0A95 95 0 0 1 675.4 44.9L812 265.2A80 80 0 0 0 880 303L989 303A30 30 0 0 0 1019 273L1019 263A30 30 0 0 0 989 233L833.7 233A4 4 0 0 1 830.4 226.7L876.8 160.4A22 22 0 0 1 894.9 151L1048 151A50 50 0 0 1 1098 201L1098 333A50 50 0 0 1 1048 383L860.5 383A150 150 0 0 1 733 312L605.3 106A55 55 0 0 0 558.6 80L360.5 80A22 22 0 0 1 342.4 70.6L297.4 6.3A4 4 0 0 1 300.7 0ZM333.4 376.7L378.4 312.4A22 22 0 0 1 396.5 303L557.9 303A55 55 0 0 0 604.7 277L732.4 71A150 150 0 0 1 859.9 0L1045.3 0A4 4 0 0 1 1048.6 6.3L1003.6 70.6A22 22 0 0 1 985.5 80L879.3 80A80 80 0 0 0 811.4 117.8L674.8 338.1A95 95 0 0 1 594.1 383L336.7 383A4 4 0 0 1 333.4 376.7Z"/></symbol></svg>
    <a class="skip-link" href="#workspace">Saltar al contenido</a>

    <div class="app-shell" id="app-shell">
        <div class="sidebar-scrim" id="sidebar-scrim" aria-hidden="true"></div>

        <header class="topbar">
            <a class="brand" href="#dashboard" aria-label="CodePanel, ir al inicio">
                <svg class="brand-mark" viewBox="0 0 1098 383" aria-hidden="true"><use href="#vdg"/></svg>
                <span class="brand-name">CodePanel</span>
            </a>
            <button class="search-trigger" id="search-trigger" type="button" aria-haspopup="dialog">
                <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
                <span>Buscar en tu espacio…</span>
                <kbd>/</kbd>
            </button>
            <div class="topbar-actions">
                <span class="sync-status" id="sync-status" role="status">
                    <span class="sync-dot" aria-hidden="true"></span><span>Al día</span>
                </span>
                <button class="icon-button" id="theme-button" type="button" aria-label="Cambiar tema">
                    <svg class="theme-sun" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
                </button>
                <button class="button button-primary top-create" id="quick-create" type="button" aria-haspopup="menu" aria-expanded="false">
                    <span aria-hidden="true">＋</span><span>Crear</span>
                </button>
                <div class="create-menu" id="create-menu" role="menu" hidden>
                    <button type="button" role="menuitem" data-create="project"><span class="menu-swatch swatch-coral"></span>Proyecto</button>
                    <button type="button" role="menuitem" data-create="idea"><span class="menu-swatch swatch-yellow"></span>Idea</button>
                    <button type="button" role="menuitem" data-create="task"><span class="menu-swatch swatch-blue"></span>Tarea</button>
                    <button type="button" role="menuitem" data-create="client"><span class="menu-swatch swatch-green"></span>Cliente</button>
                    <button type="button" role="menuitem" data-create="lead"><span class="menu-swatch swatch-purple"></span>Oportunidad</button>
                    <button type="button" role="menuitem" data-create="devlog"><span class="menu-swatch swatch-coral"></span>Entrada de bitácora</button>
                    <button type="button" role="menuitem" data-create="budget"><span class="menu-swatch swatch-green"></span>Presupuesto</button>
                    <button type="button" role="menuitem" data-create="payment"><span class="menu-swatch swatch-yellow"></span>Cobro</button>
                    <button type="button" role="menuitem" data-create="release"><span class="menu-swatch swatch-blue"></span>Entrega o versión</button>
                    <button type="button" role="menuitem" data-create="resource"><span class="menu-swatch swatch-purple"></span>Recurso</button>
                    <button type="button" role="menuitem" data-create="reminder"><span class="menu-swatch swatch-coral"></span>Recordatorio</button>
                    <button type="button" role="menuitem" data-create="time_entry"><span class="menu-swatch swatch-blue"></span>Registro de tiempo</button>
                    <button type="button" role="menuitem" data-create="weekly_review"><span class="menu-swatch swatch-green"></span>Revisión semanal</button>
                    <button type="button" role="menuitem" data-upload-open><span class="menu-swatch swatch-yellow"></span>Subir archivo</button>
                    <button type="button" role="menuitem" data-create="tag"><span class="menu-swatch swatch-purple"></span>Etiqueta</button>
                </div>
                <div class="profile-card">
                    <button class="profile-button" id="profile-button" type="button" aria-haspopup="menu" aria-expanded="false">
                        <span class="avatar" id="user-avatar" aria-hidden="true">CP</span>
                        <span class="profile-copy"><strong id="user-name">Mi espacio</strong><small id="user-role">Cuenta personal</small></span>
                        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 10 4 4 4-4"/></svg>
                    </button>
                    <div class="profile-menu" id="profile-menu" role="menu" hidden>
                        <button type="button" role="menuitem" data-profile-action="logout">Cerrar sesión</button>
                    </div>
                </div>
            </div>
        </header>

        <div class="layout">
            <aside class="rail" aria-label="Navegación principal">
                <nav class="rail-nav" aria-label="Secciones principales">
                    <a class="rail-link is-active" href="#dashboard" data-nav="dashboard"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13h6V4H4v9Zm0 7h6v-3H4v3Zm10 0h6v-9h-6v9Zm0-16v3h6V4h-6Z"/></svg><span>Panorama</span></a>
                    <a class="rail-link" href="#projects" data-nav="projects"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3.5 7.5h6l2-2h9v14h-17v-12Z"/><path d="M3.5 10.5h17"/></svg><span>Proyectos</span></a>
                    <a class="rail-link" href="#ideas" data-nav="ideas"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M8.4 15.5A7 7 0 1 1 15.6 15.5c-.9.7-1.1 1.3-1.1 2h-5c0-.7-.2-1.3-1.1-2Z"/></svg><span>Semillero</span></a>
                    <a class="rail-link" href="#tasks" data-nav="tasks"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="m8 9 1.5 1.5L12 8M14 10h2M8 15h8"/></svg><span>Tareas</span></a>
                    <a class="rail-link" href="#calendar" data-nav="calendar"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg><span>Calendario</span></a>
                    <a class="rail-link" href="#devlogs" data-nav="devlogs"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5Z"/><path d="M8 17h11M9 9h6M9 12h4"/></svg><span>Bitácora</span></a>
                    <a class="rail-link" href="#clients" data-nav="clients"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 11l2 2 3-4"/></svg><span>Clientes</span></a>
                </nav>
                <button class="rail-link rail-more" type="button" data-open-sidebar aria-controls="sidebar" aria-expanded="false"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg><span>Más</span></button>
            </aside>

            <main class="workspace" id="workspace" tabindex="-1">
                <div class="route-announcer sr-only" id="route-announcer" aria-live="polite"></div>
                <section class="view" id="view" aria-busy="true">
                    <div class="page-skeleton" aria-label="Cargando tu espacio">
                        <div class="skeleton skeleton-title"></div>
                        <div class="skeleton skeleton-subtitle"></div>
                        <div class="skeleton-grid"><div></div><div></div><div></div><div></div></div>
                        <div class="skeleton skeleton-panel"></div>
                    </div>
                </section>
            </main>
        </div>

        <aside class="sidebar" id="sidebar" aria-label="Todas las secciones">
            <div class="sidebar-head">
                <strong>Todas las secciones</strong>
                <button class="icon-button" id="sidebar-close" type="button" aria-label="Cerrar menú">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>
                </button>
            </div>
            <nav class="main-nav" aria-label="Secciones">
                <p class="nav-eyebrow">Mi espacio</p>
                <a class="nav-item is-active" href="#dashboard" data-nav="dashboard">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13h6V4H4v9Zm0 7h6v-3H4v3Zm10 0h6v-9h-6v9Zm0-16v3h6V4h-6Z"/></svg>
                    <span>Panorama</span>
                </a>
                <a class="nav-item" href="#projects" data-nav="projects">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3.5 7.5h6l2-2h9v14h-17v-12Z"/><path d="M3.5 10.5h17"/></svg>
                    <span>Proyectos</span><span class="nav-count" id="nav-project-count" hidden></span>
                </a>
                <a class="nav-item" href="#ideas" data-nav="ideas">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M8.4 15.5A7 7 0 1 1 15.6 15.5c-.9.7-1.1 1.3-1.1 2h-5c0-.7-.2-1.3-1.1-2Z"/></svg>
                    <span>Semillero</span><span class="nav-count" id="nav-idea-count" hidden></span>
                </a>
                <a class="nav-item" href="#tasks" data-nav="tasks">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="m8 9 1.5 1.5L12 8M14 10h2M8 15h8"/></svg>
                    <span>Tareas</span>
                </a>
                <a class="nav-item" href="#reminders" data-nav="reminders">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>
                    <span>Recordatorios</span><span class="nav-count" id="nav-reminder-count" hidden></span>
                </a>
                <a class="nav-item" href="#calendar" data-nav="calendar">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>
                    <span>Calendario</span>
                </a>
                <a class="nav-item" href="#devlogs" data-nav="devlogs">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5Z"/><path d="M8 17h11M9 9h6M9 12h4"/></svg>
                    <span>Bitácora</span>
                </a>

                <p class="nav-eyebrow nav-eyebrow-spaced">Relaciones</p>
                <a class="nav-item" href="#clients" data-nav="clients">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 11l2 2 3-4"/></svg>
                    <span>Clientes</span>
                </a>
                <a class="nav-item" href="#leads" data-nav="leads">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-8-8"/><path d="M20 4v6h-6M20 4l-8 8"/></svg>
                    <span>Oportunidades</span>
                </a>
                <a class="nav-item" href="#budgets" data-nav="budgets">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 3.5h14v17l-2.5-1.5-2.3 1.5-2.2-1.5-2.3 1.5L5 18V3.5Z"/><path d="M8 8h8M8 12h5"/></svg>
                    <span>Presupuestos</span><span class="nav-count" id="nav-budget-count" hidden></span>
                </a>

                <p class="nav-eyebrow nav-eyebrow-spaced">Operación</p>
                <a class="nav-item" href="#releases" data-nav="releases">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 7 4v8l-7 4-7-4V7l7-4Z"/><path d="m5 7 7 4 7-4M12 11v8"/></svg>
                    <span>Entregas</span>
                </a>
                <a class="nav-item" href="#resources" data-nav="resources">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5"/></svg>
                    <span>Recursos</span><span class="nav-count" id="nav-resource-count" hidden></span>
                </a>
                <a class="nav-item" href="#time" data-nav="time">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 3h6"/></svg>
                    <span>Control de tiempo</span>
                </a>
                <a class="nav-item" href="#profitability" data-nav="profitability">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2M19 4l2 2-5 5-3-3-5 5"/></svg>
                    <span>Rentabilidad</span>
                </a>
                <a class="nav-item" href="#weekly" data-nav="weekly">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg>
                    <span>Revisión semanal</span>
                </a>

                <p class="nav-eyebrow nav-eyebrow-spaced">Biblioteca</p>
                <a class="nav-item" href="#files" data-nav="files">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h10l6 6v10H4zM14 4v6h6"/><path d="M8 15h8M8 18h5"/></svg>
                    <span>Archivos</span>
                </a>
                <a class="nav-item" href="#tags" data-nav="tags">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m3 12 9 9 9-9-9-9H3v9Z"/><circle cx="8" cy="8" r="1"/></svg>
                    <span>Etiquetas</span>
                </a>
                <a class="nav-item" href="#dashboard-settings" data-nav="dashboard-settings">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="9"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="17" width="6" height="3"/></svg>
                    <span>Personalizar inicio</span>
                </a>
                <a class="nav-item" href="#settings" data-nav="settings">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.5 1A8 8 0 0 0 14 6l-.4-3h-4l-.4 3a8 8 0 0 0-2.4 1.1l-2.5-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.5-1A8 8 0 0 0 9.2 18l.4 3h4l.4-3a8 8 0 0 0 2.4-1.1l2.5 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/></svg>
                    <span>Configuración</span>
                </a>
            </nav>
        </aside>
    </div>

    <nav class="mobile-nav" aria-label="Navegación móvil">
        <a class="is-active" href="#dashboard" data-nav="dashboard"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13h6V4H4v9Zm0 7h6v-3H4v3Zm10 0h6v-9h-6v9Zm0-16v3h6V4h-6Z"/></svg><span>Inicio</span></a>
        <a href="#projects" data-nav="projects"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3.5 7.5h6l2-2h9v14h-17v-12Z"/><path d="M3.5 10.5h17"/></svg><span>Proyectos</span></a>
        <a href="#ideas" data-nav="ideas"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M8.4 15.5A7 7 0 1 1 15.6 15.5c-.9.7-1.1 1.3-1.1 2h-5c0-.7-.2-1.3-1.1-2Z"/></svg><span>Ideas</span></a>
        <a href="#clients" data-nav="clients"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 11l2 2 3-4"/></svg><span>Clientes</span></a>
        <button type="button" data-open-sidebar aria-controls="sidebar" aria-expanded="false"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg><span>Más</span></button>
    </nav>

    <dialog class="app-dialog" id="entity-dialog" aria-labelledby="dialog-title">
        <form class="entity-form" id="entity-form" method="dialog" novalidate>
            <header class="dialog-header">
                <div><span class="dialog-kicker" id="dialog-kicker">Nuevo registro</span><h2 id="dialog-title">Crear</h2></div>
                <button class="icon-button" type="button" data-dialog-close aria-label="Cerrar ventana"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
            </header>
            <div class="dialog-body" id="dialog-fields"></div>
            <footer class="dialog-footer">
                <button class="button button-danger dialog-delete" id="dialog-delete" type="button" hidden>Eliminar</button>
                <button class="button button-ghost" type="button" data-dialog-close>Cancelar</button>
                <button class="button button-primary" id="dialog-submit" type="submit"><span>Guardar</span></button>
            </footer>
        </form>
    </dialog>

    <dialog class="project-preview-dialog" id="project-preview-dialog" aria-labelledby="project-preview-title">
        <div class="project-preview-shell" id="project-preview-content">
            <div class="project-preview-loading" aria-label="Cargando proyecto">
                <h2 class="sr-only" id="project-preview-title">Cargando proyecto</h2>
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-subtitle"></div>
                <div class="skeleton skeleton-panel"></div>
            </div>
        </div>
    </dialog>

    <dialog class="record-preview-dialog" id="record-preview-dialog" aria-labelledby="record-preview-title">
        <div class="record-preview-shell" id="record-preview-content">
            <div class="record-preview-loading" aria-label="Cargando vista previa">
                <h2 class="sr-only" id="record-preview-title">Cargando vista previa</h2>
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-subtitle"></div>
                <div class="skeleton skeleton-panel"></div>
            </div>
        </div>
    </dialog>

    <dialog class="search-dialog" id="search-dialog" aria-labelledby="search-title">
        <div class="search-box">
            <header class="search-input-wrap">
                <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
                <label class="sr-only" for="global-search">Buscar</label>
                <input id="global-search" type="search" autocomplete="off" placeholder="Proyecto, bitácora, cliente…">
                <kbd>esc</kbd>
            </header>
            <div class="search-results" id="search-results">
                <div class="search-hint"><span aria-hidden="true">⌕</span><p>Escribí para encontrar cualquier cosa en tu espacio.</p></div>
            </div>
        </div>
    </dialog>

    <dialog class="confirm-dialog" id="confirm-dialog" aria-labelledby="confirm-title">
        <form method="dialog">
            <span class="confirm-icon" aria-hidden="true">?</span>
            <h2 id="confirm-title">¿Eliminar este elemento?</h2>
            <p id="confirm-message">Esta acción no se puede deshacer.</p>
            <div class="confirm-actions">
                <button class="button button-ghost" value="cancel">Cancelar</button>
                <button class="button button-danger" value="confirm">Sí, eliminar</button>
            </div>
        </form>
    </dialog>

    <section class="auth-overlay" id="auth-overlay" role="dialog" aria-modal="true" hidden aria-labelledby="auth-title">
        <div class="auth-art" aria-hidden="true">
            <div class="auth-brand"><svg class="brand-mark" viewBox="0 0 1098 383"><use href="#vdg"/></svg><strong>CodePanel</strong></div>
            <p class="auth-claim"><small>Tu estudio, en orden.</small><strong>Ideas que avanzan.<br>Proyectos con rumbo.</strong></p>
            <p>Hecho para quienes disfrutan crear, sin convertir su organización en otro proyecto.</p>
        </div>
        <div class="auth-panel">
            <form id="auth-form" novalidate>
                <span class="auth-kicker">Bienvenido a tu espacio</span>
                <h1 id="auth-title">Volvé a poner tus ideas en marcha.</h1>
                <p class="auth-lead">Ingresá para continuar o creá tu espacio personal en un minuto.</p>
                <div class="auth-tabs" role="tablist" aria-label="Acceso">
                    <button class="is-active" type="button" role="tab" aria-selected="true" data-auth-mode="login">Ingresar</button>
                    <button type="button" role="tab" aria-selected="false" data-auth-mode="register">Crear cuenta</button>
                </div>
                <div class="form-field auth-name-field" hidden><label for="auth-name">Tu nombre</label><input id="auth-name" name="name" autocomplete="name" placeholder="¿Cómo te llamás?"></div>
                <div class="form-field"><label for="auth-email">Correo electrónico</label><input id="auth-email" name="email" type="email" autocomplete="email" placeholder="vos@ejemplo.com" required></div>
                <div class="form-field"><label for="auth-password">Contraseña</label><input id="auth-password" name="password" type="password" autocomplete="current-password" placeholder="Mínimo 8 caracteres" minlength="8" required></div>
                <p class="form-error" id="auth-error" role="alert" hidden></p>
                <button class="button button-primary auth-submit" type="submit"><span>Entrar a mi espacio</span><span aria-hidden="true">→</span></button>
            </form>
        </div>
    </section>

    <div class="toast-region" id="toast-region" aria-live="polite" aria-label="Notificaciones"></div>

    <script src="assets/js/app.js?v=<?= urlencode($appVersion) ?>" defer></script>
    <script src="assets/js/pwa.js?v=<?= urlencode($appVersion) ?>" defer></script>
</body>
</html>
