(() => {
    'use strict';

    const API_BASE = 'api/index.php';
    const ROUTES = ['dashboard', 'projects', 'ideas', 'tasks', 'reminders', 'calendar', 'devlogs', 'clients', 'leads', 'budgets', 'releases', 'resources', 'time', 'profitability', 'weekly', 'files', 'snippets', 'tags', 'dashboard-settings', 'settings'];
    const ENTITY_ROUTE = {
        project: 'projects', idea: 'ideas', task: 'tasks', devlog: 'devlogs', client: 'clients', lead: 'leads',
        budget: 'budgets', payment: 'payments', release: 'releases', resource: 'resources', reminder: 'reminders',
        time_entry: 'time_entries', weekly_review: 'weekly_reviews', tag: 'tags', snippet: 'snippets',
    };
    const ENTITY_PAGE = { ...ENTITY_ROUTE, payment: 'budgets', time_entry: 'time', weekly_review: 'weekly', tag: 'tags', reminder: 'reminders', attachment: 'files' };
    const ROUTE_ENTITY = Object.fromEntries(Object.entries(ENTITY_ROUTE).map(([singular, plural]) => [plural, singular]));
    const CACHE_TTL = 25_000;
    // Las listas se filtran y buscan en el navegador: se piden completas (el servidor admite hasta 1000).
    const COLLECTION_LIMIT = 1000;

    const state = {
        user: null,
        csrf: '',
        demoMode: false,
        features: {},
        quietRender: false,
        lastPaintedRoute: null,
        registrationEnabled: true,
        route: 'dashboard',
        cache: new Map(),
        dashboard: null,
        dashboardAt: 0,
        filters: {
            projects: {
                search: '', status: 'all', type: 'all', priority: 'all', tech: 'all', pinned: 'all',
                view: localStorage.getItem('cp-project-view') || 'grid',
            },
            ideas: { search: '', status: 'all' },
            snippets: { search: '', status: 'all' },
            tasks: { search: '', status: 'all', view: (() => { try { return localStorage.getItem('cp-task-view') === 'board' ? 'board' : 'list'; } catch { return 'list'; } })() },
            clients: { search: '', status: 'all' },
            leads: { search: '' },
            devlogs: { search: '', status: 'all' },
            budgets: { search: '', status: 'all' },
            releases: { search: '', status: 'all' },
            resources: { search: '', status: 'all' },
            reminders: { search: '', status: 'all' },
            time: { search: '', status: 'all' },
            weekly: { search: '', status: 'all' },
            files: { search: '', status: 'all', project: 'all' },
            tags: { search: '', status: 'all' },
        },
        settings: null,
        calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        calendarDay: new Date().toISOString().slice(0, 10),
        timerTick: null,
        form: { entity: null, id: null },
        projectPreview: { id: null, data: null, requestId: 0 },
        projectShareMutation: false,
        recordPreview: { entity: null, id: null, record: null, requestId: 0 },
        kanban: { draggedId: null, sourceStatus: null, suppressClickUntil: 0, savingId: null, blockDrag: false },
        projectMutations: new Set(),
        requestId: 0,
        pageData: {},
    };

    const dom = {
        view: document.querySelector('#view'),
        shell: document.querySelector('#app-shell'),
        sidebar: document.querySelector('#sidebar'),
        scrim: document.querySelector('#sidebar-scrim'),
        sidebarButtons: document.querySelectorAll('[data-open-sidebar]'),
        sidebarClose: document.querySelector('#sidebar-close'),
        quickCreate: document.querySelector('#quick-create'),
        createMenu: document.querySelector('#create-menu'),
        profileButton: document.querySelector('#profile-button'),
        profileMenu: document.querySelector('#profile-menu'),
        sync: document.querySelector('#sync-status'),
        entityDialog: document.querySelector('#entity-dialog'),
        entityForm: document.querySelector('#entity-form'),
        dialogFields: document.querySelector('#dialog-fields'),
        dialogTitle: document.querySelector('#dialog-title'),
        dialogKicker: document.querySelector('#dialog-kicker'),
        dialogSubmit: document.querySelector('#dialog-submit'),
        dialogDelete: document.querySelector('#dialog-delete'),
        projectPreviewDialog: document.querySelector('#project-preview-dialog'),
        projectPreviewContent: document.querySelector('#project-preview-content'),
        recordPreviewDialog: document.querySelector('#record-preview-dialog'),
        recordPreviewContent: document.querySelector('#record-preview-content'),
        searchDialog: document.querySelector('#search-dialog'),
        searchInput: document.querySelector('#global-search'),
        searchResults: document.querySelector('#search-results'),
        confirmDialog: document.querySelector('#confirm-dialog'),
        confirmTitle: document.querySelector('#confirm-title'),
        confirmMessage: document.querySelector('#confirm-message'),
        authOverlay: document.querySelector('#auth-overlay'),
        authForm: document.querySelector('#auth-form'),
        authError: document.querySelector('#auth-error'),
        toastRegion: document.querySelector('#toast-region'),
        routeAnnouncer: document.querySelector('#route-announcer'),
    };

    const STATUS = {
        planned: 'Por empezar', active: 'En marcha', on_hold: 'En pausa', completed: 'Terminado', archived: 'Archivado',
        inbox: 'En la bandeja', exploring: 'Explorando', validated: 'Validada', building: 'Construyendo', parked: 'En pausa',
        lead: 'Potencial', inactive: 'Inactivo', new: 'Nuevo', contacted: 'Contactado', qualified: 'Calificado',
        proposal: 'Propuesta', won: 'Ganado', lost: 'Perdido', todo: 'Por hacer', in_progress: 'En curso', done: 'Hecha',
        draft: 'Borrador', sent: 'Enviado', approved: 'Aprobado', rejected: 'Rechazado', expired: 'Vencido',
        ready: 'Lista', published: 'Publicada', rolled_back: 'Revertida', attention: 'Requiere atención',
        pending: 'Pendiente', dismissed: 'Descartado',
    };
    const PRIORITY = { low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente' };
    const ROUTE_NAMES = { dashboard: 'Dashboard', projects: 'Proyectos', ideas: 'Semillero', tasks: 'Tareas', reminders: 'Recordatorios', calendar: 'Calendario', devlogs: 'Bitácora', clients: 'Clientes', leads: 'Oportunidades', budgets: 'Presupuestos y cobros', releases: 'Entregas y versiones', resources: 'Recursos e infraestructura', time: 'Control de tiempo', profitability: 'Rentabilidad', weekly: 'Revisión semanal', files: 'Archivos y documentación', tags: 'Etiquetas', snippets: 'Fragmentos', 'dashboard-settings': 'Personalizar dashboard', settings: 'Configuración' };
    const ENTITY_NAMES = { project: 'proyecto', idea: 'idea', task: 'tarea', devlog: 'entrada', client: 'cliente', lead: 'oportunidad', budget: 'presupuesto', payment: 'cobro', release: 'entrega', resource: 'recurso', reminder: 'recordatorio', time_entry: 'registro de tiempo', weekly_review: 'revisión semanal', tag: 'etiqueta', snippet: 'fragmento' };
    const RECORD_PREVIEW_ENTITIES = new Set(['idea','task','reminder','devlog','client','lead','budget','payment','release','resource','time_entry','weekly_review','attachment','tag','snippet']);
    const RECORD_PREVIEW_LABELS = {
        idea: 'Idea', task: 'Tarea', reminder: 'Recordatorio', devlog: 'Bitácora', client: 'Cliente',
        lead: 'Oportunidad', budget: 'Presupuesto', payment: 'Cobro', release: 'Entrega y versión',
        resource: 'Recurso e infraestructura', time_entry: 'Registro de tiempo', weekly_review: 'Revisión semanal',
        attachment: 'Archivo', tag: 'Etiqueta', snippet: 'Fragmento',
    };
    const DEVLOG_TYPES = { progress: 'Avance', decision: 'Decisión', blocker: 'Bloqueo', learning: 'Aprendizaje', note: 'Nota' };
    const PAYMENT_METHODS = { transfer: 'Transferencia', cash: 'Efectivo', card: 'Tarjeta', digital_wallet: 'Billetera digital', other: 'Otro medio' };
    const RELEASE_KINDS = { version: 'Versión', delivery: 'Entrega' };
    const ENVIRONMENTS = { development: 'Desarrollo', staging: 'Pruebas', production: 'Producción', client: 'Cliente', shared: 'Compartido' };
    const RESOURCE_TYPES = { domain: 'Dominio', hosting: 'Hosting', server: 'Servidor', database: 'Base de datos', repository: 'Repositorio', service: 'Servicio', documentation: 'Documentación', other: 'Otro' };
    const BILLING_CYCLES = { none: 'Sin costo recurrente', monthly: 'Mensual', yearly: 'Anual', one_time: 'Pago único' };
    const WIDGETS = {
        overview: 'Métricas principales', projects: 'Proyectos en foco', tasks: 'Próximas tareas',
        reminders: 'Recordatorios', time_tracking: 'Tiempo de esta semana', profitability: 'Rentabilidad',
        calendar: 'Agenda próxima', weekly_review: 'Revisión semanal', budgets: 'Presupuestos y cobros', resources: 'Recursos e infraestructura',
    };
    const DEFAULT_WIDGETS = ['overview', 'projects', 'tasks', 'reminders', 'time_tracking', 'profitability', 'calendar', 'weekly_review', 'budgets', 'resources'];
    const PROJECT_COLORS = ['#df704f', '#748c76', '#708ba2', '#8d7796', '#d3a83c', '#b66065'];

    const escapeHTML = (value = '') => String(value)
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    const safeColor = (value, fallback = '#df704f') => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
    const asArray = value => Array.isArray(value) ? value : (typeof value === 'string' && value.trim() ? value.split(',').map(item => item.trim()).filter(Boolean) : []);
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
    const initials = value => String(value || 'Code Panel').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
    const parseDate = value => {
        if (!value) return null;
        const raw = String(value);
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T12:00:00`);
        const normalized = raw.replace(' ', 'T');
        return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
    };
    const formatDate = (value, options = null) => {
        const civil = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const dateFormat = state.settings?.date_format || 'd/m/Y';
        if (civil && !options) {
            const [,year,month,day] = civil;
            return dateFormat === 'Y-m-d' ? `${year}-${month}-${day}` : dateFormat === 'm/d/Y' ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
        }
        const date = civil ? new Date(Date.UTC(Number(civil[1]),Number(civil[2])-1,Number(civil[3]),12)) : parseDate(value);
        const selected = options || (dateFormat === 'Y-m-d'
            ? { year: 'numeric', month: '2-digit', day: '2-digit' }
            : dateFormat === 'm/d/Y'
                ? { month: '2-digit', day: '2-digit', year: 'numeric' }
                : { day: '2-digit', month: '2-digit', year: 'numeric' });
        const locale = dateFormat === 'm/d/Y' ? 'en-US' : dateFormat === 'Y-m-d' ? 'sv-SE' : 'es-AR';
        const configured = civil ? { ...selected, timeZone:'UTC' } : (state.settings?.timezone ? { ...selected, timeZone: state.settings.timezone } : selected);
        return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(locale, configured).format(date).replace('.', '') : 'Sin fecha';
    };
    const formatMoney = (value, currency = state.settings?.default_currency || 'ARS') => {
        const safeCurrency = ['ARS', 'USD', 'EUR'].includes(currency) ? currency : 'USD';
        return new Intl.NumberFormat('es-AR', { style: 'currency', currency: safeCurrency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0);
    };
    const zonedCivil = value => {
        const raw=String(value||''); if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
        const date=value instanceof Date?value:parseDate(value); if(!date||Number.isNaN(date.getTime()))return '';
        try { const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:state.settings?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value])); return `${parts.year}-${parts.month}-${parts.day}`; }
        catch { return dateISO(date); }
    };
    const dateDistance = value => {
        const target = zonedCivil(value); const today = zonedCivil(new Date());
        if (!target || !today) return 'Sin fecha';
        const date = new Date(`${target}T12:00:00Z`); const now = new Date(`${today}T12:00:00Z`);
        const diff = Math.round((date-now) / 86_400_000);
        if (diff === 0) return 'Hoy';
        if (diff === 1) return 'Mañana';
        if (diff === -1) return 'Ayer';
        if (diff > 1 && diff < 7) return `En ${diff} días`;
        if (diff < -1 && diff > -7) return `Hace ${Math.abs(diff)} días`;
        return shortDate(value);
    };
    const dateISO = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const todayISO = () => zonedCivil(new Date());
    const dateAfter = days => { const date = parseDate(todayISO()); date.setDate(date.getDate() + days); return dateISO(date); };
    const daysUntil = value => {
        const target=zonedCivil(value); const today=zonedCivil(new Date());
        return target&&today ? Math.round((new Date(`${target}T12:00:00Z`)-new Date(`${today}T12:00:00Z`))/86_400_000) : null;
    };
    const minutesLabel = value => {
        const total = Math.max(0, Math.round(Number(value) || 0));
        const hours = Math.floor(total / 60); const minutes = total % 60;
        return hours ? `${hours} h${minutes ? ` ${minutes} min` : ''}` : `${minutes} min`;
    };
    const elapsedMinutes = entry => {
        const running = Boolean(entry.is_running) || (entry.started_at && !entry.ended_at);
        if (!running && entry.duration_minutes !== null && entry.duration_minutes !== undefined) return Number(entry.duration_minutes) || 0;
        if (!entry.started_at) return Number(entry.duration_minutes) || 0;
        const start = parseDate(entry.started_at); const end = parseDate(entry.ended_at) || new Date();
        return start && end ? Math.max(0, Math.floor((end - start) / 60000)) : 0;
    };
    const debounce = (callback, delay = 220) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), delay); };
    };
    const safeUrl = value => {
        try { const url = new URL(String(value)); return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : '#'; }
        catch { return '#'; }
    };

    function icon(name) {
        const paths = {
            folder: '<path d="M3.5 7.5h6l2-2h9v14h-17v-12Z"/><path d="M3.5 10.5h17"/>',
            bulb: '<path d="M9 18h6M10 21h4M8.4 15.5A7 7 0 1 1 15.6 15.5c-.9.7-1.1 1.3-1.1 2h-5c0-.7-.2-1.3-1.1-2Z"/>',
            check: '<path d="m5 12 4 4L19 6"/>',
            users: '<path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 8a3 3 0 0 1 0 6M21 20v-2a4 4 0 0 0-3-3.9"/>',
            calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
            clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
            more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
            search: '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>',
            grid: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>',
            columns: '<rect x="3" y="4" width="7" height="16"/><rect x="14" y="4" width="7" height="16"/>',
            mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
            phone: '<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-4-1-2 2c-4.2-1.8-7.2-4.8-9-9l2-2-1-4Z"/>',
            link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
            target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M15 9 21 3"/>',
            journal: '<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5Z"/><path d="M8 17h11M9 9h6M9 12h4"/>',
            receipt: '<path d="M5 3.5h14v17l-2.5-1.5-2.3 1.5-2.2-1.5-2.3 1.5L5 18V3.5Z"/><path d="M8 8h8M8 12h5"/>',
            package: '<path d="m12 3 7 4v8l-7 4-7-4V7l7-4Z"/><path d="m5 7 7 4 7-4M12 11v8"/>',
            server: '<rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5"/>',
            wallet: '<path d="M4 6.5h14a2 2 0 0 1 2 2v10H6a2 2 0 0 1-2-2v-10Z"/><path d="M4 8V6a2 2 0 0 1 2-2h11v4M15 12h5v4h-5a2 2 0 0 1 0-4Z"/>',
            alert: '<path d="M12 4 3.5 20h17L12 4Z"/><path d="M12 9v5M12 17h.01"/>',
            plus: '<path d="M12 5v14M5 12h14"/>',
            arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
            chevron: '<path d="m9 6 6 6-6 6"/>',
            tag: '<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9-8-8Z"/><circle cx="8" cy="8" r="1.4"/>',
            list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
            copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
            key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16 7l2.5 2.5M14 9l2 2"/>',
            code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
            chevronLeft: '<path d="m15 6-6 6 6 6"/>',
            user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
            sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
            pin: '<path d="m8 4h8l-1 5 3 3v1H6v-1l3-3-1-5ZM12 13v8"/>',
            image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 3 3 2-2 6 5"/>',
            drag: '<path d="M8 5h.01M8 12h.01M8 19h.01M16 5h.01M16 12h.01M16 19h.01"/>',
        };
        return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name] || ''}</svg>`;
    }

    class ApiError extends Error {
        constructor(message, status = 0, errors = {}) { super(message); this.name = 'ApiError'; this.status = status; this.errors = errors || {}; }
    }

    const api = {
        async request(path, options = {}, retried = false) {
            setSync('syncing', 'Guardando…');
            const headers = { Accept: 'application/json', ...(options.headers || {}) };
            const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
            if (options.body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
            if (state.csrf && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
            let response;
            try {
                response = await fetch(`${API_BASE}/${String(path).replace(/^\//, '')}`, {
                    credentials: 'same-origin',
                    ...options,
                    headers,
                    body: options.body === undefined ? undefined : (isFormData ? options.body : JSON.stringify(options.body)),
                });
            } catch (error) {
                setSync('error', 'Sin conexión');
                throw new ApiError('No pudimos conectar con CodePanel. Revisa tu conexión e inténtalo otra vez.');
            }
            let payload;
            try { payload = await response.json(); }
            catch { setSync('error', 'Error'); throw new ApiError('El servidor respondió en un formato inesperado.', response.status); }
            if (!response.ok || payload.success === false) {
                const csrfRejected = response.status === 419
                    || (response.status === 403 && payload.errors && Object.hasOwn(payload.errors, 'csrf'));
                // Un token caducado se renueva y la petición se repite una sola vez.
                if (csrfRejected && !retried) { await refreshCsrf(); return this.request(path, options, true); }
                setSync('error', 'Error al guardar');
                if (response.status === 401 && !path.startsWith('auth/')) showAuth();
                throw new ApiError(payload.message || 'No pudimos completar la acción.', response.status, payload.errors);
            }
            setSync('ok', state.demoMode ? 'Modo muestra' : 'Al día');
            if (payload.meta && typeof payload.meta.demo_mode === 'boolean') state.demoMode = payload.meta.demo_mode;
            return payload;
        },
        get(path) { return this.request(path, { method: 'GET' }); },
        post(path, body) { return this.request(path, { method: 'POST', body }); },
        patch(path, body) { return this.request(path, { method: 'PATCH', body }); },
        delete(path) { return this.request(path, { method: 'DELETE' }); },
        upload(path, formData) { return this.request(path, { method: 'POST', body: formData }); },
    };

    function setSync(mode, label) {
        if (!dom.sync) return;
        dom.sync.classList.toggle('is-syncing', mode === 'syncing');
        dom.sync.classList.toggle('is-error', mode === 'error');
        dom.sync.querySelector('span:last-child').textContent = label;
    }

    async function refreshCsrf() {
        try { state.csrf = (await api.get('auth/csrf')).data?.csrf_token || ''; } catch { /* surfaced by original action */ }
    }

    async function getCollection(entity, force = false) {
        const cached = state.cache.get(entity);
        if (!force && cached && Date.now() - cached.at < CACHE_TTL) return cached.data;
        const payload = await api.get(entity === 'attachments' ? entity : `${entity}?limit=${COLLECTION_LIMIT}`);
        const data = Array.isArray(payload.data) ? payload.data : [];
        state.cache.set(entity, { data, at: Date.now() });
        updateNavigationCounts();
        return data;
    }

    async function getSettings(force = false) {
        if (!force && state.settings) return state.settings;
        const payload = await api.get('settings');
        state.settings = payload.data || {};
        applyThemeSetting();
        return state.settings;
    }

    function updateNavigationCounts() {
        const projects = state.cache.get('projects')?.data;
        const ideas = state.cache.get('ideas')?.data;
        const budgets = state.cache.get('budgets')?.data;
        const resources = state.cache.get('resources')?.data;
        const projectCount = document.querySelector('#nav-project-count');
        const ideaCount = document.querySelector('#nav-idea-count');
        const budgetCount = document.querySelector('#nav-budget-count');
        const resourceCount = document.querySelector('#nav-resource-count');
        const reminderCount = document.querySelector('#nav-reminder-count');
        if (projects && projectCount) { projectCount.textContent = projects.filter(item => item.status === 'active').length; projectCount.hidden = false; }
        if (ideas && ideaCount) { ideaCount.textContent = ideas.filter(item => !item.archived).length; ideaCount.hidden = false; }
        if (budgets && budgetCount) { budgetCount.textContent = budgets.filter(item => ['sent','approved'].includes(item.status) && Number(item.balance) > 0).length; budgetCount.hidden = false; }
        if (resources && resourceCount) {
            const alerts = resources.filter(item => item.status !== 'inactive' && (item.status === 'attention' || (daysUntil(item.renewal_date) !== null && daysUntil(item.renewal_date) <= 30))).length;
            resourceCount.textContent = alerts;
            resourceCount.hidden = alerts === 0;
        }
        const reminders = state.cache.get('attention')?.data || state.cache.get('reminders')?.data;
        if (reminders && reminderCount) { const count = reminders.filter(item => item.status === 'pending').length; reminderCount.textContent = count; reminderCount.hidden = count === 0; }
    }

    function invalidate(...entities) {
        entities.forEach(entity => state.cache.delete(entity));
        state.dashboard = null;
        state.dashboardAt = 0;
    }

    function relatedCollections(entity) {
        if (entity === 'project') return ['tasks', 'devlogs', 'budgets', 'releases', 'resources', 'reminders', 'time_entries', 'attachments', 'attention', 'snippets'];
        if (entity === 'client') return ['projects', 'budgets'];
        if (entity === 'budget') return ['payments', 'attention'];
        if (entity === 'payment') return ['budgets'];
        if (entity === 'task' || entity === 'lead') return ['attention'];
        if (entity === 'release' || entity === 'resource') return ['attention'];
        if (entity === 'reminder') return ['calendar', 'attention'];
        if (entity === 'time_entry') return ['profitability', 'weekly_reviews'];
        if (entity === 'weekly_review') return [];
        if (entity === 'tag') return ['projects','ideas','tasks','devlogs','clients','leads','budgets','releases','resources','reminders','time_entries','weekly_reviews'];
        return [];
    }

    function renderLoading() {
        if (state.quietRender && dom.view.children.length) return;
        dom.view.setAttribute('aria-busy', 'true');
        dom.view.innerHTML = `<div class="page-skeleton" aria-label="Cargando"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-subtitle"></div><div class="skeleton-grid"><div></div><div></div><div></div><div></div></div><div class="skeleton skeleton-panel"></div></div>`;
    }

    function renderError(error) {
        dom.view.setAttribute('aria-busy', 'false');
        dom.view.innerHTML = `<div class="empty-state error-state"><div class="empty-inner"><div class="empty-art"><span>!</span></div><h2>No pudimos abrir esta página</h2><p>${escapeHTML(error?.message || 'Ocurrió algo inesperado.')}</p><button class="button button-secondary" type="button" data-retry>${icon('arrow')} Volver a intentar</button></div></div>`;
    }

    function emptyState(entity, title, copy) {
        return `<div class="empty-state"><div class="empty-inner"><div class="empty-art">${icon('plus')}</div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(copy)}</p><button class="button button-primary" type="button" data-create="${entity}">Crear ${ENTITY_NAMES[entity]}</button></div></div>`;
    }

    // Dashboard en dos columnas independientes: cada bloque se coloca, en el orden elegido, bajo la columna
    // más corta. Así no quedan huecos entre tarjetas de alturas distintas. Los bloques anchos cortan la rejilla.
    const DASHBOARD_TWO_COLUMNS = window.matchMedia('(min-width: 941px)');
    function layoutDashboard() {
        const grid = dom.view.querySelector('.dashboard-widget-grid');
        if (!grid) return;
        if (!grid.widgetOrder) grid.widgetOrder = [...grid.children].filter(node => node.classList.contains('dashboard-widget') || node.dataset.dashboardWidget);
        const widgets = grid.widgetOrder;
        grid.replaceChildren();
        if (!DASHBOARD_TWO_COLUMNS.matches) { grid.append(...widgets); return; }
        let columns = null;
        widgets.forEach(widget => {
            if (widget.classList.contains('is-wide')) { columns = null; grid.append(widget); return; }
            if (!columns) {
                const masonry = document.createElement('div');
                masonry.className = 'dashboard-masonry';
                columns = [document.createElement('div'), document.createElement('div')];
                columns.forEach(column => { column.className = 'dashboard-column'; masonry.append(column); });
                grid.append(masonry);
            }
            const target = columns[0].offsetHeight <= columns[1].offsetHeight ? columns[0] : columns[1];
            target.append(widget);
        });
    }
    DASHBOARD_TWO_COLUMNS.addEventListener?.('change', () => { if (state.route === 'dashboard') layoutDashboard(); });

    // ===== Fase 1: Markdown, importes, fechas cortas, paleta de comandos, atajos y exportaciones =====

    // Markdown seguro: todo el texto se escapa antes de añadir solo etiquetas conocidas; los enlaces pasan por safeUrl.
    function markdownInline(text) {
        const codes = [];
        let html = escapeHTML(text).replace(/`([^`\n]+)`/g, (match, code) => { codes.push(`<code>${code}</code>`); return `\u0001${codes.length - 1}\u0001`; });
        html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
            const href = safeUrl(url.replace(/&amp;/g, '&'));
            return href === '#' ? label : `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        });
        html = html.replace(/(^|\s)(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (match, space, url) => {
            const href = safeUrl(url.replace(/&amp;/g, '&'));
            return href === '#' ? match : `${space}<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });
        html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
            .replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
            .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
        return html.replace(/\u0001(\d+)\u0001/g, (match, index) => codes[Number(index)]);
    }
    function markdownHTML(source = '') {
        const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
        const LIST = /^\s*([-*+]|\d+[.)])\s+/;
        const isBlockStart = line => /^```/.test(line) || /^#{1,3}\s/.test(line) || LIST.test(line) || /^>\s?/.test(line) || /^\s*(---|\*\*\*)\s*$/.test(line);
        const out = [];
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            if (!line.trim()) { i += 1; continue; }
            const fence = line.match(/^```\s*([\w#+.-]*)\s*$/);
            if (fence) {
                const code = []; i += 1;
                while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
                i += 1;
                out.push(`<pre class="md-code"${fence[1] ? ` data-lang="${escapeHTML(fence[1])}"` : ''}><code>${escapeHTML(code.join('\n'))}</code></pre>`);
                continue;
            }
            const heading = line.match(/^(#{1,3})\s+(.*)$/);
            if (heading) { out.push(`<p class="md-heading md-h${heading[1].length}">${markdownInline(heading[2])}</p>`); i += 1; continue; }
            if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push('<hr>'); i += 1; continue; }
            if (/^>\s?/.test(line)) {
                const quote = [];
                while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
                out.push(`<blockquote>${quote.map(markdownInline).join('<br>')}</blockquote>`);
                continue;
            }
            const marker = line.match(LIST);
            if (marker) {
                const ordered = /\d/.test(marker[1]);
                const items = [];
                while (i < lines.length && LIST.test(lines[i]) && /\d/.test(lines[i].match(LIST)[1]) === ordered) {
                    const item = lines[i++].replace(LIST, '');
                    const task = item.match(/^\[( |x|X)\]\s+(.*)$/);
                    items.push(task
                        ? `<li class="md-task${task[1].trim() ? ' is-done' : ''}"><span class="md-check" aria-hidden="true"></span><span class="sr-only">${task[1].trim() ? 'Hecho:' : 'Pendiente:'} </span>${markdownInline(task[2])}</li>`
                        : `<li>${markdownInline(item)}</li>`);
                }
                out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
                continue;
            }
            const paragraph = [];
            do { paragraph.push(lines[i++]); } while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]));
            out.push(`<p>${paragraph.map(markdownInline).join('<br>')}</p>`);
        }
        return `<div class="markdown">${out.join('')}</div>`;
    }
    // Versión en texto plano para tarjetas y listas, donde solo caben dos o tres líneas.
    function markdownPlain(source = '') {
        return String(source ?? '')
            .replace(/```[\w#+.-]*\n?/g, '')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/^\s*#{1,3}\s+/gm, '')
            .replace(/^\s*>\s?/gm, '')
            .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, '')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/~~([^~]+)~~/g, '$1')
            .replace(/(^|\s)[*_]([^*_\n]+)[*_]/g, '$1$2')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }

    // Importes: el símbolo y los céntimos se atenúan (marca). En listas van en DM Mono con la clase .amount.
    function moneyHTML(value, currency) {
        const safeCurrency = ['ARS', 'USD', 'EUR'].includes(currency) ? currency : (['ARS', 'USD', 'EUR'].includes(state.settings?.default_currency) ? state.settings.default_currency : 'USD');
        const parts = new Intl.NumberFormat('es-AR', { style: 'currency', currency: safeCurrency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).formatToParts(Number(value) || 0);
        let fraction = '';
        const main = parts.map(part => {
            if (part.type === 'decimal' || part.type === 'fraction') { fraction += part.value; return ''; }
            if (part.type === 'currency') return `<span class="money-symbol">${escapeHTML(part.value)}</span>`;
            return escapeHTML(part.value);
        }).join('');
        return `<span class="money">${main}${fraction ? `<span class="money-cents">${escapeHTML(fraction)}</span>` : ''}</span>`;
    }

    // Fechas cortas para listas y tarjetas: «12 nov», con el año solo si no es el actual.
    function shortDate(value) {
        const civil = zonedCivil(value);
        if (!civil) return 'Sin fecha';
        const label = formatDate(civil, { day: 'numeric', month: 'short' });
        const year = civil.slice(0, 4);
        return year === String(zonedCivil(new Date()) || '').slice(0, 4) ? label : `${label} ${year}`;
    }
    function shortRange(from, to) { return `${shortDate(from)} – ${shortDate(to)}`; }

    // ----- Paleta de comandos (Ctrl K) y búsqueda con operadores -----
    const SEARCH_TYPES = {
        proyecto: 'projects', proyectos: 'projects', idea: 'ideas', ideas: 'ideas', semillero: 'ideas', tarea: 'tasks', tareas: 'tasks',
        cliente: 'clients', clientes: 'clients', oportunidad: 'leads', oportunidades: 'leads', bitacora: 'devlogs', 'bitácora': 'devlogs', entrada: 'devlogs',
        presupuesto: 'budgets', presupuestos: 'budgets', cobro: 'payments', cobros: 'payments', entrega: 'releases', entregas: 'releases', version: 'releases', 'versión': 'releases',
        recurso: 'resources', recursos: 'resources', recordatorio: 'reminders', recordatorios: 'reminders', tiempo: 'time_entries', registro: 'time_entries',
        revision: 'weekly_reviews', 'revisión': 'weekly_reviews', fragmento: 'snippets', fragmentos: 'snippets', snippet: 'snippets', codigo: 'snippets', 'código': 'snippets', etiqueta: 'tags', etiquetas: 'tags', archivo: 'attachments', archivos: 'attachments',
    };
    function parseSearchQuery(query) {
        const parsed = { text: [], types: [], project: '', tags: [], status: '' };
        String(query || '').trim().split(/\s+/).filter(Boolean).forEach(token => {
            const lower = token.toLocaleLowerCase('es');
            const [key, ...rest] = lower.split(':');
            const value = rest.join(':');
            if (value && (key === 'tipo' || key === 'en')) { if (SEARCH_TYPES[value]) parsed.types.push(SEARCH_TYPES[value]); return; }
            if (value && key === 'proyecto') { parsed.project = value; return; }
            if (value && key === 'estado') { parsed.status = value; return; }
            if (lower.startsWith('#') && lower.length > 1) { parsed.tags.push(lower.slice(1)); return; }
            parsed.text.push(lower);
        });
        return parsed;
    }
    function searchMatches(item, route, parsed, titleField, subtitleField) {
        const haystack = [item[titleField], item[subtitleField], item.email, item.notes, item.content, item.description, item.version, item.reference, ...asArray(item.tags), ...asArray(item.tech_stack)]
            .map(value => String(value || '').toLocaleLowerCase('es')).join(' ');
        if (parsed.text.some(word => !haystack.includes(word))) return false;
        if (parsed.tags.length) {
            const tags = asArray(item.tags).map(tag => String(tag).toLocaleLowerCase('es'));
            if (parsed.tags.some(tag => !tags.some(value => value.includes(tag)))) return false;
        }
        if (parsed.project) {
            const projectName = String(route === 'projects' ? item.name : item.project_name || '').toLocaleLowerCase('es');
            if (!projectName.includes(parsed.project)) return false;
        }
        if (parsed.status) {
            const status = `${item.status || ''} ${STATUS[item.status] || ''}`.toLocaleLowerCase('es');
            if (!status.includes(parsed.status)) return false;
        }
        return true;
    }

    const NAV_SHORTCUTS = { d: 'dashboard', p: 'projects', s: 'ideas', t: 'tasks', a: 'calendar', b: 'devlogs', c: 'clients', o: 'leads', f: 'budgets', h: 'time', r: 'reminders', e: 'releases', i: 'resources', w: 'weekly', x: 'files', k: 'settings' };
    function paletteCommands() {
        const routeKey = Object.fromEntries(Object.entries(NAV_SHORTCUTS).map(([key, route]) => [route, key]));
        const go = route => () => { history.pushState(null, '', `#${route}`); navigate(route); };
        return [
            ...['project', 'task', 'idea', 'devlog', 'client', 'time_entry', 'reminder', 'budget', 'release', ...(feature('snippets') ? ['snippet'] : [])].map(entity => ({ id: `create-${entity}`, label: newLabel(entity), hint: entity === 'project' ? 'N' : '', icon: 'plus', run: () => openEntityDialog(entity) })),
            { id: 'timer', label: 'Iniciar temporizador', icon: 'clock', run: () => openEntityDialog('time_entry', null, { timer_start: true, work_date: todayISO(), billable: 1 }) },
            ...ROUTES.filter(route => route !== 'snippets' || feature('snippets')).map(route => ({ id: `go-${route}`, label: `Ir a ${ROUTE_NAMES[route]}`, hint: routeKey[route] ? `G ${routeKey[route].toUpperCase()}` : '', icon: 'chevron', run: go(route) })),
            { id: 'theme', label: 'Cambiar tema claro u oscuro', icon: 'sun', run: () => document.querySelector('#theme-button')?.click() },
            { id: 'export', label: 'Exportar datos', icon: 'receipt', run: go('settings') },
            { id: 'shortcuts', label: 'Ver atajos de teclado', hint: '?', icon: 'search', run: () => openShortcutsHelp() },
        ];
    }
    function commandResults(commands, title) {
        if (!commands.length) return '';
        return `<p class="search-group-title">${escapeHTML(title)}</p>${commands.map(command => `<button class="search-result search-command" type="button" data-command="${escapeHTML(command.id)}"><span class="search-result-icon">${icon(command.icon)}</span><span><strong>${escapeHTML(command.label)}</strong></span>${command.hint ? `<kbd>${escapeHTML(command.hint)}</kbd>` : ''}</button>`).join('')}`;
    }
    function moveSearchSelection(step) {
        const results = [...dom.searchResults.querySelectorAll('.search-result')];
        if (!results.length) return;
        const current = results.findIndex(result => result.classList.contains('is-selected'));
        const next = current === -1 ? (step > 0 ? 0 : results.length - 1) : (current + step + results.length) % results.length;
        results.forEach((result, index) => { result.classList.toggle('is-selected', index === next); result.setAttribute('aria-selected', String(index === next)); });
        results[next].scrollIntoView({ block: 'nearest' });
    }

    // ----- Atajos de teclado -----
    let pendingGoKey = 0;
    function isTypingTarget(target) {
        return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"], [role="combobox"]'));
    }
    function anyModalOpen() {
        return [...document.querySelectorAll('dialog')].some(dialog => dialog.open);
    }
    function openShortcutsHelp() {
        let dialog = document.querySelector('#shortcuts-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'shortcuts-dialog';
            dialog.className = 'app-dialog shortcuts-dialog';
            dialog.setAttribute('aria-labelledby', 'shortcuts-title');
            const navigation = Object.entries(NAV_SHORTCUTS).map(([key, route]) => [`G ${key.toUpperCase()}`, ROUTE_NAMES[route]]);
            const rows = [['Ctrl K', 'Paleta de comandos y búsqueda'], ['/', 'Buscar'], ['N', 'Crear algo nuevo'], ['E', 'Editar la ficha abierta'], ['?', 'Ver estos atajos'], ['Esc', 'Cerrar ventanas y menús'], ...navigation];
            dialog.innerHTML = `<header class="dialog-header"><div><span class="dialog-kicker">Teclado</span><h2 id="shortcuts-title">Atajos</h2></div><button class="icon-button" type="button" data-shortcuts-close aria-label="Cerrar atajos"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="dialog-body"><p class="shortcuts-note">En la búsqueda puedes filtrar con <code>tipo:tarea</code>, <code>proyecto:atlas</code>, <code>estado:curso</code> o <code>#etiqueta</code>.</p><dl class="shortcuts-list">${rows.map(([keys, label]) => `<div><dt>${keys.split(' ').map(key => `<kbd>${escapeHTML(key)}</kbd>`).join(' ')}</dt><dd>${escapeHTML(label)}</dd></div>`).join('')}</dl></div>`;
            dialog.addEventListener('click', event => { if (event.target === dialog || event.target.closest('[data-shortcuts-close]')) dialog.close(); });
            document.body.append(dialog);
        }
        if (!dialog.open) dialog.showModal();
    }
    function handleShortcut(event) {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            if (dom.searchDialog.open) dom.searchDialog.close(); else openSearch();
            return;
        }
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
        if (event.key === 'e' || event.key === 'E') {
            const edit = dom.projectPreviewDialog?.open ? dom.projectPreviewDialog.querySelector('.project-preview-footer [data-project-preview-edit]')
                : dom.recordPreviewDialog?.open ? dom.recordPreviewDialog.querySelector('[data-record-preview-edit]') : null;
            if (edit) { event.preventDefault(); edit.click(); }
            return;
        }
        if (anyModalOpen() || !dom.authOverlay.hidden) return;
        if (event.key === '?') { event.preventDefault(); openShortcutsHelp(); return; }
        if (event.key === 'n' || event.key === 'N') { event.preventDefault(); document.querySelector('#quick-create')?.click(); return; }
        if (event.key === 'g' || event.key === 'G') { pendingGoKey = Date.now(); return; }
        if (pendingGoKey && Date.now() - pendingGoKey < 1200) {
            const route = NAV_SHORTCUTS[event.key.toLowerCase()];
            pendingGoKey = 0;
            if (route) { event.preventDefault(); history.pushState(null, '', `#${route}`); navigate(route); }
        }
    }

    // ----- Exportaciones (se generan en el navegador con los datos de tu cuenta; no cambian nada) -----
    function downloadFile(name, content, type) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = document.createElement('a');
        link.href = url; link.download = name; link.hidden = true;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    // Las celdas de texto que empiezan por = + - @ se protegen para que una hoja de cálculo no las ejecute como fórmula.
    const csvText = value => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
    const csvNumber = value => (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) ? '' : String(Math.round(Number(value) * 100) / 100).replace('.', ',');
    const toCSV = (headers, rows) => `\ufeff${[headers.map(csvText).join(';'), ...rows.map(row => row.join(';'))].join('\r\n')}`;
    const exportStamp = () => todayISO();
    async function exportData(kind, button) {
        if (button) button.disabled = true;
        try {
            if (kind === 'time') {
                const rows = await getCollection('time_entries', true);
                const tasks = await getCollection('tasks').catch(() => []);
                const taskName = id => tasks.find(task => Number(task.id) === Number(id))?.title || '';
                const csv = toCSV(['Fecha', 'Proyecto', 'Tarea', 'Descripción', 'Minutos', 'Horas', 'Facturable', 'Coste por hora', 'Moneda', 'Etiquetas'],
                    rows.map(item => { const minutes = elapsedMinutes(item); return [csvText(item.work_date), csvText(item.project_name), csvText(taskName(item.task_id)), csvText(item.description), csvNumber(minutes), csvNumber(minutes / 60), csvText(Number(item.billable) ? 'Sí' : 'No'), csvNumber(item.hourly_cost), csvText(item.cost_currency), csvText(asArray(item.tags).join(', '))]; }));
                downloadFile(`codepanel-tiempo-${exportStamp()}.csv`, csv, 'text/csv;charset=utf-8');
            } else if (kind === 'payments') {
                const [payments, budgets] = await Promise.all([getCollection('payments', true), getCollection('budgets')]);
                const budgetOf = id => budgets.find(budget => Number(budget.id) === Number(id)) || {};
                const csv = toCSV(['Fecha', 'Presupuesto', 'Cliente', 'Proyecto', 'Importe', 'Moneda', 'Medio', 'Referencia', 'Notas'],
                    payments.map(item => { const budget = budgetOf(item.budget_id); return [csvText(item.paid_at), csvText(item.budget_title || budget.title), csvText(budget.client_name), csvText(budget.project_name), csvNumber(item.amount), csvText(budget.currency), csvText(PAYMENT_METHODS[item.method] || item.method), csvText(item.reference), csvText(item.notes)]; }));
                downloadFile(`codepanel-cobros-${exportStamp()}.csv`, csv, 'text/csv;charset=utf-8');
            } else if (kind === 'backup') {
                const routes = [...new Set([...Object.values(ENTITY_ROUTE), 'attachments'])].filter(route => route !== 'snippets' || feature('snippets'));
                const results = await Promise.allSettled(routes.map(route => getCollection(route, true)));
                const data = Object.fromEntries(routes.map((route, index) => [route, results[index].status === 'fulfilled' ? results[index].value : []]));
                const backup = { app: 'CodePanel', exported_at: new Date().toISOString(), settings: state.settings || {}, data };
                downloadFile(`codepanel-copia-${exportStamp()}.json`, JSON.stringify(backup, null, 2), 'application/json');
            } else if (kind === 'calendar') {
                const today = new Date();
                const from = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
                const to = new Date(today.getTime() + 334 * 86_400_000).toISOString().slice(0, 10);
                const events = (await api.get(`calendar?from=${from}&to=${to}`)).data || [];
                const icsText = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
                const day = value => String(value || '').slice(0, 10).replace(/-/g, '');
                const nextDay = value => { const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10).replace(/-/g, ''); };
                const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
                const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//valentindg//CodePanel//ES', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:CodePanel',
                    ...events.filter(event => /^\d{4}-\d{2}-\d{2}/.test(String(event.date || ''))).flatMap(event => ['BEGIN:VEVENT', `UID:${icsText(event.key || `${event.source_type}-${event.source_id}`)}@codepanel`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(event.date)}`, `DTEND;VALUE=DATE:${nextDay(event.date)}`, `SUMMARY:${icsText(event.title)}`, `DESCRIPTION:${icsText([CALENDAR_SOURCE_LABEL(event.source_type), event.project_name].filter(Boolean).join(' · '))}`, 'END:VEVENT']),
                    'END:VCALENDAR'];
                downloadFile(`codepanel-calendario-${exportStamp()}.ics`, lines.join('\r\n'), 'text/calendar;charset=utf-8');
            }
            toast('Exportación lista', 'El archivo se ha descargado en tu equipo.');
        } catch (error) {
            toast('No pudimos exportar', error.message || 'Inténtalo de nuevo en un momento.', 'error');
        } finally { if (button) button.disabled = false; }
    }
    const CALENDAR_SOURCE_LABEL = type => ({ task: 'Tarea', reminder: 'Recordatorio', release: 'Entrega', budget: 'Presupuesto', payment: 'Cobro', resource: 'Recurso', project: 'Proyecto', lead: 'Oportunidad', client: 'Cliente' }[type] || 'Evento');

    // ----- Temporizador: arrancar desde una tarea y verlo en la cabecera mientras corre -----
    async function startTimerForTask(taskId) {
        const tasks = await getCollection('tasks');
        const task = tasks.find(item => Number(item.id) === Number(taskId));
        if (!task) return;
        state.formReturn = rememberPreview();
        if (dom.projectPreviewDialog?.open) closeProjectPreview();
        if (dom.recordPreviewDialog?.open) closeRecordPreview();
        await openEntityDialog('time_entry', null, { timer_start: true, work_date: todayISO(), billable: 1, task_id: task.id, project_id: task.project_id || '', description: task.title || '' });
    }
    let timerPillInterval = 0;
    async function refreshTimerPill() {
        const actions = document.querySelector('.topbar-actions');
        if (!actions || !state.user) return;
        let entries = state.cache.get('time_entries')?.data;
        if (!entries) { try { entries = await getCollection('time_entries'); } catch { return; } }
        const running = (entries || []).find(item => Boolean(item.is_running) || (item.started_at && !item.ended_at));
        let pill = actions.querySelector('.timer-pill');
        clearInterval(timerPillInterval);
        if (!running) { pill?.remove(); return; }
        if (!pill) {
            pill = document.createElement('a');
            pill.className = 'timer-pill';
            pill.href = '#time';
            pill.dataset.nav = 'time';
            actions.prepend(pill);
        }
        const paint = () => {
            const minutes = elapsedMinutes(running);
            const label = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
            pill.innerHTML = `<span class="timer-pill-dot" aria-hidden="true"></span><span class="timer-pill-time">${label}</span><span class="sr-only">Temporizador en marcha: ${escapeHTML(running.description || running.project_name || 'trabajo')}</span>`;
            pill.title = `En marcha: ${running.description || running.project_name || 'trabajo'}`;
        };
        paint();
        timerPillInterval = setInterval(paint, 30_000);
    }

    // ----- Tareas en tablero -----
    const TASK_COLUMNS = [['todo', 'Por hacer', 'var(--purple)'], ['in_progress', 'En curso', 'var(--blue)'], ['done', 'Hechas', 'var(--sage)']];
    function taskKanbanCard(task) {
        return `<article class="kanban-card task-kanban-card${task.status === 'done' ? ' is-done' : ''}" draggable="true" data-kanban-task="${Number(task.id)}" data-record-preview="task" data-id="${Number(task.id)}">
            <h3>${escapeHTML(task.title || 'Tarea sin título')}</h3>
            <p>${escapeHTML(task.project_name || 'Sin proyecto')}</p>
            ${taskExtrasMarkup(task) ? `<div class="task-kanban-chips">${taskExtrasMarkup(task)}</div>` : ''}
            <footer><span class="task-kanban-meta"><i class="priority-dot priority-${escapeHTML(task.priority || 'medium')}" style="--priority-color:${task.priority === 'urgent' || task.priority === 'high' ? 'var(--danger)' : task.priority === 'low' ? 'var(--sage)' : 'var(--yellow)'}"></i>${escapeHTML(PRIORITY[task.priority] || 'Media')}</span>${task.due_date ? dueMarkup(task.due_date) : ''}</footer>
            <div class="kanban-card-controls"><label><span>Estado</span><select data-task-status-select="${Number(task.id)}" aria-label="Cambiar estado de ${escapeHTML(task.title || 'la tarea')}">${optionList(TASK_COLUMNS.map(([value, label]) => [value, label]), task.status)}</select></label>${task.status !== 'done' ? `<button class="text-button" type="button" data-task-timer="${Number(task.id)}">${icon('clock')}Empezar</button>` : ''}</div>
        </article>`;
    }
    function taskBoard(tasks) {
        return `<div class="kanban-board task-kanban">${TASK_COLUMNS.map(([status, label, color]) => { const items = tasks.filter(task => task.status === status); return `<section class="kanban-column" data-task-column="${status}" style="--column-color:${color}" aria-label="${escapeHTML(label)}"><header class="kanban-header"><strong><i class="kanban-dot"></i>${escapeHTML(label)}</strong><span>${items.length}</span></header><div class="kanban-items">${items.length ? items.map(taskKanbanCard).join('') : '<div class="kanban-empty">Arrastra aquí una tarea.</div>'}</div></section>`; }).join('')}</div>`;
    }
    async function updateTaskStatus(id, status) {
        if (!TASK_COLUMNS.some(([value]) => value === status)) return;
        try {
            await api.patch(`tasks/${Number(id)}`, { status });
            invalidate('tasks', 'attention');
            await refreshView();
        } catch (error) { toast('No pudimos mover la tarea', error.message, 'error'); await refreshView(); }
    }
    function bindTaskBoard() {
        let draggedTask = 0;
        document.addEventListener('dragstart', event => {
            const card = event.target.closest?.('[data-kanban-task]');
            if (!card) return;
            draggedTask = Number(card.dataset.kanbanTask);
            card.classList.add('is-dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(draggedTask));
        });
        document.addEventListener('dragover', event => {
            const column = event.target.closest?.('[data-task-column]');
            if (!column || !draggedTask) return;
            event.preventDefault();
            document.querySelectorAll('[data-task-column].is-drop-target').forEach(node => { if (node !== column) node.classList.remove('is-drop-target'); });
            column.classList.add('is-drop-target');
        });
        document.addEventListener('drop', event => {
            const column = event.target.closest?.('[data-task-column]');
            if (!column || !draggedTask) return;
            event.preventDefault();
            const id = draggedTask; draggedTask = 0;
            column.classList.remove('is-drop-target');
            state.kanban.suppressClickUntil = Date.now() + 500;
            updateTaskStatus(id, column.dataset.taskColumn);
        });
        document.addEventListener('dragend', () => {
            draggedTask = 0;
            document.querySelectorAll('.is-dragging').forEach(node => node.classList.remove('is-dragging'));
            document.querySelectorAll('[data-task-column].is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
        });
    }

    // ----- Revisión semanal: propuesta con lo que pasó esta semana -----
    async function weeklyReviewPrefill() {
        const week = weekBounds(new Date());
        const inWeek = value => { const day = String(value || '').slice(0, 10); return day >= week.start && day <= week.end; };
        const [tasks, devlogs, releases, entries] = await Promise.all(['tasks', 'devlogs', 'releases', 'time_entries'].map(route => getCollection(route).catch(() => [])));
        const doneTasks = tasks.filter(task => task.status === 'done' && inWeek(task.completed_at || task.updated_at));
        const shipped = releases.filter(release => inWeek(release.release_date));
        const learned = devlogs.filter(entry => inWeek(entry.entry_date || entry.created_at) && ['progress', 'decision', 'learning'].includes(entry.entry_type));
        const blockers = devlogs.filter(entry => inWeek(entry.entry_date || entry.created_at) && entry.entry_type === 'blocker');
        const minutes = entries.filter(entry => inWeek(entry.work_date)).reduce((sum, entry) => sum + elapsedMinutes(entry), 0);
        const next = tasks.filter(task => task.status !== 'done').sort((a, b) => ['urgent', 'high', 'medium', 'low'].indexOf(a.priority) - ['urgent', 'high', 'medium', 'low'].indexOf(b.priority) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))).slice(0, 3);
        const list = items => items.map(item => `- ${item}`).join('\n');
        const wins = [
            doneTasks.length ? list(doneTasks.slice(0, 8).map(task => `${task.title}${task.project_name ? ` (${task.project_name})` : ''}`)) : '',
            shipped.length ? list(shipped.map(release => `Entrega: ${release.version ? `${release.version} · ` : ''}${release.title}`)) : '',
            learned.length ? list(learned.slice(0, 5).map(entry => entry.title)) : '',
            minutes ? `- ${minutesLabel(minutes)} registrados` : '',
        ].filter(Boolean).join('\n');
        return {
            week_start: week.start,
            wins,
            blockers: blockers.length ? list(blockers.map(entry => entry.title)) : '',
            next_focus: next.length ? list(next.map(task => task.title)) : '',
        };
    }

    // ===== Desplegables con el estilo de la marca =====
    // El <select> nativo se queda debajo (formularios, validación y eventos «change» siguen igual) y encima se
    // pinta un botón con su lista. En pantallas táctiles se deja el selector del sistema, que es más cómodo.
    const CUSTOM_SELECTS = window.matchMedia('(hover: hover) and (pointer: fine)');
    let selectUid = 0;
    let openSelect = null;
    let selectEscapeAt = 0;

    function selectLabelText(select) {
        const label = select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
        const text = label?.textContent || select.closest('label')?.querySelector('.sr-only')?.textContent || select.getAttribute('aria-label') || '';
        return text.replace(/\s+/g, ' ').trim();
    }
    function syncCustomSelect(select) {
        const ui = select._cpSelect;
        if (!ui) return;
        const option = select.options[select.selectedIndex];
        ui.value.textContent = option ? option.textContent : '';
        ui.value.classList.toggle('is-placeholder', !option || option.value === '');
        ui.button.disabled = select.disabled;
        ui.root.classList.toggle('is-disabled', select.disabled);
        ui.root.classList.toggle('is-invalid', select.getAttribute('aria-invalid') === 'true');
    }
    function closeCustomSelect({ focus = false } = {}) {
        if (!openSelect) return;
        const { ui } = openSelect;
        ui.menu.hidden = true;
        ui.button.setAttribute('aria-expanded', 'false');
        ui.button.removeAttribute('aria-activedescendant');
        ui.root.classList.remove('is-open');
        if (focus) ui.button.focus({ preventScroll: true });
        openSelect = null;
    }
    function positionCustomSelect(ui) {
        const rect = ui.button.getBoundingClientRect();
        const width = Math.max(rect.width, 180);
        const below = window.innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const openUp = below < 220 && above > below;
        const maxHeight = Math.max(160, Math.min(320, openUp ? above : below));
        Object.assign(ui.menu.style, {
            left: `${Math.min(rect.left, window.innerWidth - width - 8)}px`,
            width: `${width}px`,
            maxHeight: `${maxHeight}px`,
            top: openUp ? '' : `${rect.bottom + 6}px`,
            bottom: openUp ? `${window.innerHeight - rect.top + 6}px` : '',
        });
        ui.menu.classList.toggle('is-up', openUp);
    }
    function renderCustomOptions(select, query = '') {
        const ui = select._cpSelect;
        const clean = query.trim().toLocaleLowerCase('es');
        const options = [...select.options].filter(option => !option.hidden && (!clean || option.textContent.toLocaleLowerCase('es').includes(clean)));
        ui.list.innerHTML = options.length ? options.map(option => {
            const index = [...select.options].indexOf(option);
            const selected = index === select.selectedIndex;
            return `<div class="cp-option${selected ? ' is-selected' : ''}${option.disabled ? ' is-disabled' : ''}${option.value === '' ? ' is-empty' : ''}" role="option" id="${ui.id}-o${index}" data-index="${index}" aria-selected="${selected}"${option.disabled ? ' aria-disabled="true"' : ''}><span>${escapeHTML(option.textContent)}</span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></div>`;
        }).join('') : '<p class="cp-option-empty">Sin coincidencias</p>';
        const active = ui.list.querySelector('.cp-option.is-selected:not(.is-disabled)') || ui.list.querySelector('.cp-option:not(.is-disabled)');
        setActiveOption(select, active);
    }
    function setActiveOption(select, option) {
        const ui = select._cpSelect;
        ui.list.querySelectorAll('.cp-option.is-active').forEach(node => node.classList.remove('is-active'));
        if (!option) { ui.button.removeAttribute('aria-activedescendant'); ui.search?.removeAttribute('aria-activedescendant'); return; }
        option.classList.add('is-active');
        ui.button.setAttribute('aria-activedescendant', option.id);
        ui.search?.setAttribute('aria-activedescendant', option.id);
        // Solo se desplaza la lista: scrollIntoView movería también la página y cerraría el menú.
        const list = ui.list;
        if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop - 6;
        else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight + 6;
    }
    function moveActiveOption(select, step) {
        const ui = select._cpSelect;
        const options = [...ui.list.querySelectorAll('.cp-option:not(.is-disabled)')];
        if (!options.length) return;
        const current = options.indexOf(ui.list.querySelector('.cp-option.is-active'));
        const next = step === Infinity ? options.length - 1 : step === -Infinity ? 0 : Math.max(0, Math.min(options.length - 1, (current === -1 ? 0 : current + step)));
        setActiveOption(select, options[next]);
    }
    function chooseCustomOption(select, index) {
        const option = select.options[index];
        if (!option || option.disabled) return;
        const changed = select.selectedIndex !== index;
        select.selectedIndex = index;
        syncCustomSelect(select);
        closeCustomSelect({ focus: true });
        if (changed) {
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
    function openCustomSelect(select) {
        const ui = select._cpSelect;
        if (select.disabled) return;
        if (openSelect && openSelect.select !== select) closeCustomSelect();
        openSelect = { select, ui };
        ui.root.classList.add('is-open');
        ui.button.setAttribute('aria-expanded', 'true');
        ui.menu.hidden = false;
        if (ui.search) ui.search.value = '';
        renderCustomOptions(select);
        positionCustomSelect(ui);
        if (ui.search) ui.search.focus({ preventScroll: true });
    }
    function enhanceSelect(select) {
        if (select._cpSelect || select.multiple || select.size > 1 || select.closest('.cp-select, [data-native-select]')) return;
        const id = `cp-select-${++selectUid}`;
        const root = document.createElement('div');
        root.className = 'cp-select';
        const startWidth = select.closest('.select-wrap, .kanban-card-controls') ? select.offsetWidth : 0;
        select.before(root);
        root.append(select);
        const many = select.options.length > 10;
        const labelText = selectLabelText(select);
        root.insertAdjacentHTML('beforeend', `<button class="cp-select-trigger" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list"${labelText ? ` aria-label="${escapeHTML(labelText)}"` : ''}><span class="cp-select-value"></span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button><div class="cp-select-menu" hidden>${many ? `<div class="cp-select-search"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg><input type="text" placeholder="Buscar…" autocomplete="off" aria-label="Filtrar opciones" aria-controls="${id}-list"></div>` : ''}<div class="cp-select-list" role="listbox" id="${id}-list"${labelText ? ` aria-label="${escapeHTML(labelText)}"` : ''}></div></div>`);
        const ui = { id, root, button: root.querySelector('.cp-select-trigger'), value: root.querySelector('.cp-select-value'), menu: root.querySelector('.cp-select-menu'), list: root.querySelector('.cp-select-list'), search: root.querySelector('.cp-select-search input') };
        select._cpSelect = ui;
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');
        if (startWidth > 0) root.style.minWidth = `${startWidth}px`;
        syncCustomSelect(select);

        select.addEventListener('change', () => syncCustomSelect(select));
        select.addEventListener('focus', () => ui.button.focus());
        new MutationObserver(() => syncCustomSelect(select)).observe(select, { attributes: true, attributeFilter: ['disabled', 'aria-invalid'], childList: true });
        ui.button.addEventListener('click', () => { if (openSelect?.select === select) closeCustomSelect(); else openCustomSelect(select); });
        ui.button.addEventListener('keydown', event => {
            const open = openSelect?.select === select;
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key) && !open) { event.preventDefault(); openCustomSelect(select); return; }
            if (!open) {
                // Escribir una letra con el desplegable cerrado elige la primera opción que empieza así.
                if (event.key.length === 1 && /\S/.test(event.key)) {
                    const start = select.selectedIndex + 1;
                    const options = [...select.options];
                    const match = [...options.slice(start), ...options.slice(0, start)].find(option => !option.disabled && option.textContent.trim().toLocaleLowerCase('es').startsWith(event.key.toLocaleLowerCase('es')));
                    if (match) { event.preventDefault(); chooseCustomOption(select, options.indexOf(match)); }
                }
                return;
            }
            handleOpenSelectKey(event, select);
        });
        ui.search?.addEventListener('input', () => renderCustomOptions(select, ui.search.value));
        ui.search?.addEventListener('keydown', event => handleOpenSelectKey(event, select));
        ui.list.addEventListener('mousedown', event => event.preventDefault());
        ui.list.addEventListener('click', event => { const option = event.target.closest('.cp-option'); if (option) chooseCustomOption(select, Number(option.dataset.index)); });
        ui.list.addEventListener('mousemove', event => { const option = event.target.closest('.cp-option:not(.is-disabled)'); if (option && !option.classList.contains('is-active')) setActiveOption(select, option); });
    }
    function handleOpenSelectKey(event, select) {
        const ui = select._cpSelect;
        if (event.key === 'ArrowDown') { event.preventDefault(); moveActiveOption(select, 1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); moveActiveOption(select, -1); }
        else if (event.key === 'Home' && !ui.search) { event.preventDefault(); moveActiveOption(select, -Infinity); }
        else if (event.key === 'End' && !ui.search) { event.preventDefault(); moveActiveOption(select, Infinity); }
        else if (event.key === 'Enter' || (event.key === ' ' && !ui.search)) { event.preventDefault(); const active = ui.list.querySelector('.cp-option.is-active'); if (active) chooseCustomOption(select, Number(active.dataset.index)); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); selectEscapeAt = Date.now(); closeCustomSelect({ focus: true }); }
        else if (event.key === 'Tab') closeCustomSelect();
    }
    function enhanceSelects(root = document) {
        if (!CUSTOM_SELECTS.matches) return;
        root.querySelectorAll('select:not([multiple])').forEach(enhanceSelect);
    }
    function bindCustomSelects() {
        if (!CUSTOM_SELECTS.matches) return;
        enhanceSelects();
        let pending = false;
        new MutationObserver(() => {
            if (pending) return;
            pending = true;
            queueMicrotask(() => { pending = false; enhanceSelects(); if (openSelect && !document.contains(openSelect.ui.root)) openSelect = null; });
        }).observe(document.body, { childList: true, subtree: true });
        document.addEventListener('pointerdown', event => { if (openSelect && !openSelect.ui.root.contains(event.target)) closeCustomSelect(); }, true);
        window.addEventListener('resize', () => closeCustomSelect());
        // Al desplazar la página el menú acompaña a su botón; solo se cierra si el botón sale de la pantalla.
        document.addEventListener('scroll', event => {
            if (!openSelect || openSelect.ui.menu.contains(event.target)) return;
            const rect = openSelect.ui.button.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) closeCustomSelect();
            else positionCustomSelect(openSelect.ui);
        }, true);
        // Escape dentro de un modal cierra antes el desplegable que el modal.
        document.addEventListener('cancel', event => { if (openSelect || Date.now() - selectEscapeAt < 300) { event.preventDefault(); closeCustomSelect({ focus: true }); } }, true);
    }

    // ===== Fase 2: subtareas y estimaciones, fragmentos, accesos y tokens de API =====
    // Cada función depende de una migración: solo se muestra cuando el servidor dice que está lista.
    const feature = name => Boolean(state.features?.[name]);
    function applyFeatureVisibility() {
        document.querySelectorAll('[data-feature]').forEach(node => { node.hidden = !feature(node.dataset.feature); });
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
        } catch { /* se intenta el método antiguo */ }
        const area = document.createElement('textarea');
        area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
        document.body.append(area); area.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        area.remove();
        return ok;
    }

    // ----- Subtareas y estimación -----
    const checklistOf = task => (Array.isArray(task?.checklist) ? task.checklist : []).filter(item => item && String(item.text || '').trim());
    function hoursLabel(minutes) {
        const value = Number(minutes) || 0;
        if (!value) return '';
        const hours = value / 60;
        return hours >= 1 ? `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace('.', ',')} h` : `${value} min`;
    }
    function taskExtrasMarkup(task) {
        const items = checklistOf(task);
        const done = items.filter(item => item.done).length;
        const parts = [];
        if (items.length) parts.push(`<span class="task-chip${done === items.length ? ' is-complete' : ''}" title="Subtareas hechas">${icon('check')}${done}/${items.length}</span>`);
        if (Number(task.estimated_minutes)) parts.push(`<span class="task-chip" title="Estimación">${icon('clock')}${escapeHTML(hoursLabel(task.estimated_minutes))}</span>`);
        return parts.join('');
    }
    function checklistEditorRow(item = { text: '', done: false }) {
        return `<div class="checklist-row"><input type="checkbox" data-check-done aria-label="Hecha"${item.done ? ' checked' : ''}><input type="text" data-check-text value="${escapeHTML(item.text || '')}" maxlength="200" placeholder="Un paso concreto" aria-label="Subtarea"><button class="icon-button" type="button" data-check-remove aria-label="Quitar subtarea"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>`;
    }
    function taskPlanningFields(item = {}) {
        if (!feature('task_checklists')) return '';
        const items = checklistOf(item);
        const hours = Number(item.estimated_minutes) ? Math.round(Number(item.estimated_minutes) / 60 * 100) / 100 : '';
        return `${textField('estimated_hours', 'Estimación', hours, { type: 'number', min: 0.25, max: 1600, step: 0.25, placeholder: 'Ej. 2,5', hint: 'en horas' })}
            <div class="form-field is-wide checklist-field"><label>Subtareas <span>marca las que ya estén hechas</span></label>
                <div class="checklist-editor" data-checklist-editor>${(items.length ? items : []).map(checklistEditorRow).join('')}</div>
                <button class="text-button checklist-add" type="button" data-check-add>${icon('plus')}Añadir subtarea</button>
            </div>`;
    }
    function readChecklistEditor(root = dom.entityForm) {
        const editor = root.querySelector('[data-checklist-editor]');
        if (!editor) return null;
        return [...editor.querySelectorAll('.checklist-row')].map(row => ({ text: row.querySelector('[data-check-text]').value.trim(), done: row.querySelector('[data-check-done]').checked })).filter(item => item.text).slice(0, 50);
    }
    function addChecklistRow(after = null) {
        const editor = dom.entityForm.querySelector('[data-checklist-editor]');
        if (!editor) return;
        if (editor.querySelectorAll('.checklist-row').length >= 50) { toast('Máximo 50 subtareas', 'Agrupa pasos parecidos o divide la tarea.', 'error'); return; }
        const holder = document.createElement('div');
        holder.innerHTML = checklistEditorRow();
        const row = holder.firstElementChild;
        if (after) after.after(row); else editor.append(row);
        row.querySelector('[data-check-text]').focus();
    }
    async function toggleSubtask(taskId, index) {
        const tasks = await getCollection('tasks');
        const task = tasks.find(item => Number(item.id) === Number(taskId));
        if (!task) return;
        const items = checklistOf(task).map((item, position) => position === Number(index) ? { ...item, done: !item.done } : item);
        try {
            const payload = await api.patch(`tasks/${Number(taskId)}`, { checklist: items });
            invalidate('tasks', 'attention');
            const updated = payload.data || { ...task, checklist: items };
            const cached = state.cache.get('tasks');
            if (cached?.data) cached.data = cached.data.map(item => Number(item.id) === Number(taskId) ? updated : item);
            if (dom.recordPreviewDialog?.open && state.recordPreview?.entity === 'task') await openRecordPreview('task', taskId, { quiet: true });
            if (dom.projectPreviewDialog?.open) await openProjectPreview(state.projectPreview.id, { quiet: true });
        } catch (error) { toast('No pudimos guardar la subtarea', error.message, 'error'); }
    }
    function taskChecklistSection(task) {
        const items = checklistOf(task);
        if (!feature('task_checklists') || !items.length) return '';
        const done = items.filter(item => item.done).length;
        return `<section class="record-preview-section"><header class="record-preview-section-head"><div><h3>Subtareas</h3><p>${done} de ${items.length} hechas</p></div></header><div class="progress-bar subtask-progress"><span style="--progress:${Math.round(done / items.length * 100)}%"></span></div><ul class="subtask-list">${items.map((item, index) => `<li><button class="subtask-toggle${item.done ? ' is-done' : ''}" type="button" data-subtask-toggle="${Number(task.id)}" data-index="${index}" aria-pressed="${item.done}"><span class="subtask-box" aria-hidden="true">${item.done ? icon('check') : ''}</span><span>${escapeHTML(item.text)}</span></button></li>`).join('')}</ul></section>`;
    }
    function taskTimeSection(task) {
        if (!feature('task_checklists')) return '';
        const tracked = cachedRows('time_entries').filter(entry => Number(entry.task_id) === Number(task.id)).reduce((sum, entry) => sum + elapsedMinutes(entry), 0);
        const estimate = Number(task.estimated_minutes) || 0;
        if (!estimate && !tracked) return '';
        const rows = [['Estimación', estimate ? hoursLabel(estimate) : 'Sin estimar'], ['Registrado', tracked ? minutesLabel(tracked) : 'Sin registros']];
        if (estimate) rows.push([tracked > estimate ? 'Desviación' : 'Restante', minutesLabel(Math.abs(estimate - tracked))]);
        return previewMetaSection('Tiempo', rows);
    }

    // ----- Fragmentos de código -----
    const SNIPPET_LANGUAGES = ['bash', 'sql', 'php', 'javascript', 'typescript', 'python', 'json', 'yaml', 'css', 'html', 'docker', 'nginx', 'texto'];
    function snippetPreviewCode(content, lines = 8) {
        const all = String(content || '').split('\n');
        return `${escapeHTML(all.slice(0, lines).join('\n'))}${all.length > lines ? '\n…' : ''}`;
    }
    function snippetCard(item) {
        return `<article class="snippet-card" data-record="snippet" data-id="${Number(item.id)}" data-record-preview="snippet">
            <header><div class="snippet-meta">${item.language ? `<span class="snippet-lang">${escapeHTML(item.language)}</span>` : ''}<span>${escapeHTML(item.project_name || 'General')}</span></div>
                <div class="snippet-actions"><button class="icon-button" type="button" data-copy-snippet="${Number(item.id)}" aria-label="Copiar ${escapeHTML(item.title)}" title="Copiar">${icon('copy')}</button><button class="icon-button card-menu-button" type="button" data-card-menu aria-label="Más acciones">${icon('more')}</button>
                <div class="card-actions-menu" hidden><button type="button" data-edit="snippet" data-id="${Number(item.id)}">Editar</button><button class="danger" type="button" data-delete="snippet" data-id="${Number(item.id)}">Eliminar</button></div></div></header>
            <h2>${escapeHTML(item.title)}</h2>
            <pre class="snippet-code"><code>${snippetPreviewCode(item.content)}</code></pre>
            ${asArray(item.tags).length ? `<footer class="snippet-tags">${asArray(item.tags).map(tag => `<span>#${escapeHTML(tag)}</span>`).join('')}</footer>` : ''}
        </article>`;
    }
    function renderSnippets(items) {
        const visible = filtered(items, 'snippets');
        const content = !visible.length
            ? (items.length ? noFilterResults('snippets') : emptyState('snippet', 'Guarda lo que tecleas una y otra vez', 'Comandos de despliegue, consultas SQL o configuraciones. Copiarlos será un clic.'))
            : `<div class="snippet-grid">${visible.map(snippetCard).join('')}</div>`;
        return `${pageHeading('Biblioteca de código', 'Fragmentos <em>a mano</em>.', `${countLabel(items.length, 'fragmento', 'fragmentos')}. Sin claves ni contraseñas: guarda solo dónde están.`, 'snippet')}
            ${collectionToolbar('snippets', visible.length)}${content}`;
    }
    function snippetFields(item, projects, tagCatalog) {
        return `<div class="form-grid">
            <aside class="form-security-note is-wide" role="note">${icon('alert')}<span><strong>Sin secretos.</strong> Si el fragmento necesita una clave, escribe una variable (<code>$API_KEY</code>) y guarda la clave en tu gestor de contraseñas.</span></aside>
            ${textField('title', 'Nombre', item.title, { placeholder: 'Ej. Desplegar en producción', required: true, wide: true })}
            ${selectField('language', 'Lenguaje', item.language || '', SNIPPET_LANGUAGES.map(language => [language, language]), { blank: 'Sin especificar' })}
            ${selectField('project_id', 'Proyecto', item.project_id, projects.map(project => [project.id, project.name]), { blank: 'General' })}
            <div class="form-field is-wide"><label for="field-content">Código</label><textarea class="code-input" id="field-content" name="content" required spellcheck="false" placeholder="git pull origin main&#10;composer install --no-dev">${escapeHTML(item.content ?? '')}</textarea></div>
            ${tagsField(item.tags, tagCatalog, { placeholder: 'deploy, sql, docker' })}
        </div>`;
    }
    function snippetPreviewSection(item) {
        return `<section class="record-preview-section"><header class="record-preview-section-head"><div><h3>Código</h3>${item.language ? `<p>${escapeHTML(item.language)}</p>` : ''}</div><button class="button button-small" type="button" data-copy-snippet="${Number(item.id)}">${icon('copy')}Copiar</button></header><pre class="snippet-code is-full"><code>${escapeHTML(item.content || '')}</code></pre></section>`;
    }
    function projectSnippetsSection(project, snippets) {
        if (!feature('snippets')) return '';
        return `<section class="project-detail-section" aria-labelledby="project-snippets-title"><header><div><h3 id="project-snippets-title">Fragmentos</h3><p>Comandos y consultas de este proyecto.</p></div><button class="button button-small" type="button" data-create="snippet" data-prefill-project="${Number(project.id)}">${icon('plus')}Nuevo fragmento</button></header>${snippets.length ? `<div class="project-snippets">${snippets.map(item => `<div class="project-snippet"><button class="project-snippet-copy" type="button" data-record-preview="snippet" data-id="${Number(item.id)}"><strong>${escapeHTML(item.title)}</strong><code>${escapeHTML(String(item.content || '').split('\n')[0])}</code></button>${item.language ? `<span class="snippet-lang">${escapeHTML(item.language)}</span>` : ''}<button class="icon-button" type="button" data-copy-snippet="${Number(item.id)}" aria-label="Copiar ${escapeHTML(item.title)}" title="Copiar">${icon('copy')}</button></div>`).join('')}</div>` : '<div class="preview-inline-empty">Todavía no hay fragmentos en este proyecto.</div>'}</section>`;
    }
    async function copySnippet(id, button) {
        let snippet = cachedRows('snippets').find(item => Number(item.id) === Number(id))
            || (state.projectPreview.data?.snippets || []).find(item => Number(item.id) === Number(id))
            || (state.recordPreview?.record && Number(state.recordPreview.record.id) === Number(id) ? state.recordPreview.record : null);
        if (!snippet) { try { snippet = (await getCollection('snippets')).find(item => Number(item.id) === Number(id)); } catch { snippet = null; } }
        if (!snippet) return;
        const ok = await copyText(String(snippet.content || ''));
        if (ok && button) { button.classList.add('is-copied'); setTimeout(() => button.classList.remove('is-copied'), 1400); }
        toast(ok ? 'Copiado' : 'No pudimos copiarlo', ok ? snippet.title : 'Selecciona el texto y cópialo a mano.', ok ? 'success' : 'error');
    }

    // ----- Accesos: dónde está cada credencial -----
    function projectAccessSection(resources) {
        if (!feature('credential_refs')) return '';
        const withRef = resources.filter(item => String(item.credential_ref || '').trim());
        if (!withRef.length) return '';
        return `<section class="project-related-section project-access"><header><h3>Accesos</h3><span>${withRef.length}</span></header><div>${withRef.map(item => `<button type="button" data-record-preview="resource" data-id="${Number(item.id)}"><span>${escapeHTML(item.name)}</span><strong>${icon('key')}${escapeHTML(item.credential_ref)}</strong></button>`).join('')}</div></section>`;
    }

    // ----- Tokens de API (Configuración) -----
    function apiTokensSection() {
        if (!feature('api_tokens') || state.demoMode) return '';
        return `<section class="settings-section panel panel-padded settings-tokens" aria-labelledby="tokens-title"><header><span>${icon('key')}</span><div><h2 id="tokens-title">Tokens de API</h2><p>Para usar CodePanel desde la terminal, scripts o tu editor. No sirven para cambiar la cuenta ni para compartir.</p></div></header>
            <form class="token-form" data-token-form>
                <div class="form-field"><label for="token-name">Nombre</label><input id="token-name" name="name" maxlength="80" required placeholder="Ej. Terminal del portátil"></div>
                <div class="form-field"><label for="token-scope">Permisos</label><select id="token-scope" name="scope"><option value="read">Solo lectura</option><option value="write">Lectura y escritura</option></select></div>
                <div class="form-field"><label for="token-expiry">Caduca</label><select id="token-expiry" name="expires_in_days"><option value="90">En 90 días</option><option value="30">En 30 días</option><option value="365">En un año</option><option value="">Nunca</option></select></div>
                <button class="button button-primary" type="submit">Crear token</button>
            </form>
            <div data-token-created></div>
            <div class="token-list" data-token-list><p class="project-sheet-empty">Cargando tokens…</p></div>
        </section>`;
    }
    function tokenUsageExample(token) {
        const endpoint = new URL(`${API_BASE}/tasks`, location.href).href;
        return `curl -H "Authorization: Bearer ${token}" \\\n  "${endpoint}?status=todo"\n\ncurl -X POST -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Revisar los logs"}' \\\n  "${endpoint}"`;
    }
    async function loadApiTokens() {
        const list = document.querySelector('[data-token-list]');
        if (!list) return;
        try {
            const tokens = (await api.get('api-tokens')).data || [];
            list.innerHTML = tokens.length ? tokens.map(token => `<div class="token-row"><div><strong>${escapeHTML(token.name)}</strong><small><code>${escapeHTML(token.token_prefix)}…</code> · ${token.scope === 'write' ? 'Lectura y escritura' : 'Solo lectura'} · ${token.last_used_at ? `usado ${escapeHTML(shortDate(token.last_used_at))}` : 'sin usar'} · ${token.expired ? '<span class="token-expired">caducado</span>' : token.expires_at ? `caduca ${escapeHTML(shortDate(token.expires_at))}` : 'sin caducidad'}</small></div><button class="button button-small" type="button" data-token-revoke="${Number(token.id)}" data-token-name="${escapeHTML(token.name)}">Revocar</button></div>`).join('')
                : '<p class="project-sheet-empty">Todavía no has creado ningún token.</p>';
        } catch (error) { list.innerHTML = `<p class="project-sheet-empty">${escapeHTML(error.message || 'No pudimos cargar los tokens.')}</p>`; }
    }
    async function createApiToken(form) {
        const button = form.querySelector('[type="submit"]');
        const body = Object.fromEntries(new FormData(form).entries());
        if (!String(body.name || '').trim()) { form.querySelector('[name="name"]').focus(); return; }
        body.expires_in_days = body.expires_in_days ? Number(body.expires_in_days) : null;
        button.disabled = true;
        try {
            const payload = await api.post('api-tokens', body);
            const token = payload.data?.token || '';
            form.reset();
            document.querySelector('[data-token-created]').innerHTML = `<div class="token-created" role="status"><strong>Copia el token ahora: no se volverá a mostrar.</strong><div class="token-value"><input type="text" readonly value="${escapeHTML(token)}" aria-label="Token nuevo" spellcheck="false"><button class="button button-small" type="button" data-copy-value="${escapeHTML(token)}">${icon('copy')}Copiar</button></div><p>Ejemplos de uso:</p><pre class="snippet-code is-full"><code>${escapeHTML(tokenUsageExample(token))}</code></pre></div>`;
            document.querySelector('.token-value input')?.select();
            await loadApiTokens();
        } catch (error) { toast('No pudimos crear el token', error.message, 'error'); }
        finally { button.disabled = false; }
    }
    async function revokeApiToken(id, name) {
        if (!await confirmAction(`¿Revocar «${name}»?`, 'Los scripts que lo usen dejarán de funcionar al momento. No se puede deshacer.', 'Sí, revocar')) return;
        try { await api.delete(`api-tokens/${Number(id)}`); toast('Token revocado', name); await loadApiTokens(); }
        catch (error) { toast('No pudimos revocarlo', error.message, 'error'); }
    }

    function countLabel(count, one, many) { const n = Number(count) || 0; return `${n} ${n === 1 ? one : many}`; }
    const FEMININE_ENTITIES = new Set(['idea','task','devlog','lead','release','weekly_review','tag']);
    function newLabel(entity) { return `${FEMININE_ENTITIES.has(entity) ? 'Nueva' : 'Nuevo'} ${ENTITY_NAMES[entity]}`; }

    function pageHeading(eyebrow, title, copy, entity, secondary = '') {
        return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">${escapeHTML(eyebrow)}</span><h1>${title}</h1><p>${escapeHTML(copy)}</p></div><div class="heading-actions">${secondary}<button class="button button-primary" type="button" data-create="${entity}">${icon('plus')}${newLabel(entity)}</button></div></header>`;
    }

    function statusBadge(status) { return `<span class="status-badge status-${escapeHTML(status)}">${escapeHTML(STATUS[status] || status || 'Sin estado')}</span>`; }

    function projectType(project = {}) {
        if (project.project_type === 'personal' || project.project_type === 'commercial') return project.project_type;
        return project.client_id || project.client_name || project.due_date ? 'commercial' : 'personal';
    }

    function isProjectPinned(project = {}) {
        return project.pinned === true || project.pinned === 1 || project.pinned === '1';
    }

    function sortProjects(items = []) {
        return [...items].sort((a, b) => {
            const pinned = Number(isProjectPinned(b)) - Number(isProjectPinned(a));
            if (pinned) return pinned;
            const recent = String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
            return recent || String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' });
        });
    }

    function projectPinButton(project, compact = false) {
        const pinned = isProjectPinned(project);
        return `<button class="project-pin-button${pinned ? ' is-pinned' : ''}${compact ? ' is-compact' : ''}" type="button" data-project-pin="${Number(project.id)}" aria-pressed="${String(pinned)}" aria-label="${pinned ? 'Desfijar' : 'Fijar'} ${escapeHTML(project.name)}" title="${pinned ? 'Desfijar proyecto' : 'Fijar proyecto'}">${icon('pin')}</button>`;
    }

    function projectTypeBadge(project, compact = false) {
        const type = projectType(project);
        const label = type === 'commercial' ? 'Comercial' : 'Personal';
        return `<span class="project-type-badge is-${type}${compact ? ' is-compact' : ''}">${escapeHTML(label)}</span>`;
    }

    function dueMarkup(date) {
        if (!date) return '<span class="due-label">Sin fecha</span>';
        const diff = daysUntil(date);
        const cls = diff < 0 ? ' is-late' : diff === 0 ? ' is-today' : '';
        return `<span class="due-label${cls}">${escapeHTML(dateDistance(date))}</span>`;
    }

    function taskRow(task, compact = false) {
        const done = task.status === 'done';
        return `<article class="task-row${done ? ' is-done' : ''}" data-id="${Number(task.id)}" data-record-preview="task">
            <button class="task-check${done ? ' is-done' : ''}" type="button" data-task-toggle="${Number(task.id)}" aria-label="${done ? 'Reabrir' : 'Completar'} ${escapeHTML(task.title)}">${done ? icon('check') : ''}</button>
            <div><h3><button class="task-title-button" type="button" data-record-preview="task" data-id="${Number(task.id)}">${escapeHTML(task.title || 'Tarea sin título')}</button></h3>${compact ? `<p>${escapeHTML(task.project_name || 'Tarea independiente')}</p>` : `<div class="task-meta"><span>${escapeHTML(task.project_name || 'Sin proyecto')}</span><span>${escapeHTML(PRIORITY[task.priority] || 'Media')}</span>${taskExtrasMarkup(task) ? `<span class="task-meta-chips">${taskExtrasMarkup(task)}</span>` : ''}</div>`}</div>
            <div class="task-row-end">${!done ? `<button class="icon-button task-timer-button" type="button" data-task-timer="${Number(task.id)}" aria-label="Empezar temporizador para ${escapeHTML(task.title || 'la tarea')}" title="Empezar temporizador">${icon('clock')}</button>` : ''}${dueMarkup(task.due_date)}</div>
        </article>`;
    }

    async function renderDashboard(force = false) {
        const request = ++state.requestId;
        renderLoading();
        try {
            let data = state.dashboard;
            if (force || !data || Date.now() - state.dashboardAt > CACHE_TTL) {
                const payload = await api.get('dashboard');
                data = payload.data || {};
                state.dashboard = data;
                state.dashboardAt = Date.now();
            }
            if (request !== state.requestId || state.route !== 'dashboard') return;
            const stats = data.stats || {};
            const projects = Array.isArray(data.projects) ? data.projects : [];
            const tasks = Array.isArray(data.upcoming_tasks) ? data.upcoming_tasks : [];
            const ideas = Array.isArray(data.recent_ideas) ? data.recent_ideas : [];
            const followUps = Array.isArray(data.follow_ups) ? data.follow_ups : [];
            const [reminders, timeEntries, budgets, resources, weeklyReviews, profitability] = await Promise.all([
                loadReminderCenter(force).catch(() => []),
                getCollection('time_entries', force).catch(() => []),
                getCollection('budgets', force).catch(() => []),
                getCollection('resources', force).catch(() => []),
                getCollection('weekly_reviews', force).catch(() => []),
                api.get('profitability').then(payload => payload.data || []).catch(() => []),
            ]);
            if (request !== state.requestId || state.route !== 'dashboard') return;
            const orderedProjects = sortProjects(projects);
            const focus = orderedProjects.find(project => project.status === 'active') || orderedProjects[0];
            const date = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone:state.settings?.timezone||undefined }).format(new Date());
            const widgetOrder = sanitizeWidgetOrder(state.settings?.dashboard_widgets);
            const upcomingReminders = reminders.filter(item => item.status === 'pending').sort((a,b) => String(a.due_at).localeCompare(String(b.due_at))).slice(0, 5);
            const week = weekBounds(new Date());
            const openTasks = Number(stats.pending_tasks ?? 0);
            const todaySummary = `${openTasks === 1 ? '1 tarea abierta' : `${openTasks} tareas abiertas`} y ${upcomingReminders.length === 1 ? '1 recordatorio próximo' : `${upcomingReminders.length} recordatorios próximos`}${stats.overdue_tasks ? `; ${stats.overdue_tasks} ${Number(stats.overdue_tasks) === 1 ? 'necesita' : 'necesitan'} atención.` : '.'}`;
            const weekMinutes = timeEntries.filter(item => item.work_date >= week.start && item.work_date <= week.end).reduce((sum,item) => sum + elapsedMinutes(item), 0);
            const widgets = {
                overview: `<div class="metric-grid dashboard-widget is-wide" data-dashboard-widget="overview">
                    ${metricCard('Proyectos activos', stats.active_projects ?? 0, `${stats.project_progress ?? 0}% de avance promedio`, 'folder')}
                    ${metricCard('Tareas abiertas', stats.pending_tasks ?? 0, stats.overdue_tasks ? `${stats.overdue_tasks} necesitan atención` : 'Todo dentro de fecha', 'check')}
                    ${metricCard('Ideas guardadas', stats.ideas ?? 0, 'Tu semillero personal', 'bulb')}
                    ${metricCard('Relaciones activas', (stats.active_clients ?? 0) + (stats.open_leads ?? 0), `${stats.open_leads ?? 0} oportunidades abiertas`, 'users')}
                </div>`,
                projects: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Proyectos en foco</h2><p>Fijados, activos y recientes</p></div><button class="text-button" type="button" data-nav-button="projects">Ver todos${icon('chevron')}</button></div>${focus ? focusProject(focus) : '<div class="inline-empty">Todavía no hay un proyecto activo.</div>'}<div class="project-rows widget-project-rows">${orderedProjects.filter(item => !focus || Number(item.id) !== Number(focus.id)).slice(0, 3).map(projectRow).join('')}</div></section>`,
                tasks: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Próximas tareas</h2><p>Pequeños pasos que mueven todo</p></div><button class="text-button" type="button" data-create="task" aria-label="Nueva tarea">${icon('plus')}</button></div><div class="task-list">${tasks.length ? tasks.slice(0, 5).map(task => taskRow(task, true)).join('') : '<div class="inline-empty">Tu lista está despejada.</div>'}</div></section>`,
                reminders: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Recordatorios próximos</h2><p>Lo que no conviene dejar pasar</p></div><button class="text-button" type="button" data-nav-button="reminders">Ver centro${icon('chevron')}</button></div><div class="compact-reminders">${upcomingReminders.length ? upcomingReminders.map(reminderCompact).join('') : '<div class="inline-empty">No hay alertas pendientes.</div>'}</div></section>`,
                time_tracking: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Tiempo de esta semana</h2><p>${escapeHTML(shortRange(week.start, week.end))}</p></div><button class="text-button" type="button" data-nav-button="time">Abrir control${icon('chevron')}</button></div><div class="widget-time-value">${escapeHTML(minutesLabel(weekMinutes))}</div><p class="muted-copy">${countLabel(timeEntries.filter(item => item.work_date >= week.start && item.work_date <= week.end).length,'registro','registros')} de trabajo.</p></section>`,
                profitability: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Rentabilidad</h2><p>Ingresos menos costos registrados</p></div><button class="text-button" type="button" data-nav-button="profitability">Ver detalle${icon('chevron')}</button></div>${profitabilityWidget(profitability)}</section>`,
                calendar: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Agenda próxima</h2><p>Fechas que se acercan</p></div><button class="text-button" type="button" data-nav-button="calendar">Abrir calendario${icon('chevron')}</button></div><div class="compact-reminders">${upcomingReminders.length ? upcomingReminders.slice(0,4).map(reminderCompact).join('') : '<div class="inline-empty">La agenda está despejada.</div>'}</div></section>`,
                weekly_review: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Revisión semanal</h2><p>Aprender del ritmo de trabajo</p></div><button class="text-button" type="button" data-nav-button="weekly">Revisar semana${icon('chevron')}</button></div>${weeklyReviews.length ? `<strong class="review-widget-score">${clamp(weeklyReviews[0].rating,1,5)}/5</strong><p class="muted-copy">${escapeHTML(weeklyReviews[0].wins || 'Revisión guardada sin logros destacados.')}</p>` : '<div class="inline-empty">Todavía no has cerrado esta semana.</div>'}</section>`,
                budgets: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Presupuestos y cobros</h2><p>Saldos separados por moneda</p></div><button class="text-button" type="button" data-nav-button="budgets">Abrir finanzas${icon('chevron')}</button></div><div class="finance-values widget-finance">${groupedMoney(budgets, 'balance')}</div></section>`,
                resources: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Infraestructura</h2><p>Recursos que necesitan atención</p></div><button class="text-button" type="button" data-nav-button="resources">Ver inventario${icon('chevron')}</button></div><div class="widget-time-value">${resources.filter(item => item.status === 'attention' || (daysUntil(item.renewal_date) !== null && daysUntil(item.renewal_date) <= 30)).length}</div><p class="muted-copy">alertas entre estado y renovaciones próximas.</p></section>`,
            };

            dom.view.innerHTML = `
                <header class="page-heading">
                    <div class="page-heading-copy"><span class="eyebrow">Tu estudio de hoy</span><h1>${escapeHTML(date.charAt(0).toUpperCase() + date.slice(1))}</h1><p>${escapeHTML(todaySummary)}</p></div>
                </header>
                ${state.demoMode ? `<div class="demo-banner"><span>Estás explorando datos de muestra</span><small>Todo lo que cambies se guarda solo durante esta sesión.</small></div>` : ''}
                <div class="dashboard-widget-grid">${widgetOrder.map(key => widgets[key] || '').join('')}</div>`;
            layoutDashboard();
            const sameRoute = state.lastPaintedRoute === 'dashboard';
            state.lastPaintedRoute = 'dashboard';
            if (sameRoute && !state.quietRender) { state.quietRender = true; finishRender(); state.quietRender = false; }
            else finishRender();
        } catch (error) { if (request === state.requestId) renderError(error); }
    }

    function metricCard(label, value, caption, iconName) {
        return `<article class="metric-card"><div class="metric-top"><span>${escapeHTML(label)}</span><span class="metric-icon">${icon(iconName)}</span></div><div class="metric-value">${escapeHTML(value)}</div><div class="metric-caption">${escapeHTML(caption)}</div></article>`;
    }
    function sanitizeWidgetOrder(value) {
        const source = Array.isArray(value) ? value : asArray(value);
        const unique = [...new Set(source.filter(key => Object.hasOwn(WIDGETS, key)))];
        return unique.length ? unique : [...DEFAULT_WIDGETS];
    }
    function weekBounds(value = new Date()) {
        const civil=zonedCivil(value)||todayISO(); const [year,month,day]=civil.split('-').map(Number);
        const date = new Date(year,month-1,day,12);
        const sundayStart = state.settings?.week_start === 'sunday';
        const offset = sundayStart ? date.getDay() : (date.getDay() + 6) % 7;
        const start = new Date(date); start.setDate(start.getDate() - offset);
        const end = new Date(start); end.setDate(end.getDate() + 6);
        return { start: dateISO(start), end: dateISO(end) };
    }
    function reminderCompact(item) {
        const priority = item.priority || 'medium';
        const action = item.derived || item.source_type ? `data-source-open="${escapeHTML(item.source_type)}" data-id="${Number(item.source_id)}"` : `data-record-preview="reminder" data-id="${Number(item.id)}"`;
        return `<button class="compact-reminder" type="button" ${action}><i class="priority-dot priority-${escapeHTML(priority)}"></i><span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.project_name || 'Recordatorio personal')}</small></span><time datetime="${escapeHTML(item.due_at || '')}">${escapeHTML(dateDistance(item.due_at))}</time></button>`;
    }
    function focusProject(project) {
        const color = safeColor(project.color);
        const tags = asArray(project.tech_stack);
        return `<article class="focus-project" style="--coral:${color}"><div><div class="focus-kickers"><span class="focus-kicker">${escapeHTML(STATUS[project.status] || 'Proyecto')}</span>${projectTypeBadge(project, true)}${isProjectPinned(project) ? '<span class="focus-pinned">Fijado</span>' : ''}</div><h3>${escapeHTML(project.name)}</h3><p>${escapeHTML(markdownPlain(project.description) || 'Sin descripción todavía.')}</p><div class="focus-tags">${tags.slice(0, 4).map(tag => `<span>${escapeHTML(tag)}</span>`).join('')}</div><button class="text-button focus-action" type="button" data-project-preview="${Number(project.id)}">Abrir proyecto${icon('chevron')}</button></div><div class="progress-ring" style="--progress:${clamp(project.progress, 0, 100)}"><span>${clamp(project.progress, 0, 100)}%</span></div></article>`;
    }
    function projectRow(project) {
        const color = safeColor(project.color);
        const typeLabel = projectType(project) === 'commercial' ? 'Comercial' : 'Personal';
        return `<article class="project-row" role="button" tabindex="0" aria-label="Abrir proyecto ${escapeHTML(typeLabel.toLowerCase())}: ${escapeHTML(project.name)}" data-project-preview="${Number(project.id)}"><span class="project-color" style="--project-color:${color}"></span><div><h3>${isProjectPinned(project) ? '<span class="row-pin" aria-label="Fijado">◆</span>' : ''}${escapeHTML(project.name)}</h3><p>${escapeHTML(STATUS[project.status] || '')}<span class="project-type-inline"> · ${escapeHTML(typeLabel)}</span></p></div><div class="mini-progress" style="--project-color:${color}"><span style="--progress:${clamp(project.progress, 0, 100)}%"></span></div><span class="row-percent">${clamp(project.progress, 0, 100)}%</span></article>`;
    }
    function ideaPreview(idea) { return `<article class="idea-preview"><small>${escapeHTML(idea.category || STATUS[idea.status] || 'Idea')}</small><h3>${escapeHTML(idea.title)}</h3><p>${escapeHTML(markdownPlain(idea.description) || 'Una idea esperando más contexto.')}</p></article>`; }
    function followCard(lead, index) { const colors = ['var(--blue-wash)', 'var(--sage-wash)', 'var(--purple-wash)']; return `<article class="follow-card" role="button" tabindex="0" aria-label="Abrir oportunidad de ${escapeHTML(lead.name)}" data-record-preview="lead" data-id="${Number(lead.id)}"><span class="contact-initial" style="--avatar-color:${colors[index % colors.length]}">${initials(lead.name)}</span><div><strong>${escapeHTML(lead.name)}</strong><small>${escapeHTML(lead.company || 'Contacto independiente')}</small></div><span class="follow-date">${escapeHTML(dateDistance(lead.next_follow_up))}</span></article>`; }

    function finishRender() {
        dom.view.setAttribute('aria-busy', 'false');
        if (state.quietRender) { dom.view.classList.remove('is-entering'); return; }
        clearTimeout(dom.view._animationTimer);
        dom.view.classList.remove('is-entering');
        // Reinicia la transición sin dejar un fill-mode activo en capturas,
        // navegadores lentos o pestañas que se duermen a mitad de la animación.
        void dom.view.offsetWidth;
        dom.view.classList.add('is-entering');
        const cleanup = () => {
            dom.view.classList.remove('is-entering');
            dom.view.removeEventListener('animationend', cleanup);
            clearTimeout(dom.view._animationTimer);
        };
        dom.view.addEventListener('animationend', cleanup, { once: true });
        dom.view._animationTimer = setTimeout(cleanup, 460);
    }

    // Tras guardar algo se repinta «en silencio»: sin esqueleto de carga, sin animación de entrada,
    // sin volver arriba y devolviendo el foco al mismo control. Así no parece que la app se recargue.
    async function refreshView() {
        const scrollY = window.scrollY;
        const active = document.activeElement;
        const focusKey = active && dom.view.contains(active)
            ? ['data-task-toggle', 'data-task-timer', 'data-task-status-select', 'data-kanban-status-select', 'data-reminder-status', 'data-edit', 'data-record-preview']
                .map(name => active.hasAttribute(name) ? `[${name}="${CSS.escape(active.getAttribute(name))}"]${active.dataset.id ? `[data-id="${CSS.escape(active.dataset.id)}"]` : ''}` : '').find(Boolean)
            : '';
        state.quietRender = true;
        try { await navigate(state.route, { force: true, quiet: true }); }
        finally { state.quietRender = false; }
        window.scrollTo({ top: scrollY, behavior: 'instant' });
        if (focusKey) dom.view.querySelector(focusKey)?.focus({ preventScroll: true });
    }

    async function navigate(route, { force = false, quiet = false } = {}) {
        const clean = ROUTES.includes(route) ? route : 'dashboard';
        state.route = clean;
        if (location.hash !== `#${clean}`) history.replaceState(null, '', `#${clean}`);
        document.querySelectorAll('[data-nav]').forEach(link => {
            const active = link.dataset.nav === clean;
            link.classList.toggle('is-active', active);
            if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        });
        // Las secciones que no están en el rail se marcan en «Más».
        document.querySelector('.rail-more')?.classList.toggle('is-active', !document.querySelector(`.rail-nav [data-nav="${clean}"]`));
        dom.routeAnnouncer.textContent = `Página ${ROUTE_NAMES[clean]}`;
        document.title = `${ROUTE_NAMES[clean]} — CodePanel`;
        closeSidebar();
        if (!quiet) window.scrollTo({ top: 0, behavior: 'smooth' });
        const rendered = clean === 'dashboard' ? renderDashboard(force) : renderCollectionPage(clean, force);
        Promise.resolve(rendered).finally(() => { refreshTimerPill(); });
        return rendered;
    }

    async function boot() {
        bindGlobalEvents();
        restoreTheme();
        try {
            const session = (await api.get('auth/me')).data || {};
            state.user = session.user || null;
            state.csrf = session.csrf_token || '';
            state.demoMode = Boolean(session.demo_mode);
            state.features = session.features || {};
            applyFeatureVisibility();
            applyRegistrationAvailability(session.registration_enabled !== false);
            applyDatabaseAvailability(session.database_available !== false);
            if (!session.authenticated || !state.user) {
                showAuth();
                return;
            }
            updateProfile();
            dom.shell.inert = false;
            dom.authOverlay.hidden = true;
            await getSettings().catch(() => { state.settings = {}; });
            state.calendarDay=todayISO(); const calendarNow=parseDate(state.calendarDay); state.calendarMonth=new Date(calendarNow.getFullYear(),calendarNow.getMonth(),1);
            navigate(location.hash.slice(1) || 'dashboard');
        } catch (error) {
            renderError(error);
            toast('No se pudo iniciar CodePanel', error.message, 'error');
        }
    }

    document.addEventListener('DOMContentLoaded', boot);

    // Las vistas de colección, formularios y eventos se definen debajo para
    // mantener este archivo único y fácil de alojar sin un proceso de build.

    async function renderCollectionPage(route, force = false) {
        const request = ++state.requestId;
        renderLoading();
        try {
            let data;
            if (route === 'budgets') {
                [data] = await Promise.all([getCollection('budgets', force), getCollection('payments', force)]);
            } else if (route === 'reminders') {
                data = await loadReminderCenter(force);
            } else if (route === 'calendar') {
                const first = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth(), 1, 12);
                const offset = state.settings?.week_start === 'sunday' ? first.getDay() : (first.getDay()+6)%7;
                const gridStart = new Date(first); gridStart.setDate(gridStart.getDate()-offset);
                const gridEnd = new Date(gridStart); gridEnd.setDate(gridEnd.getDate()+41);
                const from = dateISO(gridStart); const to = dateISO(gridEnd);
                data = (await api.get(`calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).data || [];
            } else if (route === 'profitability') {
                data = (await api.get('profitability')).data || [];
            } else if (route === 'settings' || route === 'dashboard-settings') {
                data = await getSettings(force);
            } else if (route === 'weekly') {
                const bounds = weekBounds(new Date());
                const reviews = await getCollection('weekly_reviews', force);
                let summary = null;
                try {
                    const payload = await api.get(`weekly_summary?week_start=${encodeURIComponent(bounds.start)}`);
                    if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) summary = payload.data;
                } catch { /* fallback compatible con instalaciones anteriores */ }
                if (summary) data = { reviews, summary };
                else {
                    const [tasks,timeEntries,payments,devlogs,releases,budgets] = await Promise.all([
                        getCollection('tasks', force), getCollection('time_entries', force), getCollection('payments', force),
                        getCollection('devlogs', force), getCollection('releases', force), getCollection('budgets', force),
                    ]);
                    data = { reviews, tasks, timeEntries, payments, devlogs, releases, budgets };
                }
            } else if (route === 'files') {
                const [attachments] = await Promise.all([
                    getCollection('attachments', force), ...['projects','tasks','clients','leads','ideas','devlogs','budgets','payments','releases','resources','reminders','time_entries','weekly_reviews'].map(entity=>getCollection(entity,force)),
                ]);
                data = attachments;
            } else {
                const collection = { time: 'time_entries' }[route] || route;
                data = await getCollection(collection, force);
            }
            if (request !== state.requestId || state.route !== route) return;
            paintCollection(route, data);
        } catch (error) { if (request === state.requestId) renderError(error); }
    }

    async function loadReminderCenter(force = false) {
        const cached = state.cache.get('attention');
        if (!force && cached && Date.now() - cached.at < CACHE_TTL) return cached.data;
        try {
            const payload = await api.get('attention');
            const attention = Array.isArray(payload.data) ? payload.data : [];
            state.cache.set('attention', { data: attention, at: Date.now() });
            updateNavigationCounts();
            return attention;
        } catch {
            // Compatibilidad con instalaciones que todavía no migraron el
            // agregado: se reconstruye desde colecciones, sujetas a su límite.
        }
        const [manual, tasks, leads, budgets, releases, resources] = await Promise.all([
            getCollection('reminders', force), getCollection('tasks', force), getCollection('leads', force),
            getCollection('budgets', force), getCollection('releases', force), getCollection('resources', force),
        ]);
        const derived = [];
        const add = (sourceType, item, date, title, detail, priority = 'medium') => {
            if (!date) return;
            derived.push({
                id: `derived-${sourceType}-${item.id}`, source_type: sourceType, source_id: Number(item.id),
                title, notes: detail, due_at: date, status: 'pending', priority, derived: true,
                project_id: item.project_id || null, project_name: item.project_name || null,
            });
        };
        tasks.filter(item => item.status !== 'done').forEach(item => add('task', item, item.due_date, item.title, item.project_name || 'Tarea', item.priority));
        leads.filter(item => !['won','lost'].includes(item.status)).forEach(item => add('lead', item, item.next_follow_up, `Seguimiento: ${item.name}`, item.company || 'Oportunidad', 'medium'));
        budgets.filter(item => !['rejected','expired'].includes(item.status)).forEach(item => add('budget', item, item.valid_until, `Vence: ${item.title}`, item.client_name || 'Presupuesto', 'high'));
        releases.filter(item => !['published','rolled_back'].includes(item.status)).forEach(item => add('release', item, item.release_date, item.title, item.project_name || 'Entrega', 'high'));
        resources.filter(item => item.status !== 'inactive').forEach(item => add('resource', item, item.renewal_date || (item.status==='attention'?todayISO():null), item.renewal_date?`Renovar: ${item.name}`:`Revisar: ${item.name}`, item.provider || 'Recurso', item.status === 'attention' ? 'high' : 'medium'));
        const rawDays = state.settings?.reminder_days;
        const configuredDays = Array.isArray(rawDays) ? rawDays.map(Number).filter(Number.isFinite) : rawDays === undefined || rawDays === null ? [14] : [Number(rawDays)].filter(Number.isFinite);
        // [] es una preferencia válida: muestra sólo hoy y vencidos.
        const maxDays = Math.max(0, ...configuredDays);
        const visibleDerived = derived.filter(item => { const days = daysUntil(item.due_at); return days !== null && days <= maxDays; });
        const seen = new Set();
        const attention = [...manual, ...visibleDerived].filter(item => {
            const key = item.source_type ? `${item.source_type}:${item.source_id || item.id}` : `manual:${item.id}`;
            if (seen.has(key)) return false; seen.add(key); return true;
        }).sort((a,b) => String(a.due_at || '').localeCompare(String(b.due_at || '')));
        state.cache.set('attention', { data: attention, at: Date.now() });
        updateNavigationCounts();
        return attention;
    }

    function paintCollection(route, data) {
        const painters = {
            projects: renderProjects, ideas: renderIdeas, tasks: renderTasks, devlogs: renderDevlogs,
            clients: renderClients, leads: renderLeads, budgets: renderBudgets, releases: renderReleases, resources: renderResources,
            reminders: renderReminders, time: renderTime, profitability: renderProfitability, calendar: renderCalendar,
            weekly: renderWeeklyReviews, files: renderFiles, tags: renderTags, settings: renderSettings, 'dashboard-settings': renderDashboardSettings, snippets: renderSnippets,
        };
        state.pageData[route] = data;
        const sameRoute = state.lastPaintedRoute === route;
        state.lastPaintedRoute = route;
        dom.view.innerHTML = painters[route](data);
        // Solo se anima al entrar en una sección; filtrar, ordenar o guardar dentro de ella no.
        if (sameRoute && !state.quietRender) { state.quietRender = true; finishRender(); state.quietRender = false; }
        else finishRender();
        if (route === 'time') startTimerTicker(); else stopTimerTicker();
        if (route === 'settings') loadApiTokens();
    }

    function filtered(items, route) {
        const filters = state.filters[route] || {};
        const query = String(filters.search || '').trim().toLocaleLowerCase('es');
        return items.filter(item => {
            if (filters.status && filters.status !== 'all') {
                if (route === 'ideas' && filters.status === 'archived') {
                    if (!item.archived) return false;
                } else if (route === 'time') {
                    const running = Boolean(item.is_running) || (item.started_at && !item.ended_at);
                    if (filters.status === 'running' && !running) return false;
                    if (filters.status === 'billable' && !Number(item.billable)) return false;
                    if (filters.status === 'non_billable' && Number(item.billable)) return false;
                } else if (route === 'devlogs' ? item.entry_type !== filters.status : item.status !== filters.status) return false;
            }
            if (!query) return true;
            const haystack = route === 'projects' ? [item.name, item.description, item.client_name, ...asArray(item.tech_stack), ...asArray(item.tags)]
                : route === 'ideas' ? [item.title, item.description, item.category, ...asArray(item.tags)]
                : route === 'tasks' ? [item.title, item.description, item.project_name, item.assignee, ...asArray(item.tags)]
                : route === 'devlogs' ? [item.title, item.content, item.project_name, DEVLOG_TYPES[item.entry_type], ...asArray(item.tags)]
                : route === 'budgets' ? [item.title, item.client_name, item.project_name, item.notes, item.currency, ...asArray(item.tags)]
                : route === 'releases' ? [item.title, item.version, item.project_name, item.notes, ENVIRONMENTS[item.environment], ...asArray(item.tags)]
                : route === 'resources' ? [item.name, item.provider, item.project_name, item.notes, RESOURCE_TYPES[item.resource_type], ENVIRONMENTS[item.environment], ...asArray(item.tags)]
                : route === 'reminders' ? [item.title, item.notes, item.project_name, ...asArray(item.tags)]
                : route === 'time' ? [item.description, item.project_name, item.task_title, ...asArray(item.tags)]
                : route === 'weekly' ? [item.wins, item.blockers, item.next_focus, ...asArray(item.tags)]
                : route === 'files' ? [item.original_name, item.entity_type, item.entity_name, item.project_name, item.mime_type]
                : route === 'snippets' ? [item.title, item.content, item.language, item.project_name, ...asArray(item.tags)]
                : route === 'tags' ? [item.name, item.usage_count]
                : [item.name, item.company, item.email, item.source, item.notes, ...asArray(item.tags)];
            return haystack.some(value => String(value || '').toLocaleLowerCase('es').includes(query));
        });
    }

    function collectionToolbar(route, total, statuses = [], viewToggle = false) {
        const filters = state.filters[route];
        const statusOptions = statuses.map(([value, label]) => `<option value="${value}"${filters.status === value ? ' selected' : ''}>${escapeHTML(label)}</option>`).join('');
        return `<div class="toolbar">
            <label class="filter-search">${icon('search')}<span class="sr-only">Buscar</span><input type="search" value="${escapeHTML(filters.search || '')}" placeholder="Buscar…" data-filter-search="${route}" autocomplete="off"></label>
            ${statuses.length ? `<label class="select-wrap"><span class="sr-only">Filtrar por ${route === 'devlogs' ? 'tipo' : 'estado'}</span><select data-filter-status="${route}"><option value="all">${route === 'devlogs' ? 'Todos los tipos' : 'Todos los estados'}</option>${statusOptions}</select></label>` : ''}
            <span class="result-count">${total} ${total === 1 ? 'resultado' : 'resultados'}</span><span class="toolbar-spacer"></span>
            ${viewToggle && route === 'tasks' ? `<div class="segmented" aria-label="Vista"><button class="${filters.view !== 'board' ? 'is-active' : ''}" type="button" data-task-view="list" aria-label="Vista de lista" aria-pressed="${filters.view !== 'board'}">${icon('list')}</button><button class="${filters.view === 'board' ? 'is-active' : ''}" type="button" data-task-view="board" aria-label="Vista de tablero" aria-pressed="${filters.view === 'board'}">${icon('columns')}</button></div>` : viewToggle ? `<div class="segmented" aria-label="Vista"><button class="${filters.view === 'grid' ? 'is-active' : ''}" type="button" data-project-view="grid" aria-label="Vista de tarjetas">${icon('grid')}</button><button class="${filters.view === 'board' ? 'is-active' : ''}" type="button" data-project-view="board" aria-label="Vista por etapas">${icon('columns')}</button></div>` : ''}
        </div>`;
    }

    function projectFiltersToolbar(items, total) {
        const filters = state.filters.projects;
        const technologies = [...new Set(items.flatMap(project => asArray(project.tech_stack)).map(value => String(value).trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
        const select = (key, label, options) => `<label class="select-wrap"><span class="sr-only">${escapeHTML(label)}</span><select data-project-filter="${key}" aria-label="${escapeHTML(label)}"><option value="all">${escapeHTML(label)}</option>${optionList(options, filters[key])}</select></label>`;
        const hasFilters = filters.search || ['status','type','priority','tech','pinned'].some(key => filters[key] !== 'all');
        return `<div class="toolbar project-toolbar">
            <label class="filter-search project-search">${icon('search')}<span class="sr-only">Buscar proyectos</span><input type="search" value="${escapeHTML(filters.search || '')}" placeholder="Nombre, cliente, tecnología o etiqueta…" data-filter-search="projects" autocomplete="off"></label>
            <div class="project-filter-group" aria-label="Filtros de proyectos">
                ${select('status','Todos los estados',[['planned','Por empezar'],['active','En marcha'],['on_hold','En pausa'],['completed','Terminados'],['archived','Archivados']])}
                ${select('type','Todos los tipos',[['personal','Personales'],['commercial','Comerciales']])}
                ${select('priority','Todas las prioridades',[['urgent','Urgente'],['high','Alta'],['medium','Media'],['low','Baja']])}
                ${select('tech','Toda tecnología',technologies.map(tech => [tech,tech]))}
                ${select('pinned','Todos los proyectos',[['pinned','Solo fijados'],['unpinned','Sin fijar']])}
            </div>
            <span class="result-count" aria-live="polite">${total} ${total === 1 ? 'resultado' : 'resultados'}</span>
            ${hasFilters ? '<button class="text-button filter-reset" type="button" data-clear-filters="projects">Limpiar</button>' : ''}
            <span class="toolbar-spacer"></span>
            <div class="segmented" aria-label="Vista"><button class="${filters.view === 'grid' ? 'is-active' : ''}" type="button" data-project-view="grid" aria-label="Vista de tarjetas">${icon('grid')}</button><button class="${filters.view === 'board' ? 'is-active' : ''}" type="button" data-project-view="board" aria-label="Vista Kanban">${icon('columns')}</button></div>
        </div>`;
    }

    function filteredProjects(items) {
        const filters = state.filters.projects;
        return sortProjects(filtered(items, 'projects').filter(project => {
            if (filters.type !== 'all' && projectType(project) !== filters.type) return false;
            if (filters.priority !== 'all' && project.priority !== filters.priority) return false;
            if (filters.pinned === 'pinned' && !isProjectPinned(project)) return false;
            if (filters.pinned === 'unpinned' && isProjectPinned(project)) return false;
            if (filters.tech !== 'all' && !asArray(project.tech_stack).some(tech => String(tech).toLocaleLowerCase('es') === String(filters.tech).toLocaleLowerCase('es'))) return false;
            return true;
        }));
    }

    function renderProjects(items) {
        const visible = filteredProjects(items);
        const filters = state.filters.projects;
        const active = items.filter(item => item.status === 'active').length;
        const content = !visible.length
            ? (items.length ? noFilterResults('projects') : emptyState('project', 'Tu primer proyecto empieza aquí', 'Guarda el contexto, las fechas y el progreso sin perderte en hojas de cálculo.'))
            : filters.view === 'board' ? projectBoard(visible) : `<div class="project-grid">${visible.map(projectCard).join('')}</div>`;
        return `${pageHeading('Tu cartera', 'Proyectos con <em>rumbo</em>.', `${active} en marcha de ${items.length} proyectos. Una mirada clara para decidir qué sigue.`, 'project')}
            ${projectFiltersToolbar(items, visible.length)}${content}`;
    }

    function projectCard(project) {
        const color = safeColor(project.color);
        const tags = asArray(project.tech_stack);
        const isCommercial = projectType(project) === 'commercial';
        const due = project.due_date ? dateDistance(project.due_date) : 'Sin fecha límite';
        const footerMeta = isCommercial
            ? `<span>${icon('calendar')}${escapeHTML(due)}</span><span>${escapeHTML(project.client_name || 'Sin cliente')}</span>`
            : `<span class="personal-project-note">${icon('user')}Proyecto propio</span><span>${escapeHTML(PRIORITY[project.priority] || 'Prioridad media')}</span>`;
        return `<article class="project-card${isProjectPinned(project) ? ' is-pinned' : ''}" style="--project-color:${color}" data-record="project" data-id="${Number(project.id)}" data-project-preview="${Number(project.id)}">
            <div class="card-topline"><div class="card-badges">${statusBadge(project.status)}${projectTypeBadge(project)}</div><div class="project-card-actions">${projectPinButton(project)}<button class="icon-button card-menu-button" type="button" data-card-menu aria-label="Opciones de ${escapeHTML(project.name)}">${icon('more')}</button></div></div>
            <div class="card-actions-menu" hidden><button type="button" data-edit="project" data-id="${Number(project.id)}">Editar</button><button type="button" data-duplicate="project" data-id="${Number(project.id)}">Duplicar</button><button class="danger" type="button" data-delete="project" data-id="${Number(project.id)}">Eliminar</button></div>
            <button class="card-content-button" type="button" data-project-preview="${Number(project.id)}" aria-label="Abrir vista de ${escapeHTML(project.name)}"><h2>${escapeHTML(project.name)}</h2><p class="description">${escapeHTML(markdownPlain(project.description) || 'Este proyecto todavía no tiene una descripción.')}</p></button>
            <div class="tech-list">${tags.length ? tags.slice(0, 4).map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join('') : '<span class="tag">Sin stack definido</span>'}</div>
            <footer class="project-card-footer"><div class="progress-copy"><span>Progreso</span><strong>${clamp(project.progress,0,100)}%</strong></div><div class="progress-bar"><span style="--progress:${clamp(project.progress,0,100)}%"></span></div><div class="card-bottom">${footerMeta}</div></footer>
        </article>`;
    }

    function projectBoard(items) {
        const columns = [
            ['planned', 'Por empezar', 'var(--purple)'], ['active', 'En marcha', 'var(--blue)'],
            ['on_hold', 'En pausa', 'var(--yellow)'], ['completed', 'Terminados', 'var(--sage)'],
            ['archived', 'Archivados', 'var(--muted)'],
        ];
        return `<div class="kanban-help" role="note"><span>${icon('drag')}</span><p><strong>Mueve el trabajo a medida que avanza.</strong> Arrastra una tarjeta entre columnas o usa su selector de estado con teclado y en pantallas táctiles.</p></div><div class="kanban-board">${columns.map(([status,label,color]) => {
            const projects = sortProjects(items.filter(item => item.status === status));
            return `<section class="kanban-column" data-kanban-status="${status}" style="--column-color:${color}" aria-label="${label}"><header class="kanban-header"><strong><i class="kanban-dot"></i>${label}</strong><span data-kanban-count>${projects.length}</span></header><div class="kanban-items" data-kanban-items>${projects.length ? projects.map(kanbanProject).join('') : '<div class="inline-empty" data-kanban-empty>Nada por aquí.</div>'}</div></section>`;
        }).join('')}</div>`;
    }

    function kanbanProject(project) {
        const meta = projectType(project) === 'commercial'
            ? (project.due_date ? dateDistance(project.due_date) : 'Sin fecha')
            : 'Proyecto propio';
        const statuses = [['planned','Por empezar'],['active','En marcha'],['on_hold','En pausa'],['completed','Terminado'],['archived','Archivado']];
        return `<article class="kanban-card${isProjectPinned(project) ? ' is-pinned' : ''}${Number(state.kanban.savingId) === Number(project.id) ? ' is-saving' : ''}" draggable="true" aria-grabbed="false" data-kanban-project="${Number(project.id)}" data-project-preview="${Number(project.id)}" data-project-status="${escapeHTML(project.status)}" style="--project-color:${safeColor(project.color)}">
            <div class="kanban-card-kicker"><span class="kanban-drag-handle" aria-hidden="true">${icon('drag')}</span>${projectTypeBadge(project, true)}<span class="kanban-card-spacer"></span>${projectPinButton(project, true)}</div>
            <button class="kanban-open" type="button" data-project-preview="${Number(project.id)}" aria-label="Abrir vista del proyecto ${escapeHTML(project.name)}"><h3>${escapeHTML(project.name)}</h3><p>${escapeHTML(markdownPlain(project.description) || 'Sin descripción')}</p></button>
            <footer><small>${escapeHTML(meta)}</small><span class="kanban-progress" style="--progress:${clamp(project.progress,0,100)}">${clamp(project.progress,0,100)}%</span></footer>
            <div class="kanban-card-controls"><label><span>Estado</span><select data-kanban-status-select="${Number(project.id)}" aria-label="Cambiar estado de ${escapeHTML(project.name)}">${optionList(statuses,project.status)}</select></label><button class="text-button" type="button" data-edit="project" data-id="${Number(project.id)}">Editar</button></div>
        </article>`;
    }

    function projectPreviewLoading() {
        return `<div class="project-preview-loading" aria-label="Cargando proyecto"><h2 class="sr-only" id="project-preview-title">Cargando proyecto</h2><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-subtitle"></div><div class="skeleton skeleton-panel"></div></div>`;
    }

    async function openProjectPreview(id, { quiet = false } = {}) {
        const projectId = Number(id);
        if (!projectId || !dom.projectPreviewDialog || !dom.projectPreviewContent) return;
        closeRecordPreview();
        closeDropdowns();
        const requestId = ++state.projectPreview.requestId;
        state.projectPreview.id = projectId;
        state.projectPreview.data = null;
        dom.projectPreviewContent.innerHTML = projectPreviewLoading();
        if (!dom.projectPreviewDialog.open) dom.projectPreviewDialog.showModal();
        try {
            const [projectResult, shareResult, feedbackResult] = await Promise.allSettled([
                api.get(`projects/${projectId}/overview`),
                api.get(`project-shares/${projectId}`),
                api.get(`project-shares/${projectId}/feedback`),
            ]);
            if (projectResult.status === 'rejected') throw projectResult.reason;
            if (requestId !== state.projectPreview.requestId || !dom.projectPreviewDialog.open) return;
            const overview = projectResult.value.data || {};
            const share = shareResult.status === 'fulfilled' ? (shareResult.value.data || {}) : { unavailable: true };
            const feedback = feedbackResult.status === 'fulfilled' ? (feedbackResult.value.data || {}) : {};
            overview.public_share = {
                ...share,
                items: Array.isArray(feedback.items) ? feedback.items : [],
                summary: feedback.summary || share.feedback || { total: 0, new: 0, in_review: 0, resolved: 0, closed: 0 },
                feedback_unavailable: feedbackResult.status === 'rejected',
            };
            state.projectPreview.data = overview;
            renderProjectPreview(overview);
            if (!quiet) requestAnimationFrame(() => dom.projectPreviewContent.querySelector('[data-project-preview-close]')?.focus());
        } catch (error) {
            if (requestId !== state.projectPreview.requestId || !dom.projectPreviewDialog.open) return;
            dom.projectPreviewContent.innerHTML = `<div class="project-preview-error"><span>!</span><h2 id="project-preview-title">No pudimos abrir el proyecto</h2><p>${escapeHTML(error.message)}</p><div><button class="button button-ghost" type="button" data-project-preview-close>Cerrar</button><button class="button button-primary" type="button" data-project-preview-retry="${projectId}">Reintentar</button></div></div>`;
        }
    }

    function renderProjectPreview(overview = {}) {
        const project = overview.project || overview;
        const tasks = Array.isArray(overview.tasks) ? overview.tasks : [];
        const timeline = Array.isArray(overview.timeline) ? overview.timeline : [];
        const releases = Array.isArray(overview.releases) ? overview.releases : [];
        const resources = Array.isArray(overview.resources) ? overview.resources : [];
        const budgets = Array.isArray(overview.budgets) ? overview.budgets : [];
        const attachments = Array.isArray(overview.attachments) ? overview.attachments : [];
        const photos = attachments.filter(item => Boolean(item.preview_url));
        const documents = attachments.filter(item => !item.preview_url);
        const publicShare = overview.public_share || { unavailable: true, items: [], summary: {} };
        const tech = asArray(project.tech_stack);
        const tags = asArray(project.tags);
        const color = safeColor(project.color);
        const completed = tasks.filter(task => task.status === 'done').length;
        const links = [
            project.repository_url ? ['Repositorio', project.repository_url, 'folder'] : null,
            project.live_url ? ['Sitio publicado', project.live_url, 'link'] : null,
        ].filter(Boolean);
        const isCommercial = projectType(project) === 'commercial';
        const progress = clamp(project.progress,0,100);
        const dueLabel = project.due_date ? (() => { const distance = dateDistance(project.due_date); return /^\d/.test(distance) ? distance : `${shortDate(project.due_date)} · ${distance}`; })() : '';
        const metaLine = [isCommercial ? (project.client_name || 'Sin cliente asignado') : 'Proyecto propio', dueLabel ? `Entrega ${dueLabel}` : '', project.updated_at ? `Actualizado ${shortDate(project.updated_at)}` : ''].filter(Boolean);
        const facts = [
            ['Modalidad', isCommercial ? 'Comercial' : 'Personal'],
            ['Estado', STATUS[project.status] || 'Sin estado'],
            ['Prioridad', PRIORITY[project.priority] || 'Media'],
            [isCommercial ? 'Cliente' : 'Propósito', isCommercial ? (project.client_name || 'Sin cliente asignado') : 'Proyecto propio'],
            ['Fecha objetivo', isCommercial ? (dueLabel || 'Sin fecha definida') : 'Sin fecha de entrega'],
            ['Creado', formatDate(project.created_at)],
        ];
        dom.projectPreviewContent.innerHTML = `<header class="project-sheet-head" style="--project-color:${color}">
            <div class="project-sheet-top">
                <div class="project-preview-kickers">${statusBadge(project.status)}${projectTypeBadge(project)}<span class="priority-badge priority-${escapeHTML(project.priority || 'medium')}">${escapeHTML(PRIORITY[project.priority] || 'Prioridad media')}</span></div>
                <div class="project-sheet-actions">${projectPinButton(project)}<button class="icon-button" type="button" data-project-preview-edit="${Number(project.id)}" aria-label="Editar proyecto"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg></button><button class="icon-button project-preview-close" type="button" data-project-preview-close aria-label="Cerrar vista del proyecto"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
            </div>
            <h2 id="project-preview-title"><i class="project-sheet-dot" aria-hidden="true"></i>${escapeHTML(project.name || 'Proyecto')}</h2>
            <p class="project-sheet-meta">${metaLine.map(item => `<span>${escapeHTML(item)}</span>`).join('')}</p>
            <div class="project-sheet-progress" role="group" aria-label="Progreso del proyecto"><div><span>Progreso</span><strong>${progress} %</strong></div><div class="progress-bar"><span style="--progress:${progress}%"></span></div><small>${tasks.length ? `${completed} de ${countLabel(tasks.length,'tarea','tareas')} completadas` : 'Sin tareas asociadas todavía'}</small></div>
        </header>
        <div class="project-preview-body">
            <div class="project-preview-grid">
                <div class="project-preview-main">
                    <section class="project-detail-section" aria-labelledby="project-description-title"><header><div><h3 id="project-description-title">Descripción</h3></div></header>${project.description ? `<div class="project-sheet-description" tabindex="0">${markdownHTML(project.description)}</div>` : '<div class="preview-inline-empty">Este proyecto todavía no tiene una descripción. <button class="text-button" type="button" data-project-preview-edit="' + Number(project.id) + '">Añadir descripción</button></div>'}</section>
                    <section class="project-detail-section" aria-labelledby="project-tasks-title"><header><div><h3 id="project-tasks-title">Tareas</h3><p>${tasks.length ? `${completed} de ${countLabel(tasks.length,'tarea','tareas')} completadas` : 'Las próximas acciones de este proyecto'}</p></div><button class="button button-small" type="button" data-create="task" data-prefill-project="${Number(project.id)}">${icon('plus')}Nueva tarea</button></header><div class="project-preview-tasks">${tasks.length ? tasks.map(projectPreviewTask).join('') : '<div class="preview-inline-empty">Todavía no hay tareas para este proyecto.</div>'}</div></section>
                    <section class="project-detail-section" aria-labelledby="project-timeline-title"><header><div><h3 id="project-timeline-title">Línea de tiempo</h3><p>Avances, decisiones, bloqueos y aprendizajes.</p></div><button class="button button-small" type="button" data-create="devlog" data-prefill-project="${Number(project.id)}">${icon('plus')}Registrar cambio</button></header><div class="project-preview-timeline">${timeline.length ? timeline.map(projectTimelineEntry).join('') : '<div class="preview-inline-empty">Registra el primer cambio para empezar la historia del proyecto.</div>'}</div></section>
                    ${projectSnippetsSection(project, Array.isArray(overview.snippets) ? overview.snippets : [])}
                    ${projectPhotoSection(project, photos)}
                    ${documents.length ? projectDocumentSection(documents) : ''}
                    ${projectShareSection(project, publicShare)}
                </div>
                <aside class="project-preview-aside" aria-label="Información del proyecto">
                    <section class="project-related-section project-sheet-facts"><header><h3>Datos</h3></header><dl>${facts.map(([label,value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl></section>
                    <section class="project-related-section"><header><h3>Enlaces</h3></header>${links.length ? `<nav class="project-preview-links" aria-label="Enlaces del proyecto">${links.map(([label,url,iconName]) => `<a href="${escapeHTML(safeUrl(url))}" target="_blank" rel="noopener">${icon(iconName)}<span>${escapeHTML(label)}</span>${icon('chevron')}</a>`).join('')}</nav>` : '<p class="project-sheet-empty">Sin repositorio ni sitio publicado.</p>'}</section>
                    <section class="project-related-section"><header><h3>Tecnologías</h3></header>${tech.length ? `<div class="tech-list">${tech.map(item => `<span class="tag">${escapeHTML(item)}</span>`).join('')}</div>` : '<p class="project-sheet-empty">Sin stack definido.</p>'}${tags.length ? `<div class="tag-cloud">${tags.map(item => `<span>#${escapeHTML(item)}</span>`).join('')}</div>` : ''}</section>
                    ${projectAccessSection(resources)}
                    ${projectRelatedSection('Entregas y versiones', releases, item => `<button type="button" data-record-preview="release" data-id="${Number(item.id)}"><span>${escapeHTML(item.version || RELEASE_KINDS[item.kind] || 'Entrega')}</span><strong>${escapeHTML(item.title || 'Sin título')}</strong><small>${escapeHTML(item.release_date ? shortDate(item.release_date) : STATUS[item.status] || 'Sin fecha')}</small></button>`)}
                    ${projectRelatedSection('Recursos', resources, item => `<button type="button" data-record-preview="resource" data-id="${Number(item.id)}"><span>${escapeHTML(RESOURCE_TYPES[item.resource_type] || 'Recurso')}</span><strong>${escapeHTML(item.name || 'Sin nombre')}</strong><small>${escapeHTML(item.provider || ENVIRONMENTS[item.environment] || 'Sin proveedor')}</small></button>`)}
                    ${projectRelatedSection('Presupuestos', budgets, item => `<button type="button" data-record-preview="budget" data-id="${Number(item.id)}"><span>${escapeHTML(STATUS[item.status] || 'Presupuesto')}</span><strong>${escapeHTML(item.title || 'Sin título')}</strong><small>${moneyHTML(item.amount,item.currency)}</small></button>`)}
                </aside>
            </div>
        </div>
        <footer class="project-preview-footer"><div><span>${isProjectPinned(project) ? 'Fijado en tu cartera' : 'En tu cartera'}</span></div><button class="button" type="button" data-project-preview-close>Cerrar</button><button class="button button-primary" type="button" data-project-preview-edit="${Number(project.id)}">Editar proyecto</button></footer>`;
    }

    function projectPhotoSection(project, photos) {
        return `<section class="project-detail-section project-photo-section" aria-labelledby="project-gallery-title"><header><div><h3 id="project-gallery-title">Galería</h3><p>Capturas, avances visuales y referencias.</p></div><form class="project-photo-form" data-project-photo-form="${Number(project.id)}" enctype="multipart/form-data"><div><label class="button button-secondary button-small"><input type="file" name="file" accept=".jpg,.jpeg,.png,.webp,.gif" multiple required><span>${icon('image')} Elegir fotos</span></label><button class="button button-primary button-small" type="submit">Subir</button></div><small data-project-photo-feedback role="status" aria-live="polite"></small></form></header><div class="project-photo-gallery">${photos.length ? photos.map(projectPhoto).join('') : `<div class="project-photo-empty">${icon('image')}<strong>Tu galería está vacía</strong><span>Sube una captura para mostrar cómo va tomando forma.</span></div>`}</div></section>`;
    }

    function projectPhoto(item) {
        const preview = attachmentPreviewHref(item);
        return `<figure class="project-photo"><a href="${escapeHTML(preview)}" target="_blank" rel="noopener"><img src="${escapeHTML(preview)}" alt="${escapeHTML(item.original_name || 'Foto del proyecto')}" loading="lazy"></a><figcaption><span title="${escapeHTML(item.original_name)}">${escapeHTML(item.original_name || 'Imagen')}</span><small>${escapeHTML(bytesLabel(item.size_bytes))}</small></figcaption><button type="button" data-project-photo-delete="${Number(item.id)}" aria-label="Eliminar ${escapeHTML(item.original_name || 'foto')}">×</button></figure>`;
    }

    function attachmentPreviewHref(item) {
        const raw = item.preview_url || '#';
        try { const url = new URL(raw, location.href); return url.origin === location.origin ? url.href : '#'; } catch { return '#'; }
    }

    function projectPreviewTask(task) {
        const done = task.status === 'done';
        return `<article class="project-preview-task${done ? ' is-done' : ''}"><button class="task-check${done ? ' is-done' : ''}" type="button" data-task-toggle="${Number(task.id)}" aria-label="${done ? 'Reabrir' : 'Completar'} ${escapeHTML(task.title)}">${done ? icon('check') : ''}</button><button class="project-preview-task-copy" type="button" data-record-preview="task" data-id="${Number(task.id)}"><strong>${escapeHTML(task.title || 'Tarea sin título')}</strong><span>${escapeHTML(PRIORITY[task.priority] || 'Prioridad media')}${task.due_date ? ` · ${dateDistance(task.due_date)}` : ' · Sin fecha'}${checklistOf(task).length ? ` · ${checklistOf(task).filter(item => item.done).length}/${checklistOf(task).length} subtareas` : ''}${Number(task.estimated_minutes) ? ` · ${hoursLabel(task.estimated_minutes)}` : ''}</span></button><div class="task-row-end">${!done ? `<button class="icon-button task-timer-button" type="button" data-task-timer="${Number(task.id)}" aria-label="Empezar temporizador para ${escapeHTML(task.title || 'la tarea')}" title="Empezar temporizador">${icon('clock')}</button>` : ''}${statusBadge(task.status)}</div></article>`;
    }

    function projectTimelineEntry(entry) {
        const date = entry.entry_date || entry.created_at || entry.updated_at;
        const type = entry.entry_type || entry.type || 'note';
        return `<article class="project-timeline-entry" data-record-preview="devlog" data-id="${Number(entry.id)}"><span class="project-timeline-mark entry-type-${escapeHTML(type)}"></span><div><header><div>${devlogTypeBadge(type)}<time datetime="${escapeHTML(date || '')}">${escapeHTML(formatDate(date))}</time></div><button class="text-button" type="button" data-edit="devlog" data-id="${Number(entry.id)}">Editar</button></header><h4 role="button" tabindex="0" data-record-preview="devlog" data-id="${Number(entry.id)}">${escapeHTML(entry.title || 'Cambio registrado')}</h4><p>${escapeHTML(markdownPlain(entry.content) || 'Sin detalles adicionales.')}</p>${Number(entry.minutes_spent) ? `<small>${icon('clock')}${Number(entry.minutes_spent)} min</small>` : ''}</div></article>`;
    }

    function projectDocumentSection(documents) {
        return `<section class="project-detail-section" aria-labelledby="project-documents-title"><header><div><h3 id="project-documents-title">Archivos vinculados</h3><p>${documents.length} ${documents.length === 1 ? 'archivo relacionado' : 'archivos relacionados'}.</p></div></header><div class="project-preview-documents">${documents.map(item => `<a href="${escapeHTML(attachmentHref(item))}"><span class="file-type">${escapeHTML(String(item.original_name || '').split('.').pop().slice(0,5).toUpperCase() || 'DOC')}</span><span><strong>${escapeHTML(item.original_name || 'Archivo')}</strong><small>${escapeHTML(bytesLabel(item.size_bytes))}</small></span>${icon('arrow')}</a>`).join('')}</div></section>`;
    }

    function projectRelatedSection(title, items, renderer) {
        if (!items.length) return '';
        return `<section class="project-related-section"><header><h3>${escapeHTML(title)}</h3><span>${items.length}</span></header><div>${items.slice(0,6).map(renderer).join('')}</div></section>`;
    }

    const FEEDBACK_TYPES = { comment: 'Comentario', bug: 'Bug', error: 'Error' };
    const FEEDBACK_STATUSES = { new: 'Nuevo', in_review: 'En revisión', resolved: 'Resuelto', closed: 'Cerrado' };

    function feedbackReference(item = {}) {
        const raw = String(item.reference || '').trim();
        if (/^[a-f0-9]{32}$/i.test(raw)) return `CP-${raw.slice(0, 10).toUpperCase()}`;
        return raw || `Reporte #${Number(item.id)}`;
    }

    function projectShareUrl(share = {}) {
        const raw = String(share.public_path || '').trim();
        if (!raw) return '';
        try {
            const url = new URL(raw, location.href);
            return url.origin === location.origin ? url.href : '';
        } catch { return ''; }
    }

    function projectShareSection(project, share = {}) {
        if (share.unavailable) {
            return `<section class="project-detail-section project-share-section is-unavailable" aria-labelledby="project-share-title"><header><div><h3 id="project-share-title">Portal de revisión</h3><p>El portal no está disponible en este entorno.</p></div></header></section>`;
        }
        const enabled = Boolean(share.enabled);
        const url = projectShareUrl(share);
        const items = Array.isArray(share.items) ? share.items : [];
        const summary = share.summary || share.feedback || {};
        const total = Number(summary.total || items.length || 0);
        const pending = Number(summary.new || 0) + Number(summary.in_review || 0);
        const linkPanel = enabled && url
            ? `<div class="project-share-link-panel"><div class="project-share-link-copy"><label for="project-share-url-${Number(project.id)}">Enlace para compartir</label><div><input id="project-share-url-${Number(project.id)}" value="${escapeHTML(url)}" readonly spellcheck="false"><div class="project-share-buttons"><button class="button button-secondary button-small" type="button" data-project-share-copy>Copiar</button>${typeof navigator.share === 'function' ? '<button class="button button-secondary button-small" type="button" data-project-share-native>Compartir</button>' : ''}<a class="button button-ghost button-small" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Abrir</a></div></div><small>El enlace permite enviar comentarios e imágenes, pero no muestra información privada de CodePanel.</small></div><div class="project-share-link-actions"><button class="text-button" type="button" data-project-share-action="regenerate">Regenerar</button><button class="text-button is-danger" type="button" data-project-share-action="disable">Desactivar</button></div></div>`
            : enabled
                ? `<div class="project-share-empty is-warning"><span>!</span><div><strong>No pudimos preparar el enlace</strong><p>Regeneralo para reemplazarlo por uno nuevo y seguro.</p></div><button class="button button-primary button-small" type="button" data-project-share-action="regenerate">Regenerar enlace</button></div>`
                : `<div class="project-share-empty"><span>${icon('mail')}</span><div><strong>Crea un enlace de revisión no listado</strong><p>La persona que lo reciba podrá registrar comentarios, bugs y errores con capturas, sin entrar a CodePanel.</p></div><button class="button button-primary button-small" type="button" data-project-share-action="enable">Crear enlace</button></div>`;
        const feedbackContent = share.feedback_unavailable
            ? `<div class="project-feedback-empty is-error" role="status"><strong>No pudimos cargar los reportes</strong><span>El enlace sigue disponible; vuelve a intentarlo para consultar el feedback recibido.</span><button class="text-button" type="button" data-project-feedback-retry>Reintentar</button></div>`
            : items.length
                ? `<div class="project-feedback-list" role="list" aria-label="Feedback recibido">${items.map(projectFeedbackItem).join('')}</div>`
                : `<div class="project-feedback-empty"><strong>Todavía no llegó feedback</strong><span>Los reportes nuevos aparecerán aquí con sus imágenes y su estado.</span></div>`;
        return `<section class="project-detail-section project-share-section${enabled ? ' is-enabled' : ''}" aria-labelledby="project-share-title">
            <header><div><h3 id="project-share-title">Portal de revisión</h3><p>${enabled ? 'Comparte el avance y recibe reportes directamente en el proyecto.' : 'El portal está cerrado hasta que decidas habilitarlo.'}</p></div><div class="project-share-summary"><strong data-project-share-total>${total}</strong><span>${total === 1 ? 'reporte' : 'reportes'}</span><em data-project-share-pending${pending ? '' : ' hidden'}>${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}</em></div></header>
            ${linkPanel}
            ${feedbackContent}
        </section>`;
    }

    function projectFeedbackItem(item = {}) {
        const images = Array.isArray(item.images) ? item.images : [];
        const type = FEEDBACK_TYPES[item.type] || 'Comentario';
        const status = Object.hasOwn(FEEDBACK_STATUSES, item.status) ? item.status : 'new';
        const email = String(item.author_email || '').trim();
        const reference = feedbackReference(item);
        return `<article class="project-feedback-item feedback-type-${escapeHTML(item.type || 'comment')}" role="listitem" data-project-feedback-item="${Number(item.id)}">
            <header><div><span class="feedback-type-label">${escapeHTML(type)}</span><strong>${escapeHTML(reference)}</strong></div><label><span class="sr-only">Estado del reporte</span><select data-project-feedback-status="${Number(item.id)}" aria-label="Estado de ${escapeHTML(reference)}">${Object.entries(FEEDBACK_STATUSES).map(([value,label]) => `<option value="${value}"${value === status ? ' selected' : ''}>${escapeHTML(label)}</option>`).join('')}</select></label></header>
            <p>${escapeHTML(item.message || 'Sin detalles.')}</p>
            ${images.length ? `<div class="project-feedback-images">${images.map((image,index) => { const preview=attachmentPreviewHref(image); return `<a href="${escapeHTML(preview)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHTML(preview)}" alt="Captura ${index + 1} del reporte ${escapeHTML(reference)}" loading="lazy"></a>`; }).join('')}</div>` : ''}
            <footer><div><strong>${escapeHTML(item.author_name || 'Persona invitada')}</strong>${email ? `<a href="mailto:${escapeHTML(email)}">${escapeHTML(email)}</a>` : ''}<time datetime="${escapeHTML(item.created_at || '')}">${escapeHTML(formatDate(item.created_at))}</time></div><div class="project-feedback-actions"><button class="text-button" type="button" data-project-feedback-task="${Number(item.id)}" aria-label="Convertir ${escapeHTML(reference)} en tarea">Convertir en tarea</button><button class="text-button is-danger" type="button" data-project-feedback-delete="${Number(item.id)}" aria-label="Eliminar ${escapeHTML(reference)}">Eliminar</button></div></footer>
        </article>`;
    }

    function recordPreviewLoading() {
        return `<div class="record-preview-loading" aria-label="Cargando vista previa"><h2 class="sr-only" id="record-preview-title">Cargando vista previa</h2><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-subtitle"></div><div class="skeleton skeleton-panel"></div></div>`;
    }

    function recordRoute(entity) {
        return entity === 'attachment' ? 'attachments' : ENTITY_ROUTE[entity];
    }

    function entityFromRoute(route) {
        if (route === 'projects' || route === 'project') return 'project';
        if (route === 'attachments' || route === 'attachment') return 'attachment';
        return ROUTE_ENTITY[route] || (RECORD_PREVIEW_ENTITIES.has(route) ? route : null);
    }

    function previewDependencies(entity, record = {}) {
        const common = {
            task: ['projects'], reminder: ['projects'], devlog: ['projects'],
            client: ['projects','budgets'], budget: ['projects','clients','payments'],
            payment: ['budgets','projects','clients'], release: ['projects'], resource: ['projects'],
            time_entry: ['projects','tasks'],
            tag: ['projects','ideas','tasks','devlogs','clients','leads','budgets','releases','resources','reminders','time_entries','weekly_reviews'],
        }[entity] || [];
        if (entity !== 'attachment') return common;
        const route = String(record.entity_type || '');
        return route && route !== 'general' && (ROUTE_ENTITY[route] || route === 'projects') ? [route] : [];
    }

    async function openRecordPreview(entity, id, { quiet = false } = {}) {
        if (entity === 'project') { closeRecordPreview(); return openProjectPreview(id, { quiet }); }
        if (!RECORD_PREVIEW_ENTITIES.has(entity)) return;
        const recordId = Number(id);
        const route = recordRoute(entity);
        if (!recordId || !route || !dom.recordPreviewDialog || !dom.recordPreviewContent) return;
        closeDropdowns();
        closeProjectPreview();
        const requestId = ++state.recordPreview.requestId;
        state.recordPreview = { entity, id: recordId, record: null, requestId };
        dom.recordPreviewContent.innerHTML = recordPreviewLoading();
        if (!dom.recordPreviewDialog.open) dom.recordPreviewDialog.showModal();
        try {
            const rows = await getCollection(route);
            let record = rows.find(item => Number(item.id) === recordId);
            if (!record && entity !== 'attachment') record = (await api.get(`${route}/${recordId}`)).data || null;
            if (!record) throw new ApiError('No encontramos ese registro.', 404);
            await Promise.allSettled(previewDependencies(entity, record).map(dependency => getCollection(dependency)));
            if (requestId !== state.recordPreview.requestId || !dom.recordPreviewDialog.open) return;
            state.recordPreview.record = record;
            renderRecordPreview(entity, record);
            if (!quiet) requestAnimationFrame(() => dom.recordPreviewContent.querySelector('[data-record-preview-close]')?.focus());
        } catch (error) {
            if (requestId !== state.recordPreview.requestId || !dom.recordPreviewDialog.open) return;
            dom.recordPreviewContent.innerHTML = `<div class="record-preview-error"><span>!</span><h2 id="record-preview-title">No pudimos abrir la vista previa</h2><p>${escapeHTML(error.message)}</p><div class="record-preview-actions"><button class="button button-ghost" type="button" data-record-preview-close>Cerrar</button><button class="button button-primary" type="button" data-record-preview-retry="${escapeHTML(entity)}" data-id="${recordId}">Reintentar</button></div></div>`;
        }
    }

    function closeRecordPreview() {
        if (dom.recordPreviewDialog?.open) dom.recordPreviewDialog.close();
    }

    function cachedRows(route) {
        return state.cache.get(route)?.data || [];
    }

    function cachedRecord(entity, id) {
        const route = recordRoute(entity);
        return route ? cachedRows(route).find(item => Number(item.id) === Number(id)) || null : null;
    }

    function recordTitle(entity, item = {}) {
        const title = {
            idea: item.title, task: item.title, reminder: item.title, devlog: item.title,
            client: item.name, lead: item.name, budget: item.title,
            payment: item.reference ? `Cobro · ${item.reference}` : `Cobro #${Number(item.id)}`,
            release: item.title, resource: item.name, time_entry: item.description, snippet: item.title,
            weekly_review: item.week_start ? `Semana del ${formatDate(item.week_start)}` : 'Revisión semanal',
            attachment: item.original_name, tag: item.name ? `#${item.name}` : 'Etiqueta',
        }[entity];
        return title || `${RECORD_PREVIEW_LABELS[entity] || 'Registro'} #${Number(item.id)}`;
    }

    function recordSubtitle(entity, item = {}) {
        if (entity === 'task' || entity === 'devlog' || entity === 'reminder' || entity === 'release' || entity === 'resource' || entity === 'time_entry') return item.project_name || 'Sin proyecto asociado';
        if (entity === 'snippet') return [item.language, item.project_name || 'Fragmento general'].filter(Boolean).join(' · ');
        if (entity === 'idea') return item.category || 'Idea sin categoría';
        if (entity === 'client') return item.company || 'Profesional independiente';
        if (entity === 'lead') return item.company || item.email || 'Contacto sin empresa';
        if (entity === 'budget') return [item.client_name,item.project_name].filter(Boolean).join(' · ') || 'Propuesta sin vinculación';
        if (entity === 'payment') return item.budget_title || 'Movimiento de cobro';
        if (entity === 'weekly_review') return `Valoración ${clamp(item.rating,1,5)} de 5`;
        if (entity === 'attachment') return attachmentContext(item);
        if (entity === 'tag') return `${Number(item.usage_count || 0)} ${Number(item.usage_count || 0) === 1 ? 'uso' : 'usos'} en tu espacio`;
        return RECORD_PREVIEW_LABELS[entity] || 'Registro';
    }

    function recordPills(entity, item = {}) {
        const values = [];
        if (item.status) values.push(STATUS[item.status] || item.status);
        if (entity === 'idea' && item.archived) values.push('Archivada');
        if (entity === 'devlog') values.push(DEVLOG_TYPES[item.entry_type] || 'Nota');
        if (entity === 'release') values.push(RELEASE_KINDS[item.kind] || 'Versión');
        if (entity === 'resource') values.push(RESOURCE_TYPES[item.resource_type] || 'Recurso');
        if (entity === 'payment') values.push(PAYMENT_METHODS[item.method] || 'Otro medio');
        if (entity === 'time_entry') values.push(item.is_running || (item.started_at && !item.ended_at) ? 'En curso' : 'Finalizado', Number(item.billable) ? 'Facturable' : 'No facturable');
        if (entity === 'attachment') values.push(item.mime_type || 'Archivo');
        if (entity === 'tag') values.push('Etiqueta global');
        return `<div class="record-preview-tags">${values.filter(Boolean).map(value => `<span class="record-preview-tag">${escapeHTML(value)}</span>`).join('')}</div>`;
    }

    function previewMetaGrid(items) {
        const visible = items.filter(([,value]) => value !== undefined);
        if (!visible.length) return '';
        return `<div class="record-preview-meta-grid">${visible.map(([label,value]) => `<div class="record-preview-meta-item"><span class="record-preview-label">${escapeHTML(label)}</span><span class="record-preview-value">${escapeHTML(value === null || value === '' ? 'Sin especificar' : value)}</span></div>`).join('')}</div>`;
    }

    function previewSection(title, content, empty = 'Sin información adicional.') {
        return `<section class="record-preview-section"><header class="record-preview-section-head"><h3>${escapeHTML(title)}</h3></header>${content ? `<div class="record-preview-copy">${markdownHTML(content)}</div>` : `<div class="record-preview-empty">${escapeHTML(empty)}</div>`}</section>`;
    }

    function previewMetaSection(title, items) {
        const grid = previewMetaGrid(items);
        return `<section class="record-preview-section"><header class="record-preview-section-head"><h3>${escapeHTML(title)}</h3></header>${grid || '<div class="record-preview-empty">Sin detalles para mostrar.</div>'}</section>`;
    }

    function previewTagSection(tags) {
        const values = asArray(tags);
        return `<section class="record-preview-section"><header class="record-preview-section-head"><h3>Etiquetas</h3></header>${values.length ? `<div class="record-preview-tags">${values.map(tag => `<span class="record-preview-tag">#${escapeHTML(tag)}</span>`).join('')}</div>` : '<div class="record-preview-empty">Sin etiquetas.</div>'}</section>`;
    }

    function previewLinksSection(links) {
        const visible = links.filter(link => link?.url && safeUrl(link.url) !== '#');
        if (!visible.length) return '';
        return `<section class="record-preview-section"><header class="record-preview-section-head"><h3>Enlaces y contacto</h3></header><div class="record-preview-links">${visible.map(link => `<a href="${escapeHTML(safeUrl(link.url))}"${String(link.url).startsWith('mailto:') || String(link.url).startsWith('tel:') ? '' : ' target="_blank" rel="noopener"'}>${icon(link.icon || 'link')}<span>${escapeHTML(link.label)}</span>${icon('arrow')}</a>`).join('')}</div></section>`;
    }

    function previewRelationItem(entity, item, subtitle = '') {
        if (!item || !Number(item.id)) return '';
        return `<button class="record-preview-list-item" type="button" data-preview-related="${escapeHTML(entity)}" data-id="${Number(item.id)}"><span><strong>${escapeHTML(recordTitle(entity,item))}</strong><small>${escapeHTML(subtitle || recordSubtitle(entity,item))}</small></span>${icon('arrow')}</button>`;
    }

    function previewRelatedSection(title, rows) {
        const content = rows.filter(Boolean);
        return `<section class="record-preview-section record-preview-related"><header class="record-preview-section-head"><h3>${escapeHTML(title)}</h3><span>${content.length}</span></header>${content.length ? `<div class="record-preview-list">${content.join('')}</div>` : '<div class="record-preview-empty">No hay registros vinculados.</div>'}</section>`;
    }

    function projectRelation(projectId, projectName) {
        const project = cachedRecord('project', projectId) || (projectId ? { id: Number(projectId), name: projectName || `Proyecto #${Number(projectId)}` } : null);
        return project ? previewRelatedSection('Proyecto asociado', [previewRelationItem('project', project, STATUS[project.status] || 'Abrir proyecto')]) : '';
    }

    function attachmentRelation(item) {
        const entity = entityFromRoute(String(item.entity_type || ''));
        if (!entity || !Number(item.entity_id)) return '';
        const related = cachedRecord(entity, item.entity_id);
        return related ? previewRelatedSection('Vinculado a', [previewRelationItem(entity, related)]) : '';
    }

    function tagUsageRows(tag) {
        const needle = String(tag.name || tag.slug || '').toLocaleLowerCase('es');
        const definitions = [['projects','project'],['ideas','idea'],['tasks','task'],['devlogs','devlog'],['clients','client'],['leads','lead'],['budgets','budget'],['releases','release'],['resources','resource'],['reminders','reminder'],['time_entries','time_entry'],['weekly_reviews','weekly_review']];
        return definitions.flatMap(([route,entity]) => cachedRows(route)
            .filter(item => asArray(item.tags).some(value => String(value).toLocaleLowerCase('es') === needle))
            .map(item => previewRelationItem(entity,item,RECORD_PREVIEW_LABELS[entity]))).slice(0,12);
    }

    function recordPreviewDetails(entity, item) {
        const created = item.created_at ? formatDate(item.created_at) : undefined;
        const updated = item.updated_at ? formatDate(item.updated_at) : undefined;
        const base = [['Creado',created],['Último cambio',updated]];
        let main = [];
        let aside = [];
        let tags = item.tags;
        let links = [];

        if (entity === 'idea') {
            main.push(previewSection('Idea y contexto',item.description,'Esta idea todavía no tiene una descripción.'));
            aside.push(previewMetaSection('Evaluación',[['Estado',item.archived ? 'Archivada' : STATUS[item.status] || item.status],['Categoría',item.category],['Impacto',`${clamp(item.impact,1,5)} de 5`],['Esfuerzo',`${clamp(item.effort,1,5)} de 5`],...base]));
        } else if (entity === 'snippet') {
            main.push(snippetPreviewSection(item));
            aside.push(previewMetaSection('Fragmento',[['Lenguaje',item.language || 'Sin especificar'],['Líneas',String(String(item.content || '').split('\n').length)],['Actualizado',item.updated_at ? shortDate(item.updated_at) : null]]),projectRelation(item.project_id,item.project_name));
        } else if (entity === 'task') {
            main.push(previewSection('Descripción',item.description,'Esta tarea no tiene detalles adicionales.'), taskChecklistSection(item));
            const timeSection = taskTimeSection(item); if (timeSection) aside.push(timeSection);
            aside.push(previewMetaSection('Planificación',[['Estado',STATUS[item.status] || item.status],['Prioridad',PRIORITY[item.priority] || item.priority],['Responsable',item.assignee],['Fecha límite',item.due_date ? `${formatDate(item.due_date)} · ${dateDistance(item.due_date)}` : null],['Completada',item.completed_at ? formatDate(item.completed_at) : undefined],...base]),projectRelation(item.project_id,item.project_name));
        } else if (entity === 'reminder') {
            main.push(previewSection('Notas',item.notes,'No hay notas para este recordatorio.'));
            aside.push(previewMetaSection('Atención',[['Estado',STATUS[item.status] || item.status],['Prioridad',PRIORITY[item.priority] || item.priority],['Vencimiento',item.due_at ? formatDate(item.due_at,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : null],['Distancia',dateDistance(item.due_at)],...base]),projectRelation(item.project_id,item.project_name));
        } else if (entity === 'devlog') {
            main.push(previewSection('Qué pasó',item.content,'La entrada no tiene contenido adicional.'));
            aside.push(previewMetaSection('Registro',[['Tipo',DEVLOG_TYPES[item.entry_type] || item.entry_type],['Fecha',formatDate(item.entry_date)],['Tiempo dedicado',Number(item.minutes_spent) ? minutesLabel(item.minutes_spent) : 'Sin tiempo registrado'],...base]),projectRelation(item.project_id,item.project_name));
        } else if (entity === 'client') {
            const projects = cachedRows('projects').filter(row => Number(row.client_id) === Number(item.id));
            const budgets = cachedRows('budgets').filter(row => Number(row.client_id) === Number(item.id));
            main.push(previewSection('Notas de la relación',item.notes,'Todavía no has guardado notas sobre este cliente.'),previewRelatedSection('Proyectos',[...projects.map(row => previewRelationItem('project',row))]),previewRelatedSection('Presupuestos',[...budgets.map(row => previewRelationItem('budget',row,formatMoney(row.amount,row.currency)))]));
            aside.push(previewMetaSection('Contacto',[['Estado',STATUS[item.status] || item.status],['Empresa',item.company],['Correo',item.email],['Teléfono',item.phone],['Origen',item.source],['Último contacto',item.last_contact ? `${formatDate(item.last_contact)} · ${dateDistance(item.last_contact)}` : null],...base]));
            links = [{label:item.email,url:item.email ? `mailto:${item.email}` : '',icon:'mail'},{label:item.phone,url:item.phone ? `tel:${item.phone}` : '',icon:'phone'},{label:'Sitio web',url:item.website,icon:'link'}];
        } else if (entity === 'lead') {
            main.push(previewSection('Notas de la oportunidad',item.notes,'Todavía no hay notas de esta conversación.'));
            aside.push(previewMetaSection('Oportunidad',[['Etapa',STATUS[item.status] || item.status],['Empresa',item.company],['Valor estimado',formatMoney(item.value)],['Próximo seguimiento',item.next_follow_up ? `${formatDate(item.next_follow_up)} · ${dateDistance(item.next_follow_up)}` : null],['Origen',item.source],['Correo',item.email],['Teléfono',item.phone],...base]));
            links = [{label:item.email,url:item.email ? `mailto:${item.email}` : '',icon:'mail'},{label:item.phone,url:item.phone ? `tel:${item.phone}` : '',icon:'phone'}];
        } else if (entity === 'budget') {
            const payments = cachedRows('payments').filter(row => Number(row.budget_id) === Number(item.id));
            const project = cachedRecord('project',item.project_id);
            const client = cachedRecord('client',item.client_id);
            main.push(previewSection('Alcance y notas',item.notes,'Este presupuesto no tiene notas de alcance.'),previewRelatedSection('Cobros',payments.map(row => previewRelationItem('payment',row,`${formatMoney(row.amount,item.currency)} · ${formatDate(row.paid_at)}`))));
            aside.push(previewMetaSection('Importes',[['Estado',STATUS[item.status] || item.status],['Total',formatMoney(item.amount,item.currency)],['Cobrado',formatMoney(item.paid_amount,item.currency)],['Pendiente',formatMoney(item.balance,item.currency)],['Moneda',item.currency],['Válido hasta',item.valid_until ? `${formatDate(item.valid_until)} · ${dateDistance(item.valid_until)}` : null],...base]),previewRelatedSection('Contexto',[project ? previewRelationItem('project',project) : '',client ? previewRelationItem('client',client) : '']));
        } else if (entity === 'payment') {
            const budget = cachedRecord('budget',item.budget_id);
            const currency = budget?.currency || state.settings?.default_currency || 'ARS';
            main.push(previewSection('Notas del cobro',item.notes,'Este cobro no tiene notas adicionales.'));
            aside.push(previewMetaSection('Movimiento',[['Importe',formatMoney(item.amount,currency)],['Fecha de cobro',formatDate(item.paid_at)],['Medio',PAYMENT_METHODS[item.method] || item.method],['Referencia',item.reference],...base]),previewRelatedSection('Presupuesto',[budget ? previewRelationItem('budget',budget,`${formatMoney(budget.balance,budget.currency)} pendiente`) : '']));
            tags = [];
        } else if (entity === 'release') {
            main.push(previewSection('Notas de la entrega',item.notes,'No hay notas para esta salida.'));
            aside.push(previewMetaSection('Salida',[['Tipo',RELEASE_KINDS[item.kind] || item.kind],['Versión',item.version],['Estado',STATUS[item.status] || item.status],['Entorno',ENVIRONMENTS[item.environment] || item.environment],['Fecha',item.release_date ? `${formatDate(item.release_date)} · ${dateDistance(item.release_date)}` : null],...base]),projectRelation(item.project_id,item.project_name));
            links = [{label:'Abrir entrega',url:item.url,icon:'link'}];
        } else if (entity === 'resource') {
            main.push(previewSection('Notas operativas',item.notes,'Este recurso no tiene notas.'));
            aside.push(previewMetaSection('Infraestructura',[['Tipo',RESOURCE_TYPES[item.resource_type] || item.resource_type],['Estado',STATUS[item.status] || item.status],['Entorno',ENVIRONMENTS[item.environment] || item.environment],['Proveedor',item.provider],...(item.credential_ref ? [['Credencial',item.credential_ref]] : []),['Costo',Number(item.cost) ? formatMoney(item.cost,item.currency) : 'Sin costo'],['Ciclo',BILLING_CYCLES[item.billing_cycle] || item.billing_cycle],['Renovación',item.renewal_date ? `${formatDate(item.renewal_date)} · ${dateDistance(item.renewal_date)}` : null],...base]),projectRelation(item.project_id,item.project_name));
            links = [{label:'Abrir recurso',url:item.url,icon:'link'}];
        } else if (entity === 'time_entry') {
            const task = cachedRecord('task',item.task_id);
            main.push(previewSection('Trabajo realizado',item.description,'Sin descripción de trabajo.'));
            aside.push(previewMetaSection('Tiempo',[['Fecha',formatDate(item.work_date)],['Duración',minutesLabel(elapsedMinutes(item))],['Facturación',Number(item.billable) ? 'Facturable' : 'No facturable'],['Inicio',item.started_at ? formatDate(item.started_at,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : null],['Fin',item.ended_at ? formatDate(item.ended_at,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : null],['Costo por hora',Number(item.hourly_cost) ? formatMoney(item.hourly_cost,item.cost_currency || state.settings?.default_currency) : undefined],...base]),projectRelation(item.project_id,item.project_name),task ? previewRelatedSection('Tarea asociada',[previewRelationItem('task',task)]) : '');
        } else if (entity === 'weekly_review') {
            main.push(previewSection('Lo mejor de la semana',item.wins,'No se registraron logros.'),previewSection('Bloqueos',item.blockers,'No se registraron bloqueos.'),previewSection('Próximo foco',item.next_focus,'Todavía no se definió el próximo foco.'));
            aside.push(previewMetaSection('Semana',[['Comienzo',formatDate(item.week_start)],['Valoración',`${clamp(item.rating,1,5)} de 5`],...base]));
        } else if (entity === 'attachment') {
            const preview = item.preview_url ? attachmentPreviewHref(item) : '';
            main.push(`<section class="record-preview-section"><header class="record-preview-section-head"><h3>${preview ? 'Vista del archivo' : 'Archivo disponible'}</h3></header>${preview ? `<a class="record-preview-image" href="${escapeHTML(preview)}" target="_blank" rel="noopener"><img src="${escapeHTML(preview)}" alt="${escapeHTML(item.original_name || 'Imagen adjunta')}"></a>` : `<a class="record-preview-file" href="${escapeHTML(attachmentHref(item))}">${icon('package')}<span><strong>${escapeHTML(item.original_name || 'Archivo')}</strong><small>Descargar archivo</small></span>${icon('arrow')}</a>`}</section>`);
            aside.push(previewMetaSection('Archivo',[['Nombre',item.original_name],['Tipo',item.mime_type],['Tamaño',bytesLabel(item.size_bytes)],['Vinculación',attachmentContext(item)],['Subido',formatDate(item.created_at)]]),attachmentRelation(item));
            tags = [];
        } else if (entity === 'tag') {
            const usage = tagUsageRows(item);
            main.push(previewRelatedSection('Registros con esta etiqueta',usage));
            aside.push(previewMetaSection('Etiqueta',[['Nombre',item.name],['Identificador',item.slug],['Usos',String(Number(item.usage_count || usage.length))],['Color',item.color],...base]));
            tags = [];
        }

        const tagSection = asArray(tags).length ? previewTagSection(tags) : '';
        const linkSection = previewLinksSection(links);
        return { main: [...main,tagSection,linkSection].filter(Boolean).join(''), aside: aside.filter(Boolean).join('') };
    }

    function renderRecordPreview(entity, item) {
        const details = recordPreviewDetails(entity,item);
        const canEdit = Boolean(ENTITY_ROUTE[entity]);
        const download = entity === 'attachment' ? attachmentHref(item) : '';
        dom.recordPreviewContent.innerHTML = `<header class="record-preview-header"><div class="record-preview-hero"><span class="record-preview-eyebrow">${escapeHTML(RECORD_PREVIEW_LABELS[entity] || 'Registro')}</span>${recordPills(entity,item)}<h2 class="record-preview-title" id="record-preview-title">${escapeHTML(recordTitle(entity,item))}</h2><p class="record-preview-subtitle">${escapeHTML(markdownPlain(recordSubtitle(entity,item)))}</p></div><button class="record-preview-close" type="button" data-record-preview-close aria-label="Cerrar vista previa"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="record-preview-body"><div class="record-preview-grid"><main class="record-preview-main">${details.main || '<div class="record-preview-empty">No hay información adicional.</div>'}</main><aside class="record-preview-aside">${details.aside}</aside></div></div><footer class="record-preview-footer"><span>${escapeHTML(RECORD_PREVIEW_LABELS[entity] || 'Registro')} #${Number(item.id)}</span><div class="record-preview-actions"><button class="button button-ghost" type="button" data-record-preview-close>Cerrar</button>${download ? `<a class="button button-secondary" href="${escapeHTML(download)}">Descargar</a>` : ''}${canEdit ? `<button class="button button-primary" type="button" data-record-preview-edit="${escapeHTML(entity)}" data-id="${Number(item.id)}">Editar</button>` : ''}</div></footer>`;
    }

    function renderIdeas(items) {
        const showingArchive = state.filters.ideas.status === 'archived';
        const available = items.filter(item => showingArchive ? item.archived : !item.archived);
        const visible = filtered(available, 'ideas');
        const categories = visible.reduce((result, item) => { const category = item.category || 'Sin categoría'; result[category] = (result[category] || 0) + 1; return result; }, {});
        const maxCategory = Math.max(1, ...Object.values(categories));
        const content = !visible.length
            ? (available.length
                ? noFilterResults('ideas')
                : showingArchive
                    ? '<div class="empty-state"><div class="empty-inner"><div class="empty-art"><span>◇</span></div><h2>El archivo está vacío</h2><p>Cuando archives una idea, podrás recuperarla desde aquí.</p><button class="button button-ghost" type="button" data-clear-filters="ideas">Volver al semillero</button></div></div>'
                    : emptyState('idea', 'Planta tu primera idea', 'No necesita estar resuelta. Guárdala ahora y dale forma cuando sea el momento.'))
            : `<div class="idea-layout"><div class="idea-grid">${visible.map(ideaCard).join('')}</div><aside class="idea-sidebar"><div class="idea-breakdown"><h3>Por categoría</h3>${Object.entries(categories).slice(0,5).map(([category,count], index) => `<div class="breakdown-row"><span>${escapeHTML(category)}</span><strong>${count}</strong><div class="breakdown-bar" style="--bar-color:${['var(--yellow)','var(--coral)','var(--sage)','var(--blue)','var(--purple)'][index % 5]}"><span style="width:${Math.round(count/maxCategory*100)}%"></span></div></div>`).join('')}</div></aside></div>`;
        return `${pageHeading('Tu semillero', 'Ideas que pueden <em>crecer</em>.', 'Captura la chispa, mide su potencial y deja que madure sin presión.', 'idea')}
            ${collectionToolbar('ideas', visible.length, [['inbox','En la bandeja'],['exploring','Explorando'],['validated','Validadas'],['building','Construyendo'],['parked','En pausa'],['archived','Archivadas']])}${content}`;
    }

    function ideaCard(idea, index) {
        const colors = [
            ['var(--yellow)', 'var(--yellow-wash)'], ['var(--sage)', 'var(--sage-wash)'],
            ['var(--coral)', 'var(--coral-wash)'], ['var(--blue)', 'var(--blue-wash)'], ['var(--purple)', 'var(--purple-wash)'],
        ];
        const [color,wash] = colors[index % colors.length];
        const dots = score => Array.from({length:5}, (_, i) => `<i class="${i < clamp(score,1,5) ? 'is-filled' : ''}"></i>`).join('');
        return `<article class="idea-card" style="--idea-color:${color};--idea-wash:${wash}" data-record="idea" data-id="${Number(idea.id)}" data-record-preview="idea"><span class="pin"></span><div class="card-topline">${statusBadge(idea.archived ? 'archived' : idea.status)}<button class="icon-button card-menu-button" type="button" data-card-menu aria-label="Opciones">${icon('more')}</button></div><div class="card-actions-menu" hidden><button type="button" data-edit="idea" data-id="${Number(idea.id)}">Editar</button><button class="danger" type="button" data-delete="idea" data-id="${Number(idea.id)}">Eliminar</button></div><button class="card-content-button" type="button" data-record-preview="idea" data-id="${Number(idea.id)}"><h2>${escapeHTML(idea.title)}</h2><p class="description">${escapeHTML(markdownPlain(idea.description) || 'Una idea que todavía está buscando palabras.')}</p></button><div class="idea-tags">${asArray(idea.tags).map(tag => `<span>${escapeHTML(tag)}</span>`).join('')}</div><footer class="idea-score"><span>Impacto <span class="dot-score">${dots(idea.impact)}</span></span><span>Esfuerzo <span class="dot-score">${dots(idea.effort)}</span></span></footer></article>`;
    }

    function renderClients(items) {
        const visible = filtered(items, 'clients');
        const content = !visible.length ? (items.length ? noFilterResults('clients') : emptyState('client', 'Construye tu red de trabajo', 'Guarda a tus clientes y todo el contexto que hace más humana cada relación.')) : `<div class="contact-grid">${visible.map(contactCard).join('')}</div>`;
        const active = items.filter(item => item.status === 'active').length;
        return `${pageHeading('Tu red', 'Clientes, con <em>contexto</em>.', `${active} relaciones activas. Datos, notas y últimos contactos en un solo lugar.`, 'client', '<button class="button button-ghost" type="button" data-nav-button="leads">Ver oportunidades</button>')}
            ${collectionToolbar('clients', visible.length, [['active','Activos'],['lead','Potenciales'],['inactive','Inactivos']])}${content}`;
    }

    function contactCard(client, index) {
        const colors = ['var(--blue-wash)','var(--sage-wash)','var(--coral-wash)','var(--purple-wash)','var(--yellow-wash)'];
        return `<article class="contact-card" data-record="client" data-id="${Number(client.id)}" data-record-preview="client"><header class="contact-header"><span class="contact-initial" style="--avatar-color:${colors[index % colors.length]}">${initials(client.name)}</span><div role="button" tabindex="0" data-record-preview="client" data-id="${Number(client.id)}"><h2>${escapeHTML(client.name)}</h2><p>${escapeHTML(client.company || 'Profesional independiente')}</p></div><button class="icon-button card-menu-button" type="button" data-card-menu aria-label="Opciones">${icon('more')}</button></header><div class="card-actions-menu" hidden><button type="button" data-edit="client" data-id="${Number(client.id)}">Editar</button><button class="danger" type="button" data-delete="client" data-id="${Number(client.id)}">Eliminar</button></div><div class="contact-details">${client.email ? `<a href="mailto:${escapeHTML(client.email)}">${icon('mail')}${escapeHTML(client.email)}</a>` : '<span>Sin correo guardado</span>'}${client.phone ? `<a href="tel:${escapeHTML(client.phone)}">${icon('phone')}${escapeHTML(client.phone)}</a>` : ''}${client.website ? `<a href="${escapeHTML(safeUrl(client.website))}" target="_blank" rel="noopener">${icon('link')}${escapeHTML(client.website.replace(/^https?:\/\//,''))}</a>` : ''}</div><footer class="contact-footer">${statusBadge(client.status)}<small>${client.last_contact ? `Contacto ${escapeHTML(dateDistance(client.last_contact).toLowerCase())}` : 'Sin contacto reciente'}</small></footer></article>`;
    }

    function renderLeads(items) {
        const visible = filtered(items, 'leads');
        const open = visible.filter(item => !['won','lost'].includes(item.status));
        const value = open.reduce((sum, item) => sum + Number(item.value || 0), 0);
        const stages = [['new','Nuevos','var(--purple)'],['contacted','Contactados','var(--coral)'],['qualified','Calificados','var(--blue)'],['proposal','Propuesta','var(--yellow)'],['won','Ganados','var(--sage)'],['lost','Perdidos','var(--muted)']];
        const content = !visible.length ? (items.length ? noFilterResults('leads') : emptyState('lead', 'Tu próxima colaboración puede empezar aquí', 'Registra personas interesadas y acompaña cada conversación hasta convertirla en trabajo.')) : `<div class="pipeline">${stages.map(([status,label,color]) => { const leads = visible.filter(lead => lead.status === status); return `<section class="pipeline-stage" style="--stage-color:${color}"><header class="pipeline-header"><i></i><strong>${label}</strong><span>${leads.length}</span></header><div class="lead-list">${leads.length ? leads.map(leadCard).join('') : '<div class="inline-empty">Sin oportunidades</div>'}</div></section>`; }).join('')}</div>`;
        return `${pageHeading('Nuevas relaciones', 'Oportunidades en <em>movimiento</em>.', `${open.length} conversaciones abiertas por un valor estimado de ${formatMoney(value)}.`, 'lead', '<button class="button button-ghost" type="button" data-nav-button="clients">Ver clientes</button>')}
            ${collectionToolbar('leads', visible.length)}${content}`;
    }

    function leadCard(lead) {
        return `<article class="lead-card" role="button" tabindex="0" aria-label="Abrir oportunidad de ${escapeHTML(lead.name)}" data-record-preview="lead" data-id="${Number(lead.id)}"><h3>${escapeHTML(lead.name)}</h3><p>${escapeHTML(lead.company || lead.email || 'Contacto sin empresa')}</p><div class="lead-value"><strong>${formatMoney(lead.value)}</strong><small>${lead.next_follow_up ? escapeHTML(dateDistance(lead.next_follow_up)) : 'Sin seguimiento'}</small></div></article>`;
    }

    function renderTasks(items) {
        const visible = filtered(items, 'tasks');
        const done = items.filter(item => item.status === 'done').length;
        const completion = items.length ? Math.round(done / items.length * 100) : 0;
        const groups = [['in_progress','En curso','var(--blue)'],['todo','Por hacer','var(--purple)'],['done','Completadas','var(--sage)']];
        const board = !visible.length ? (items.length ? noFilterResults('tasks') : emptyState('task', 'Una próxima acción cambia todo', 'Anota tareas concretas y conéctalas con tus proyectos para mantener el impulso.')) : `<div class="task-page-grid"><div class="task-board">${groups.map(([status,label,color]) => { const tasks = visible.filter(task => task.status === status); return `<section class="task-group"><header class="task-group-header" style="--group-color:${color}"><strong><i></i>${label}</strong><span>${tasks.length}</span></header>${tasks.length ? tasks.map(task => taskRow(task)).join('') : '<div class="inline-empty">No hay tareas en esta etapa.</div>'}</section>`; }).join('')}</div><aside class="task-aside"><div class="week-card"><h2>Ritmo actual</h2><p>${done} de ${items.length} tareas completadas</p><div class="week-progress"><span style="width:${completion}%"></span></div><div class="week-caption"><span>Avance total</span><strong>${completion}%</strong></div></div><div class="priority-legend"><h3>Prioridades</h3><p><i class="priority-dot" style="--priority-color:var(--danger)"></i>Urgente</p><p><i class="priority-dot" style="--priority-color:var(--coral)"></i>Alta</p><p><i class="priority-dot" style="--priority-color:var(--yellow)"></i>Media</p><p><i class="priority-dot" style="--priority-color:var(--sage)"></i>Baja</p></div></aside></div>`;
        return `${pageHeading('Tu próxima acción', 'Tareas para <em>avanzar</em>.', 'Una lista deliberadamente simple: qué hacer, para cuándo y dentro de qué proyecto.', 'task')}
            ${collectionToolbar('tasks', visible.length, [['in_progress','En curso'],['todo','Por hacer'],['done','Completadas']], true)}${state.filters.tasks.view === 'board' && visible.length ? taskBoard(visible) : board}`;
    }

    function devlogTypeBadge(type) {
        return `<span class="entry-type-badge entry-type-${escapeHTML(type || 'note')}">${escapeHTML(DEVLOG_TYPES[type] || 'Nota')}</span>`;
    }

    function renderDevlogs(items) {
        const visible = filtered(items, 'devlogs');
        const minutes = visible.reduce((sum, item) => sum + Number(item.minutes_spent || 0), 0);
        const content = !visible.length
            ? (items.length ? noFilterResults('devlogs') : emptyState('devlog', 'Empieza a registrar el camino', 'Guarda avances, decisiones y aprendizajes para volver a ellos cuando los necesites.'))
            : `<div class="devlog-timeline">${visible.map(devlogEntry).join('')}</div>`;
        return `${pageHeading('Memoria de trabajo', 'Una bitácora para <em>recordar por qué</em>.', `${visible.length} entradas${minutes ? ` y ${minutes} minutos registrados` : ''}. El contexto también forma parte del proyecto.`, 'devlog')}
            ${collectionToolbar('devlogs', visible.length, Object.entries(DEVLOG_TYPES))}${content}`;
    }

    function devlogEntry(entry) {
        const colors = { progress: 'var(--blue)', decision: 'var(--purple)', blocker: 'var(--danger)', learning: 'var(--yellow)', note: 'var(--sage)' };
        const tags = asArray(entry.tags);
        return `<article class="devlog-entry" style="--entry-color:${colors[entry.entry_type] || 'var(--sage)'}" data-record="devlog" data-id="${Number(entry.id)}">
            <div class="devlog-marker" aria-hidden="true"><i></i></div>
            <div class="devlog-card" data-record-preview="devlog" data-id="${Number(entry.id)}">
                <header class="devlog-head"><div><time datetime="${escapeHTML(entry.entry_date || '')}">${escapeHTML(formatDate(entry.entry_date, { day: 'numeric', month: 'long', year: 'numeric' }))}</time><div class="devlog-labels">${devlogTypeBadge(entry.entry_type)}${entry.project_name ? `<span>${escapeHTML(entry.project_name)}</span>` : '<span>Sin proyecto</span>'}</div></div><button class="icon-button card-menu-button" type="button" data-card-menu aria-label="Opciones de ${escapeHTML(entry.title)}">${icon('more')}</button></header>
                <div class="card-actions-menu" hidden><button type="button" data-edit="devlog" data-id="${Number(entry.id)}">Editar</button><button class="danger" type="button" data-delete="devlog" data-id="${Number(entry.id)}">Eliminar</button></div>
                <button class="devlog-content-button" type="button" data-record-preview="devlog" data-id="${Number(entry.id)}"><h2>${escapeHTML(entry.title)}</h2><p>${escapeHTML(markdownPlain(entry.content) || 'Sin notas adicionales.')}</p></button>
                <footer class="devlog-footer"><div class="devlog-tags">${tags.map(tag => `<span>#${escapeHTML(tag)}</span>`).join('')}</div>${Number(entry.minutes_spent) > 0 ? `<small>${icon('clock')}${Number(entry.minutes_spent)} min</small>` : ''}</footer>
            </div>
        </article>`;
    }

    function groupedMoney(items, field) {
        const currencies = ['ARS', 'USD', 'EUR'].filter(currency => items.some(item => item.currency === currency));
        if (!currencies.length) return '<span>$ 0</span>';
        return currencies.map(currency => `<span><small>${currency}</small>${moneyHTML(items.filter(item => item.currency === currency).reduce((sum, item) => sum + Number(item[field] || 0), 0), currency)}</span>`).join('');
    }

    function financeMetric(label, items, field, caption) {
        return `<article class="finance-metric"><div class="finance-metric-label">${escapeHTML(label)}</div><div class="finance-values">${groupedMoney(items, field)}</div><small>${escapeHTML(caption)}</small></article>`;
    }

    function renderBudgets(items) {
        const visible = filtered(items, 'budgets');
        const payments = state.cache.get('payments')?.data || [];
        const canCharge = items.length > 0;
        const headingAction = canCharge ? '<button class="button button-ghost" type="button" data-create="payment">Registrar cobro</button>' : '';
        const budgetContent = !visible.length
            ? (items.length ? noFilterResults('budgets') : emptyState('budget', 'Dale forma a tu primer presupuesto', 'Ordena alcance, valor y vigencia antes de compartir una propuesta.'))
            : `<div class="budget-grid">${visible.map(budgetCard).join('')}</div>`;
        return `${pageHeading('Trabajo comercial', 'Presupuestos y <em>cobros claros</em>.', 'Una vista honesta de lo cotizado, lo que ya ingresó y lo que todavía está pendiente.', 'budget', headingAction)}
            <div class="finance-metrics">${financeMetric('Cotizado', items, 'amount', `${items.length} ${items.length === 1 ? 'presupuesto' : 'presupuestos'}`)}${financeMetric('Cobrado', items, 'paid_amount', `${payments.length} ${payments.length === 1 ? 'movimiento' : 'movimientos'}`)}${financeMetric('Pendiente', items, 'balance', 'Saldo por cobrar')}</div>
            ${collectionToolbar('budgets', visible.length, [['draft','Borradores'],['sent','Enviados'],['approved','Aprobados'],['rejected','Rechazados'],['expired','Vencidos']])}
            <div class="finance-layout"><section aria-label="Presupuestos">${budgetContent}</section>${paymentPanel(payments, canCharge)}</div>`;
    }

    function budgetCard(budget) {
        const amount = Number(budget.amount || 0);
        const paid = Number(budget.paid_amount || 0);
        const progress = amount > 0 ? clamp(Math.round(paid / amount * 100), 0, 100) : 0;
        const validity = daysUntil(budget.valid_until);
        const validityClass = validity !== null && validity < 0 ? ' is-late' : validity !== null && validity <= 7 ? ' is-soon' : '';
        return `<article class="budget-card" data-record="budget" data-id="${Number(budget.id)}" data-record-preview="budget">
            <header><div>${statusBadge(budget.status)}<small>${escapeHTML(budget.currency || 'USD')}</small></div><button class="icon-button card-menu-button" type="button" data-card-menu aria-label="Opciones de ${escapeHTML(budget.title)}">${icon('more')}</button></header>
            <div class="card-actions-menu" hidden><button type="button" data-edit="budget" data-id="${Number(budget.id)}">Editar</button><button class="danger" type="button" data-delete="budget" data-id="${Number(budget.id)}">Eliminar</button></div>
            <button class="budget-content-button" type="button" data-record-preview="budget" data-id="${Number(budget.id)}"><h2>${escapeHTML(budget.title)}</h2><p>${escapeHTML(budget.client_name || 'Sin cliente asignado')}${budget.project_name ? ` · ${escapeHTML(budget.project_name)}` : ''}</p><strong>${moneyHTML(amount, budget.currency)}</strong></button>
            <div class="budget-progress"><div><span>Cobrado</span><strong>${progress}%</strong></div><div class="progress-bar"><span style="--progress:${progress}%"></span></div><small>Saldo ${moneyHTML(budget.balance, budget.currency)}</small></div>
            <footer><span class="budget-validity${validityClass}">${icon('calendar')}${budget.valid_until ? `Vigente ${escapeHTML(dateDistance(budget.valid_until).toLowerCase())}` : 'Sin vencimiento'}</span><button class="text-button" type="button" data-create="payment" data-prefill-budget="${Number(budget.id)}">${icon('plus')}Cobro</button></footer>
        </article>`;
    }

    function paymentPanel(payments, canCharge) {
        return `<aside class="payment-panel"><header><div><span class="eyebrow">Movimientos</span><h2>Cobros recientes</h2></div>${canCharge ? '<button class="icon-button" type="button" data-create="payment" aria-label="Registrar cobro">' + icon('plus') + '</button>' : ''}</header><div class="payment-list">${payments.length ? payments.map(paymentRow).join('') : '<div class="inline-empty">Todavía no has registrado cobros.</div>'}</div></aside>`;
    }

    function paymentRow(payment) {
        const budget = (state.cache.get('budgets')?.data || []).find(item => Number(item.id) === Number(payment.budget_id));
        const currency = budget?.currency || 'USD';
        return `<article class="payment-row" role="button" tabindex="0" aria-label="Abrir cobro de ${moneyHTML(payment.amount, currency)}" data-record-preview="payment" data-id="${Number(payment.id)}"><span class="payment-mark">${icon('wallet')}</span><div><strong>${moneyHTML(payment.amount, currency)}</strong><p>${escapeHTML(payment.budget_title || 'Presupuesto')} · ${escapeHTML(PAYMENT_METHODS[payment.method] || 'Otro medio')}</p></div><time datetime="${escapeHTML(payment.paid_at || '')}">${escapeHTML(shortDate(payment.paid_at))}</time></article>`;
    }

    function renderReleases(items) {
        const visible = filtered(items, 'releases');
        const published = items.filter(item => item.status === 'published').length;
        const content = !visible.length
            ? (items.length ? noFilterResults('releases') : emptyState('release', 'Registra tu primera entrega', 'Conserva versiones, enlaces y contexto para saber exactamente qué llegó a cada entorno.'))
            : `<div class="release-timeline">${visible.map(releaseCard).join('')}</div>`;
        return `${pageHeading('Historial de salida', 'Entregas con <em>trazabilidad</em>.', `${published} publicadas de ${items.length}. Cada versión deja una huella clara.`, 'release')}
            ${collectionToolbar('releases', visible.length, [['planned','Planificadas'],['ready','Listas'],['published','Publicadas'],['rolled_back','Revertidas']])}${content}`;
    }

    function releaseCard(release) {
        const date = release.release_date ? parseDate(release.release_date) : null;
        return `<article class="release-card" data-record="release" data-id="${Number(release.id)}" data-record-preview="release"><div class="release-date"><strong>${date ? date.getDate() : '—'}</strong><span>${date ? new Intl.DateTimeFormat('es-AR', { month: 'short' }).format(date).replace('.', '') : 'Sin fecha'}</span></div><div class="release-body"><header><div class="release-labels">${statusBadge(release.status)}<span class="release-kind">${escapeHTML(RELEASE_KINDS[release.kind] || 'Versión')}</span><span>${escapeHTML(ENVIRONMENTS[release.environment] || release.environment || 'Sin entorno')}</span></div><button class="icon-button card-menu-button" type="button" data-card-menu aria-label="Opciones de ${escapeHTML(release.title)}">${icon('more')}</button></header><div class="card-actions-menu" hidden><button type="button" data-edit="release" data-id="${Number(release.id)}">Editar</button><button class="danger" type="button" data-delete="release" data-id="${Number(release.id)}">Eliminar</button></div><button class="release-content-button" type="button" data-record-preview="release" data-id="${Number(release.id)}"><span class="release-version">${escapeHTML(release.version || 'Sin versión')}</span><h2>${escapeHTML(release.title)}</h2><p>${escapeHTML(markdownPlain(release.notes) || 'Sin notas para esta salida.')}</p></button><footer><span>${icon('folder')}${escapeHTML(release.project_name || 'Sin proyecto')}</span>${release.url ? `<a href="${escapeHTML(safeUrl(release.url))}" target="_blank" rel="noopener">Abrir enlace ${icon('arrow')}</a>` : ''}</footer></div></article>`;
    }

    function renderResources(items) {
        const visible = filtered(items, 'resources');
        const attention = items.filter(item => item.status === 'attention').length;
        const renewals = items.filter(item => { const days = daysUntil(item.renewal_date); return days !== null && days >= 0 && days <= 30; }).length;
        const content = !visible.length
            ? (items.length ? noFilterResults('resources') : emptyState('resource', 'Arma tu inventario técnico', 'Dominios, servicios y repositorios en un solo lugar, sin guardar credenciales sensibles.'))
            : `<div class="resource-grid">${visible.map(resourceCard).join('')}</div>`;
        return `${pageHeading('Inventario operativo', 'La infraestructura, <em>a la vista</em>.', `${items.length} recursos registrados, ${attention} con atención pendiente y ${renewals} renovaciones próximas.`, 'resource')}
            <aside class="security-note" role="note"><span>${icon('alert')}</span><div><strong>Este inventario no es una bóveda.</strong><p>No guardes contraseñas, tokens, claves privadas ni secretos en nombres, URLs o notas.</p></div></aside>
            <div class="resource-metrics"><article><strong>${items.filter(item => item.status === 'active').length}</strong><span>Activos</span></article><article><strong>${attention}</strong><span>Con atención</span></article><article><strong>${renewals}</strong><span>Renuevan en 30 días</span></article><article><strong>${items.filter(item => Number(item.cost) > 0).length}</strong><span>Con costo registrado</span></article></div>
            ${collectionToolbar('resources', visible.length, [['active','Activos'],['attention','Requieren atención'],['inactive','Inactivos']])}${content}`;
    }

    function resourceCard(resource) {
        const renewalDays = daysUntil(resource.renewal_date);
        const renewalClass = renewalDays !== null && renewalDays < 0 ? ' is-late' : renewalDays !== null && renewalDays <= 30 ? ' is-soon' : '';
        const cost = Number(resource.cost || 0) > 0 ? `${formatMoney(resource.cost, resource.currency)} · ${BILLING_CYCLES[resource.billing_cycle] || 'Sin ciclo'}` : 'Sin costo registrado';
        return `<article class="resource-card" data-record="resource" data-id="${Number(resource.id)}" data-record-preview="resource"><header><span class="resource-icon">${icon('server')}</span><div><small>${escapeHTML(RESOURCE_TYPES[resource.resource_type] || 'Recurso')}</small><h2>${escapeHTML(resource.name)}</h2></div><button class="icon-button card-menu-button" type="button" data-card-menu aria-label="Opciones de ${escapeHTML(resource.name)}">${icon('more')}</button></header><div class="card-actions-menu" hidden><button type="button" data-edit="resource" data-id="${Number(resource.id)}">Editar</button><button class="danger" type="button" data-delete="resource" data-id="${Number(resource.id)}">Eliminar</button></div><button class="resource-content-button" type="button" data-record-preview="resource" data-id="${Number(resource.id)}"><div class="resource-badges">${statusBadge(resource.status)}<span>${escapeHTML(ENVIRONMENTS[resource.environment] || 'Sin entorno')}</span></div><dl><div><dt>Proveedor</dt><dd>${escapeHTML(resource.provider || 'Sin especificar')}</dd></div><div><dt>Proyecto</dt><dd>${escapeHTML(resource.project_name || 'Compartido')}</dd></div><div><dt>Costo</dt><dd>${escapeHTML(cost)}</dd></div></dl></button><footer><span class="resource-renewal${renewalClass}">${icon('calendar')}${resource.renewal_date ? `Renueva ${escapeHTML(dateDistance(resource.renewal_date).toLowerCase())}` : 'Sin renovación'}</span>${resource.url ? `<a href="${escapeHTML(safeUrl(resource.url))}" target="_blank" rel="noopener" aria-label="Abrir ${escapeHTML(resource.name)}">${icon('link')}</a>` : ''}</footer></article>`;
    }

    function renderReminders(items = []) {
        const visible = filtered(items, 'reminders');
        const pending = items.filter(item => item.status === 'pending');
        const overdue = pending.filter(item => daysUntil(item.due_at) < 0).length;
        const derived = items.filter(item => item.derived).length;
        const groups = [
            ['Vencidos', item => item.status === 'pending' && daysUntil(item.due_at) < 0],
            ['Hoy', item => item.status === 'pending' && daysUntil(item.due_at) === 0],
            ['Próximos', item => item.status === 'pending' && daysUntil(item.due_at) > 0 && daysUntil(item.due_at) <= 7],
            ['Más adelante', item => item.status === 'pending' && (daysUntil(item.due_at) > 7 || daysUntil(item.due_at) === null)],
            ['Resueltos', item => item.status !== 'pending'],
        ];
        const content = visible.length ? `<div class="reminder-layout"><div class="reminder-groups">${groups.map(([label,test]) => {
            const records = visible.filter(test); return records.length ? `<section class="reminder-group"><header><h2>${label}</h2><span>${records.length}</span></header>${records.map(reminderCard).join('')}</section>` : '';
        }).join('')}</div><aside class="reminder-explainer panel panel-padded"><span class="reminder-bell">${icon('alert')}</span><h2>Todo lo que pide atención</h2><p>CodePanel combina tus recordatorios con vencimientos de tareas, oportunidades, presupuestos, entregas y recursos.</p><button class="text-button" type="button" data-nav-button="settings">Cambiar anticipación${icon('chevron')}</button></aside></div>`
            : emptyState('reminder', 'Nada pendiente por ahora', 'Crea un recordatorio personal o deja que CodePanel reúna las fechas de tu espacio.');
        return `${pageHeading('Centro de atención', 'Que nada importante <em>se pierda</em>.', `${pending.length} pendientes, ${overdue} vencidos y ${derived} alertas automáticas.`, 'reminder')}
            <div class="resource-metrics"><article><strong>${pending.length}</strong><span>Pendientes</span></article><article><strong>${overdue}</strong><span>Vencidos</span></article><article><strong>${pending.filter(item => daysUntil(item.due_at) === 0).length}</strong><span>Para hoy</span></article><article><strong>${derived}</strong><span>Automáticos</span></article></div>
            ${collectionToolbar('reminders', visible.length, [['pending','Pendientes'],['done','Completados'],['dismissed','Descartados']])}${content}`;
    }

    function reminderCard(item) {
        const isDerived = Boolean(item.derived || item.source_type);
        const late = item.status === 'pending' && daysUntil(item.due_at) < 0;
        const id = Number(item.id);
        const previewAttributes = isDerived ? `data-source-open="${escapeHTML(item.source_type)}" data-id="${Number(item.source_id)}"` : `data-record-preview="reminder" data-id="${id}"`;
        return `<article class="reminder-card${late ? ' is-late' : ''}${item.status !== 'pending' ? ' is-resolved' : ''}" ${previewAttributes}>
            <span class="reminder-priority priority-${escapeHTML(item.priority || 'medium')}"></span>
            <div class="reminder-copy" role="button" tabindex="0" ${previewAttributes}><div>${statusBadge(item.status)}${isDerived ? '<span class="derived-badge">Automático</span>' : ''}</div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(markdownPlain(item.notes) || item.project_name || 'Sin notas adicionales.')}</p><small>${escapeHTML(item.project_name || (isDerived ? sourceLabel(item.source_type) : 'Personal'))}</small></div>
            <div class="reminder-date"><time datetime="${escapeHTML(item.due_at || '')}">${escapeHTML(dateDistance(item.due_at))}</time><small>${escapeHTML(formatDate(item.due_at, { day:'numeric', month:'short', hour: item.due_at && String(item.due_at).length > 10 ? '2-digit' : undefined, minute: item.due_at && String(item.due_at).length > 10 ? '2-digit' : undefined }))}</small></div>
            <div class="reminder-actions">${isDerived
                ? `<button class="button button-ghost button-small" type="button" data-source-open="${escapeHTML(item.source_type)}" data-id="${Number(item.source_id)}">Abrir origen</button>`
                : `${item.status === 'pending' ? `<button class="button button-secondary button-small" type="button" data-reminder-status="done" data-id="${id}">✓ Hecho</button><button class="text-button" type="button" data-reminder-status="dismissed" data-id="${id}">Descartar</button>` : `<button class="text-button" type="button" data-reminder-status="pending" data-id="${id}">Reabrir</button>`}<button class="icon-button" type="button" data-edit="reminder" data-id="${id}" aria-label="Editar recordatorio">${icon('more')}</button>`}
            </div>
        </article>`;
    }

    function sourceLabel(source) {
        return { project:'Proyecto', projects:'Proyecto', task:'Tarea', tasks:'Tarea', lead:'Oportunidad', leads:'Oportunidad', budget:'Presupuesto', budgets:'Presupuesto', payment:'Cobro', payments:'Cobro', release:'Entrega', releases:'Entrega', resource:'Recurso', resources:'Recurso', reminder:'Recordatorio', reminders:'Recordatorio', client:'Cliente', clients:'Cliente', general:'Documentación general' }[source] || 'Evento';
    }

    function renderTime(items = []) {
        const visible = filtered(items, 'time');
        const week = weekBounds(new Date());
        const weekly = items.filter(item => item.work_date >= week.start && item.work_date <= week.end);
        const today = items.filter(item => item.work_date === todayISO());
        const running = items.find(item => Boolean(item.is_running) || (item.started_at && !item.ended_at));
        const total = weekly.reduce((sum,item) => sum + elapsedMinutes(item), 0);
        const billable = weekly.filter(item => Boolean(Number(item.billable))).reduce((sum,item) => sum + elapsedMinutes(item), 0);
        const action = running
            ? `<button class="button button-danger" type="button" data-timer-stop="${Number(running.id)}">${icon('clock')} Detener temporizador</button>`
            : `<button class="button button-secondary" type="button" data-timer-start>${icon('clock')} Iniciar temporizador</button>`;
        const content = visible.length ? `<div class="time-layout"><section class="time-list">${visible.map(timeEntryCard).join('')}</section><aside class="time-summary panel panel-padded"><span class="eyebrow">Esta semana</span><div class="time-ring" style="--share:${total ? Math.round(billable / total * 100) : 0}%"><strong>${escapeHTML(minutesLabel(total))}</strong><small>registrados</small></div><dl><div><dt>Facturable</dt><dd>${escapeHTML(minutesLabel(billable))}</dd></div><div><dt>Hoy</dt><dd>${escapeHTML(minutesLabel(today.reduce((sum,item) => sum + elapsedMinutes(item),0)))}</dd></div><div><dt>Sesiones</dt><dd>${weekly.length}</dd></div></dl></aside></div>`
            : emptyState('time_entry', 'Empieza a medir sin complicarte', 'Usa el temporizador mientras trabajas o registra el tiempo manualmente al terminar.');
        return `${pageHeading('Ritmo de trabajo', 'Tiempo con <em>contexto</em>.', 'Mide el esfuerzo real por proyecto y compáralo con el valor que genera.', 'time_entry', action)}
            <div class="finance-metrics">${metricCard('Esta semana', minutesLabel(total), countLabel(weekly.length,'sesión','sesiones'), 'clock')}${metricCard('Facturable', minutesLabel(billable), total ? `${Math.round(billable/total*100)}% del tiempo` : 'Sin horas todavía', 'wallet')}${metricCard('Hoy', minutesLabel(today.reduce((sum,item) => sum + elapsedMinutes(item),0)), countLabel(today.length,'registro','registros'), 'calendar')}</div>
            ${collectionToolbar('time', visible.length, [['running','En curso'],['billable','Facturable'],['non_billable','No facturable']])}${running ? `<div class="active-timer" role="timer"><span class="timer-pulse"></span><div><small>Temporizador activo</small><strong>${escapeHTML(running.description || running.project_name || 'Trabajo en curso')}</strong></div><output data-running-start="${escapeHTML(running.started_at)}">${escapeHTML(minutesLabel(elapsedMinutes(running)))}</output><button class="button button-danger button-small" type="button" data-timer-stop="${Number(running.id)}">Detener</button></div>` : ''}${content}`;
    }

    function timeEntryCard(item) {
        const running = Boolean(item.is_running) || (item.started_at && !item.ended_at);
        return `<article class="time-entry-card${running ? ' is-running' : ''}" data-record-preview="time_entry" data-id="${Number(item.id)}"><span class="time-date"><strong>${escapeHTML(formatDate(item.work_date, { day:'2-digit' }))}</strong><small>${escapeHTML(formatDate(item.work_date, { month:'short' }))}</small></span><div class="time-entry-copy" role="button" tabindex="0" data-record-preview="time_entry" data-id="${Number(item.id)}"><div><span>${escapeHTML(item.project_name || 'Sin proyecto')}</span>${item.task_title ? `<span>${escapeHTML(item.task_title)}</span>` : ''}${Number(item.billable) ? '<span class="billable-badge">Facturable</span>' : ''}</div><h3>${escapeHTML(item.description || 'Trabajo sin descripción')}</h3><div class="tag-cloud">${asArray(item.tags).slice(0,5).map(tag => `<span>#${escapeHTML(tag)}</span>`).join('')}</div></div><strong class="time-duration"${running ? ` data-running-start="${escapeHTML(item.started_at)}"` : ''}>${escapeHTML(minutesLabel(elapsedMinutes(item)))}</strong><div class="time-entry-actions">${running ? `<button class="button button-danger button-small" type="button" data-timer-stop="${Number(item.id)}">Detener</button>` : ''}<button class="icon-button" type="button" data-edit="time_entry" data-id="${Number(item.id)}" aria-label="Editar registro">${icon('more')}</button></div></article>`;
    }

    function profitabilityRows(data) {
        return Array.isArray(data) ? data : (Array.isArray(data?.projects) ? data.projects : []);
    }
    function profitabilityBuckets(project) {
        if (Array.isArray(project.currencies)) return project.currencies;
        if (Array.isArray(project.buckets)) return project.buckets;
        if (project.currencies && typeof project.currencies === 'object') return Object.entries(project.currencies).map(([currency,values]) => ({ currency, ...values }));
        if (Array.isArray(project.income) || Array.isArray(project.labor_costs) || Array.isArray(project.resource_costs)) {
            const currencies = new Set([...project.income||[],...project.labor_costs||[],...project.resource_costs||[]].map(row=>row.currency).filter(Boolean));
            return [...currencies].map(currency => {
                const income=(project.income||[]).filter(row=>row.currency===currency).reduce((sum,row)=>sum+Number(row.amount||0),0);
                const laborRows=(project.labor_costs||[]).filter(row=>row.currency===currency);
                const labor=laborRows.reduce((sum,row)=>sum+Number(row.amount||0),0);
                const minutes=laborRows.reduce((sum,row)=>sum+Number(row.minutes||0),0);
                const resources=(project.resource_costs||[]).filter(row=>row.currency===currency);
                const recurring=resources.reduce((sum,row)=>sum+Number(row.monthly_equivalent||0),0);
                const oneTime=resources.reduce((sum,row)=>sum+Number(row.one_time||0),0);
                return {currency,revenue:income,labor_cost:labor,infrastructure_cost:recurring,one_time_resource_cost:oneTime,profit:income-labor-recurring,profit_after_one_time:income-labor-recurring-oneTime,is_estimate:true,uncosted_minutes:minutes>0&&labor===0?minutes:0,mixed_in_project:Boolean(project.mixed_currencies)};
            });
        }
        return [project];
    }
    function bucketValue(bucket, names) {
        const name = names.find(key => bucket[key] !== undefined); return Number(name ? bucket[name] : 0) || 0;
    }
    function profitabilityWidget(data) {
        const buckets = profitabilityRows(data).flatMap(project => profitabilityBuckets(project));
        if (!buckets.length) return '<div class="inline-empty">Faltan datos para calcularla.</div>';
        const byCurrency = {};
        buckets.forEach(bucket => {
            const currency = bucket.currency || bucket.cost_currency || state.settings?.default_currency || 'ARS';
            byCurrency[currency] ||= { revenue:0, costs:0 };
            byCurrency[currency].revenue += bucketValue(bucket,['paid_amount','revenue','income']);
            byCurrency[currency].costs += (bucketValue(bucket,['total_cost','costs']) || bucketValue(bucket,['labor_cost','time_cost']) + bucketValue(bucket,['resource_cost','infrastructure_cost'])) + bucketValue(bucket,['one_time_resource_cost','one_time_cost']);
        });
        return `<div class="widget-profit-list">${Object.entries(byCurrency).map(([currency,row]) => `<div><span>${escapeHTML(currency)}</span><strong class="${row.revenue-row.costs < 0 ? 'negative' : ''}">${moneyHTML(row.revenue-row.costs,currency)}</strong></div>`).join('')}</div>`;
    }

    function renderProfitability(data = []) {
        const projects = profitabilityRows(data);
        const cards = projects.flatMap(project => profitabilityBuckets(project).map(bucket => profitabilityCard(project,bucket)));
        const period = data && !Array.isArray(data) ? data.period : null;
        const periodLabel = period?.from && period?.to ? `${shortRange(period.from, period.to)}${period.timezone ? ` · ${period.timezone}` : ''}` : 'Mes civil actual';
        return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">Salud económica · ${escapeHTML(periodLabel)}</span><h1>Rentabilidad con <em>los pies en la tierra</em>.</h1><p>Ingresos cobrados menos tiempo e infraestructura. Cada moneda se mantiene separada para evitar totales engañosos.</p></div><button class="button button-ghost" type="button" data-nav-button="settings">Configurar costo por hora</button></header>
            <aside class="calculation-note" role="note">${icon('alert')}<p><strong>Una estimación para ${escapeHTML(periodLabel)}, no contabilidad.</strong> El costo de tiempo usa el valor guardado en cada registro; los recursos recurrentes se prorratean dentro de ese período y los costos únicos se incluyen si fueron creados durante el mes. Si faltan costos, la tarjeta lo indica.</p></aside>
            ${cards.length ? `<div class="profitability-grid">${cards.join('')}</div>` : '<div class="empty-state"><div class="empty-inner"><div class="empty-art"><span>$</span></div><h2>Todavía no hay una rentabilidad calculable</h2><p>Vincula presupuestos, cobros, tiempo y costos de infraestructura a un proyecto comercial.</p><button class="button button-primary" type="button" data-nav-button="time">Registrar tiempo</button></div></div>'}`;
    }

    function profitabilityCard(project,bucket) {
        const currency = bucket.currency || bucket.cost_currency || state.settings?.default_currency || 'ARS';
        const revenue = bucketValue(bucket,['paid_amount','revenue','income']);
        const labor = bucketValue(bucket,['labor_cost','time_cost']);
        const infrastructure = bucketValue(bucket,['resource_cost','infrastructure_cost']);
        const oneTime = bucketValue(bucket,['one_time_resource_cost','one_time_cost']);
        const costs = bucketValue(bucket,['total_cost','costs']) || labor + infrastructure;
        const profit = bucket.profit_after_one_time !== undefined ? Number(bucket.profit_after_one_time) : bucket.estimated_net_after_one_time !== undefined ? Number(bucket.estimated_net_after_one_time) : bucket.profit !== undefined ? Number(bucket.profit)-oneTime : revenue - costs - oneTime;
        const margin = revenue ? Math.round(profit/revenue*100) : 0;
        const incomplete = Boolean(bucket.incomplete || bucket.uncosted_minutes || bucket.missing_costs);
        return `<article class="profit-card${profit < 0 ? ' is-negative' : ''}"><header><div><span class="eyebrow">${escapeHTML(currency)}</span><h2>${escapeHTML(project.project_name || project.name || bucket.project_name || 'Proyecto')}</h2></div><span class="profit-margin">${margin}%</span></header><strong class="profit-value">${moneyHTML(profit,currency)}</strong><span class="profit-label">resultado estimado después de costos únicos</span><dl><div><dt>Cobrado</dt><dd>${moneyHTML(revenue,currency)}</dd></div><div><dt>Tiempo</dt><dd>− ${moneyHTML(labor,currency)}</dd></div><div><dt>Infraestructura mensual</dt><dd>− ${moneyHTML(infrastructure,currency)}</dd></div>${oneTime?`<div><dt>Costos únicos</dt><dd>− ${moneyHTML(oneTime,currency)}</dd></div>`:''}</dl>${incomplete ? '<p class="incomplete-note">◌ Faltan costos en algunos registros; el resultado es parcial.</p>' : '<p class="complete-note">✓ Todos los costos vinculados tienen valor.</p>'}</article>`;
    }

    function renderCalendar(data = []) {
        const events = Array.isArray(data) ? data : (Array.isArray(data?.events) ? data.events : []);
        const seen = new Set();
        state.calendarEvents = events.filter(event => { const key = event.key || `${event.source_type}:${event.source_id}`; if (seen.has(key)) return false; seen.add(key); return true; });
        const month = state.calendarMonth;
        const year = month.getFullYear(); const monthIndex = month.getMonth();
        const monday = state.settings?.week_start !== 'sunday';
        const labels = monday ? ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'] : ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
        const first = new Date(year,monthIndex,1,12); const offset = monday ? (first.getDay()+6)%7 : first.getDay();
        const gridStart = new Date(first); gridStart.setDate(gridStart.getDate()-offset);
        const cells = Array.from({length:42},(_,index) => { const date = new Date(gridStart); date.setDate(date.getDate()+index); return date; });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(state.calendarDay)) state.calendarDay = dateISO(first);
        const monthLabel = new Intl.DateTimeFormat('es-AR',{month:'long',year:'numeric',timeZone:state.settings?.timezone || undefined}).format(first);
        const selectedEvents = state.calendarEvents.filter(event => event.date === state.calendarDay);
        return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">Todas tus fechas</span><h1>Un calendario para <em>anticiparte</em>.</h1><p>Tareas, seguimientos, presupuestos, recordatorios, entregas y renovaciones reunidos sin duplicados.</p></div><button class="button button-primary" type="button" data-create="reminder">${icon('plus')}Nuevo recordatorio</button></header>
            <div class="calendar-toolbar"><button class="icon-button" type="button" data-calendar-move="-1" aria-label="Mes anterior">${icon('chevronLeft')}</button><h2>${escapeHTML(monthLabel.charAt(0).toUpperCase()+monthLabel.slice(1))}</h2><button class="icon-button" type="button" data-calendar-move="1" aria-label="Mes siguiente">${icon('chevron')}</button><button class="button button-ghost button-small" type="button" data-calendar-today>Hoy</button></div>
            <div class="calendar-layout"><section class="calendar-board" aria-label="Calendario de ${escapeHTML(monthLabel)}"><div class="calendar-weekdays">${labels.map(label => `<span>${label}</span>`).join('')}</div><div class="calendar-grid">${cells.map(date => calendarCell(date,monthIndex)).join('')}</div></section>
            <aside class="calendar-day-list panel panel-padded"><span class="eyebrow">${escapeHTML((d => d.charAt(0).toUpperCase() + d.slice(1))(formatDate(state.calendarDay,{weekday:'long',day:'numeric',month:'long'})))}</span><h2>Agenda del día</h2><div>${selectedEvents.length ? selectedEvents.map(calendarEventRow).join('') : '<div class="inline-empty">No hay eventos para este día.</div>'}</div></aside></div>
            <section class="calendar-agenda-mobile"><h2>Lista del mes</h2>${state.calendarEvents.some(event=>String(event.date).startsWith(`${year}-${String(monthIndex+1).padStart(2,'0')}`)) ? state.calendarEvents.filter(event=>String(event.date).startsWith(`${year}-${String(monthIndex+1).padStart(2,'0')}`)).sort((a,b) => String(a.date).localeCompare(String(b.date))).map(calendarEventRow).join('') : '<div class="inline-empty">No hay eventos este mes.</div>'}</section>`;
    }

    function calendarCell(date,monthIndex) {
        const iso = dateISO(date); const events = (state.calendarEvents || []).filter(event => event.date === iso);
        const selected = iso === state.calendarDay; const outside = date.getMonth() !== monthIndex; const today = iso === todayISO();
        return `<button class="calendar-cell${selected ? ' is-selected' : ''}${outside ? ' is-outside' : ''}${today ? ' is-today' : ''}" type="button" data-calendar-day="${iso}" aria-pressed="${selected}" aria-label="${escapeHTML(formatDate(iso,{day:'numeric',month:'long'}))}, ${events.length} eventos"><span>${date.getDate()}</span><div>${events.slice(0,3).map(event => `<i class="event-${escapeHTML(event.source_type || 'reminder')}" title="${escapeHTML(event.title)}"></i>`).join('')}</div>${events.length > 3 ? `<small>+${events.length-3}</small>` : ''}</button>`;
    }
    function calendarEventRow(event) {
        const source = event.source_type || 'reminder';
        return `<button class="calendar-event-row" type="button" data-source-open="${escapeHTML(source)}" data-id="${Number(event.source_id)}"><i class="event-${escapeHTML(source)}"></i><span><strong>${escapeHTML(event.title)}</strong><small>${escapeHTML(sourceLabel(source))}${event.project_name ? ` · ${escapeHTML(event.project_name)}` : ''}</small></span><time>${escapeHTML(shortDate(event.date))}</time></button>`;
    }

    function renderWeeklyReviews(data = {}) {
        const reviews = data.reviews || [];
        const summary = data.summary || null;
        const localBounds = weekBounds(new Date());
        const bounds = { start: summary?.period?.from || localBounds.start, end: summary?.period?.to || localBounds.end };
        const done = (data.tasks || []).filter(item => { const completed=item.completed_at ? zonedCivil(item.completed_at) : item.updated_at ? zonedCivil(item.updated_at) : (/^\d{4}-\d{2}-\d{2}$/.test(String(item.due_date||'')) ? item.due_date : ''); return item.status==='done'&&completed>=bounds.start&&completed<=bounds.end; });
        const entries = (data.timeEntries || []).filter(item => item.work_date >= bounds.start && item.work_date <= bounds.end);
        const payments = (data.payments || []).filter(item => item.paid_at >= bounds.start && item.paid_at <= bounds.end);
        const logs = (data.devlogs || []).filter(item => item.entry_date >= bounds.start && item.entry_date <= bounds.end);
        const releases = (data.releases || []).filter(item => item.release_date >= bounds.start && item.release_date <= bounds.end);
        const budgets = data.budgets || [];
        const paidByCurrency = summary ? (summary.payments || []).map(row => `${row.currency} ${formatMoney(row.amount,row.currency)}`) : ['ARS','USD','EUR'].filter(currency => payments.some(payment => (budgets.find(b => Number(b.id) === Number(payment.budget_id))?.currency || 'ARS') === currency)).map(currency => {
            const total = payments.filter(payment => (budgets.find(b => Number(b.id) === Number(payment.budget_id))?.currency || 'ARS') === currency).reduce((sum,item) => sum + Number(item.amount || 0),0);
            return `${currency} ${formatMoney(total,currency)}`;
        });
        const tasksCompleted = summary ? Number(summary.tasks_completed||0) : done.length;
        const timeMinutes = summary ? Number(summary.time?.minutes||0) : entries.reduce((sum,item)=>sum+elapsedMinutes(item),0);
        const timeEntriesCount = summary ? Number(summary.time?.entries||0) : entries.length;
        const billableMinutes = summary ? Number(summary.time?.billable_minutes||0) : entries.filter(item=>Number(item.billable)).reduce((sum,item)=>sum+elapsedMinutes(item),0);
        const devlogsCount = summary ? Number(summary.devlogs_count||0) : logs.length;
        const releasesCount = summary ? Number(summary.releases_count||0) : releases.length;
        const current = reviews.find(item => item.week_start === bounds.start);
        const zone = summary?.period?.timezone ? ` · ${summary.period.timezone}` : '';
        return `${pageHeading('Cierre y aprendizaje', 'Tu semana, <em>en perspectiva</em>.', `${escapeHTML(shortRange(bounds.start, bounds.end))}${escapeHTML(zone)}. Datos reales para decidir mejor la próxima.`, 'weekly_review', current ? `<button class="button button-ghost" type="button" data-edit="weekly_review" data-id="${Number(current.id)}">Editar esta semana</button>` : '')}
            <div class="weekly-metrics">${metricCard('Tareas terminadas',tasksCompleted,'En esta semana','check')}${metricCard('Tiempo registrado',minutesLabel(timeMinutes),`${timeEntriesCount} sesiones · ${minutesLabel(billableMinutes)} facturables`,'clock')}${metricCard('Bitácora',devlogsCount,`${releasesCount} entregas o versiones`,'journal')}<article class="metric-card"><div class="metric-top"><span>Cobros</span><span class="metric-icon">${icon('wallet')}</span></div><div class="weekly-money">${paidByCurrency.length ? paidByCurrency.map(value => `<strong>${escapeHTML(value)}</strong>`).join('') : '<strong>Sin cobros</strong>'}</div><div class="metric-caption">Siempre separados por moneda</div></article></div>
            <div class="weekly-layout"><section class="weekly-prompt panel panel-padded"><span class="eyebrow">Ritual de 10 minutos</span><h2>${current ? 'Esta semana ya tiene una mirada.' : 'Cierra la semana antes de empezar otra.'}</h2><p>Rescata lo que salió bien, nombra los bloqueos y elige un foco concreto.</p><button class="button button-primary" type="button" ${current ? `data-record-preview="weekly_review" data-id="${Number(current.id)}"` : 'data-create="weekly_review"'}>${current ? 'Ver revisión' : 'Hacer mi revisión'}</button></section><section class="review-history"><h2>Historial</h2>${reviews.length ? reviews.map(reviewCard).join('') : '<div class="inline-empty">Tus cierres semanales aparecerán aquí.</div>'}</section></div>`;
    }
    function reviewCard(review) {
        return `<article class="review-card" data-record-preview="weekly_review" data-id="${Number(review.id)}"><header><div role="button" tabindex="0" data-record-preview="weekly_review" data-id="${Number(review.id)}"><small>Semana del</small><h3>${escapeHTML(formatDate(review.week_start,{day:'numeric',month:'long',year:'numeric'}))}</h3></div><span class="review-score" aria-label="Valoración ${clamp(review.rating,1,5)} de 5">${'★'.repeat(clamp(review.rating,1,5))}${'☆'.repeat(5-clamp(review.rating,1,5))}</span><button class="icon-button" type="button" data-edit="weekly_review" data-id="${Number(review.id)}" aria-label="Editar revisión">${icon('more')}</button></header><div class="review-columns"><div><strong>Lo mejor</strong><p>${escapeHTML(review.wins || 'Sin notas.')}</p></div><div><strong>Bloqueos</strong><p>${escapeHTML(review.blockers || 'Ninguno registrado.')}</p></div><div><strong>Próximo foco</strong><p>${escapeHTML(review.next_focus || 'Sin definir.')}</p></div></div><div class="tag-cloud">${asArray(review.tags).map(tag => `<span>#${escapeHTML(tag)}</span>`).join('')}</div></article>`;
    }

    function renderFiles(items = []) {
        const projects = state.cache.get('projects')?.data || [];
        const query = state.filters.files.search.trim().toLocaleLowerCase('es');
        const projectFilter = state.filters.files.project;
        const visible = items.filter(item => (!query || [item.original_name,item.mime_type,item.entity_name,item.project_name,attachmentContext(item)].some(value => String(value || '').toLocaleLowerCase('es').includes(query))) && (projectFilter === 'all' || String(attachmentProjectId(item)||'') === projectFilter) && (state.filters.files.status==='all'||item.entity_type===state.filters.files.status));
        const used = items.reduce((sum,item) => sum + Number(item.size_bytes || 0),0);
        return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">Biblioteca de trabajo</span><h1>Archivos con <em>un lugar propio</em>.</h1><p>Propuestas, contratos, capturas y documentación vinculados al contexto donde realmente sirven.</p></div></header>
            <form class="upload-panel" id="attachment-form" enctype="multipart/form-data"><div class="upload-art">${icon('package')}</div><div class="upload-copy"><h2>Subir un archivo</h2><p>Hasta 10 MiB por archivo y 100 MiB totales como máximo; el servidor puede aplicar límites menores. Admite PDF, imágenes, texto, documentos y ZIP seguros.</p><label class="file-picker"><input type="file" name="file" required><span>Elegir archivo</span><small data-file-name>Ningún archivo elegido</small></label></div><div class="upload-fields"><label><span>Vincular a</span><select name="attachment_target"><option value="general:">Documentación general</option>${attachmentTargets()}</select></label><button class="button button-primary" type="submit">Subir archivo</button><p class="upload-feedback" data-upload-feedback role="status" aria-live="polite"></p></div></form>
            <div class="file-stats"><span>${items.length} ${items.length===1?'archivo':'archivos'}</span><span>${escapeHTML(bytesLabel(used))} utilizados</span></div>
            <div class="toolbar"><label class="filter-search">${icon('search')}<span class="sr-only">Buscar archivos</span><input type="search" value="${escapeHTML(state.filters.files.search)}" placeholder="Buscar por nombre o tipo…" data-file-search></label><label class="select-wrap"><span class="sr-only">Filtrar por entidad</span><select data-file-entity><option value="all">Todas las vinculaciones</option>${optionList([['general','General'],['projects','Proyectos'],['tasks','Tareas'],['clients','Clientes'],['leads','Oportunidades'],['ideas','Ideas'],['devlogs','Bitácora'],['budgets','Presupuestos'],['payments','Cobros'],['releases','Entregas'],['resources','Recursos'],['reminders','Recordatorios'],['time_entries','Tiempo'],['weekly_reviews','Revisiones']],state.filters.files.status)}</select></label><label class="select-wrap"><span class="sr-only">Filtrar por proyecto</span><select data-file-project><option value="all">Todos los proyectos</option>${optionList(projects.map(project => [project.id,project.name]),projectFilter)}</select></label><span class="result-count">${visible.length} resultados</span></div>
            ${visible.length ? `<div class="file-grid">${visible.map(fileCard).join('')}</div>` : (items.length ? noFilterResults('files') : '<div class="empty-state"><div class="empty-inner"><div class="empty-art"><span>↑</span></div><h2>Tu biblioteca está vacía</h2><p>Sube el primer documento y vincúlalo a su proyecto.</p><button class="button button-primary" type="button" data-focus-upload>Elegir archivo</button></div></div>')}`;
    }
    function attachmentTargets() {
        const definitions = [['projects','Proyecto'],['tasks','Tarea'],['clients','Cliente'],['leads','Oportunidad'],['ideas','Idea'],['devlogs','Bitácora'],['budgets','Presupuesto'],['payments','Cobro'],['releases','Entrega'],['resources','Recurso'],['reminders','Recordatorio'],['time_entries','Tiempo'],['weekly_reviews','Revisión']];
        return definitions.map(([route,label]) => (state.cache.get(route)?.data || []).map(item => `<option value="${route}:${Number(item.id)}">${label} · ${escapeHTML(attachmentTargetName(route,item))}</option>`).join('')).join('');
    }
    function attachmentTargetName(route,item) {
        if(route==='payments')return `${formatMoney(item.amount)} · ${item.budget_title||'Cobro'}`;
        if(route==='time_entries')return `${item.description||'Registro'} · ${formatDate(item.work_date)}`;
        if(route==='weekly_reviews')return `Semana del ${formatDate(item.week_start)}`;
        return item.name||item.title||item.description||`#${item.id}`;
    }
    function attachmentProjectId(item) {
        if(item.project_id)return Number(item.project_id); if(item.entity_type==='projects')return Number(item.entity_id);
        if(item.entity_type==='budgets')return Number((state.cache.get('budgets')?.data||[]).find(row=>Number(row.id)===Number(item.entity_id))?.project_id||0);
        if(item.entity_type==='resources')return Number((state.cache.get('resources')?.data||[]).find(row=>Number(row.id)===Number(item.entity_id))?.project_id||0);
        if(['tasks','devlogs','releases','reminders','time_entries'].includes(item.entity_type))return Number((state.cache.get(item.entity_type)?.data||[]).find(row=>Number(row.id)===Number(item.entity_id))?.project_id||0);
        if(item.entity_type==='payments'){const payment=(state.cache.get('payments')?.data||[]).find(row=>Number(row.id)===Number(item.entity_id));return Number((state.cache.get('budgets')?.data||[]).find(row=>Number(row.id)===Number(payment?.budget_id))?.project_id||0);}
        return 0;
    }
    function attachmentContext(item) {
        const map={projects:'name',tasks:'title',clients:'name',leads:'name',ideas:'title',devlogs:'title',budgets:'title',payments:'reference',releases:'title',resources:'name',reminders:'title',time_entries:'description',weekly_reviews:'week_start'}; const field=map[item.entity_type];
        if(!field)return sourceLabel(item.entity_type); const row=(state.cache.get(item.entity_type)?.data||[]).find(record=>Number(record.id)===Number(item.entity_id)); return row?.[field]||sourceLabel(item.entity_type);
    }
    function bytesLabel(value) {
        const bytes = Number(value)||0; if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1048576).toFixed(1)} MB`;
    }
    function attachmentHref(item) {
        const raw = item.download_url || `${API_BASE}/attachments/${Number(item.id)}/download`;
        try { const url = new URL(raw, location.href); return url.origin === location.origin ? url.href : '#'; } catch { return '#'; }
    }
    function fileCard(item) {
        const ext = String(item.original_name || '').split('.').pop().slice(0,5).toUpperCase();
        return `<article class="file-card" data-record-preview="attachment" data-id="${Number(item.id)}"><span class="file-type">${escapeHTML(ext || 'DOC')}</span><div class="file-copy" role="button" tabindex="0" data-record-preview="attachment" data-id="${Number(item.id)}"><h2 title="${escapeHTML(item.original_name)}">${escapeHTML(item.original_name || 'Archivo')}</h2><p>${escapeHTML(item.project_name || item.entity_name || attachmentContext(item))}</p><small>${escapeHTML(bytesLabel(item.size_bytes))} · ${escapeHTML(formatDate(item.created_at))}</small></div><div class="file-actions"><a class="icon-button" href="${escapeHTML(attachmentHref(item))}" aria-label="Descargar ${escapeHTML(item.original_name)}">${icon('arrow')}</a><button class="icon-button danger-icon" type="button" data-attachment-delete="${Number(item.id)}" aria-label="Eliminar ${escapeHTML(item.original_name)}">×</button></div></article>`;
    }

    function renderTags(items = []) {
        const visible = filtered(items,'tags');
        const totalUses = items.reduce((sum,item)=>sum+Number(item.usage_count||0),0);
        return `${pageHeading('Lenguaje compartido', 'Etiquetas para <em>conectar el contexto</em>.', `${items.length} etiquetas y ${totalUses} usos en tu espacio. Las sugerencias aparecen al editar registros.`, 'tag')}${collectionToolbar('tags',visible.length)}
            ${visible.length ? `<div class="tag-catalog">${visible.map(tag => `<article class="tag-card" style="--tag-color:${safeColor(tag.color,'#748c76')}" data-record-preview="tag" data-id="${Number(tag.id)}"><span class="catalog-tag" role="button" tabindex="0" data-record-preview="tag" data-id="${Number(tag.id)}">#${escapeHTML(tag.name)}</span><strong>${Number(tag.usage_count||0)} usos</strong><div><button class="text-button" type="button" data-edit="tag" data-id="${Number(tag.id)}">Editar</button><button class="text-button danger-text" type="button" data-delete="tag" data-id="${Number(tag.id)}">Eliminar</button></div></article>`).join('')}</div>` : emptyState('tag','Crea tu vocabulario','Usa etiquetas breves para cruzar proyectos, tareas, clientes y notas sin crear carpetas de más.')}`;
    }

    function renderDashboardSettings(settings = {}) {
        const selected = sanitizeWidgetOrder(settings.dashboard_widgets);
        const disabled = Object.keys(WIDGETS).filter(key => !selected.includes(key));
        const ordered = [...selected,...disabled];
        return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">Un dashboard a tu medida</span><h1>Tu dashboard, <em>en tu orden</em>.</h1><p>Elige qué bloques aparecen y muévelos según tu forma de trabajar.</p></div><button class="button button-ghost" type="button" data-dashboard-reset>Restaurar diseño</button></header>
            <form class="widget-settings panel panel-padded" id="dashboard-settings-form"><header><div><h2>Bloques del dashboard</h2><p>El orden de esta lista es el que verás al entrar.</p></div><span>${selected.length} visibles</span></header><ol>${ordered.map((key,index) => `<li data-widget-key="${key}" class="${selected.includes(key)?'':'is-disabled'}"><span class="widget-handle" aria-hidden="true">☰</span><label><input type="checkbox" name="dashboard_widgets" value="${key}"${selected.includes(key)?' checked':''}><span><strong>${escapeHTML(WIDGETS[key])}</strong><small>${selected.includes(key)?'Visible en el dashboard':'Oculto'}</small></span></label><div><button class="icon-button" type="button" data-widget-move="-1" aria-label="Subir ${escapeHTML(WIDGETS[key])}"${index===0?' disabled':''}>↑</button><button class="icon-button" type="button" data-widget-move="1" aria-label="Bajar ${escapeHTML(WIDGETS[key])}"${index===ordered.length-1?' disabled':''}>↓</button></div></li>`).join('')}</ol><footer><button class="button button-primary" type="submit">Guardar dashboard</button><p role="status" aria-live="polite" data-settings-feedback></p></footer></form>`;
    }

    function renderSettings(settings = {}) {
        const reminderDays = Array.isArray(settings.reminder_days) ? settings.reminder_days.map(Number) : [Number(settings.reminder_days ?? 7)];
        return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">Preferencias personales</span><h1>CodePanel habla <em>tu idioma</em>.</h1><p>Ajusta cómo se muestran fechas, dinero, semanas, recordatorios y apariencia.</p></div></header>
            <form class="settings-form" id="settings-form"><section class="settings-section panel panel-padded"><header><span>${icon('wallet')}</span><div><h2>Trabajo y dinero</h2><p>Valores predeterminados para nuevos registros y cálculos.</p></div></header><div class="settings-grid">${selectField('default_currency','Moneda predeterminada',settings.default_currency||'ARS',[['ARS','ARS — Peso argentino'],['USD','USD — Dólar'],['EUR','EUR — Euro']],{blank:false})}${textField('default_hourly_cost','Costo por hora',settings.default_hourly_cost??0,{type:'number',min:0,step:.01,hint:'para estimar rentabilidad'})}</div></section>
            <section class="settings-section panel panel-padded"><header><span>${icon('calendar')}</span><div><h2>Fechas y agenda</h2><p>Las fechas civiles no cambian de día; las horas se convierten a tu zona.</p></div></header><div class="settings-grid">${selectField('date_format','Formato de fecha',settings.date_format||'d/m/Y',[['d/m/Y','DD/MM/AAAA'],['m/d/Y','MM/DD/AAAA'],['Y-m-d','AAAA-MM-DD']],{blank:false})}${textField('timezone','Zona horaria',settings.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,{placeholder:'America/Argentina/Buenos_Aires',required:true})}${selectField('week_start','La semana empieza',settings.week_start||'monday',[['monday','Lunes'],['sunday','Domingo']],{blank:false})}</div><fieldset class="reminder-days"><legend>Avisarme con anticipación</legend>${[1,3,7,14,30].map(day=>`<label><input type="checkbox" name="reminder_days" value="${day}"${reminderDays.includes(day)?' checked':''}><span>${day} ${day===1?'día':'días'}</span></label>`).join('')}</fieldset></section>
            <section class="settings-section panel panel-padded"><header><span>${icon('sun')}</span><div><h2>Apariencia</h2><p>Elige un tema fijo o sigue la preferencia del dispositivo.</p></div></header><div class="theme-options">${[['system','Sistema'],['light','Claro'],['night','Noche']].map(([value,label])=>`<label><input type="radio" name="theme" value="${value}"${(settings.theme||'system')===value?' checked':''}><span><i class="theme-preview is-${value}"></i><strong>${label}</strong></span></label>`).join('')}</div></section><footer class="settings-footer"><button class="button button-primary" type="submit">Guardar configuración</button><p role="status" aria-live="polite" data-settings-feedback></p></footer></form>
            <section class="settings-section panel panel-padded settings-export" aria-labelledby="export-title"><header><span>${icon('receipt')}</span><div><h2 id="export-title">Exportar datos</h2><p>Archivos generados con los datos de tu cuenta. No se modifica nada.</p></div></header>
                <div class="export-grid">
                    <button class="export-option" type="button" data-export="time">${icon('clock')}<span><strong>Tiempo</strong><small>CSV para tu hoja de cálculo o para facturar</small></span></button>
                    <button class="export-option" type="button" data-export="payments">${icon('wallet')}<span><strong>Cobros</strong><small>CSV con importes, medios y referencias</small></span></button>
                    <button class="export-option" type="button" data-export="calendar">${icon('calendar')}<span><strong>Calendario</strong><small>Archivo .ics para Google, Apple u Outlook</small></span></button>
                    <button class="export-option" type="button" data-export="backup">${icon('package')}<span><strong>Copia completa</strong><small>JSON con todos tus registros</small></span></button>
                </div>
            </section>
            ${apiTokensSection()}`;
    }

    function noFilterResults(route) {
        return `<div class="empty-state"><div class="empty-inner"><div class="empty-art"><span>⌕</span></div><h2>No encontramos coincidencias</h2><p>Prueba con otra palabra o quita alguno de los filtros.</p><button class="button button-ghost" type="button" data-clear-filters="${route}">Limpiar filtros</button></div></div>`;
    }

    function optionList(options, selected) {
        return options.map(([value,label]) => `<option value="${escapeHTML(value)}"${String(selected ?? '') === String(value) ? ' selected' : ''}>${escapeHTML(label)}</option>`).join('');
    }
    function textField(name, label, value = '', { type = 'text', placeholder = '', required = false, wide = false, hint = '', min = '', max = '', step = '' } = {}) {
        return `<div class="form-field${wide ? ' is-wide' : ''}"><label for="field-${name}">${escapeHTML(label)}${hint ? ` <span>${escapeHTML(hint)}</span>` : ''}</label><input id="field-${name}" name="${name}" type="${type}" value="${escapeHTML(value ?? '')}" placeholder="${escapeHTML(placeholder)}"${required ? ' required' : ''}${min !== '' ? ` min="${escapeHTML(min)}"` : ''}${max !== '' ? ` max="${escapeHTML(max)}"` : ''}${step !== '' ? ` step="${escapeHTML(step)}"` : ''}></div>`;
    }
    function textareaField(name, label, value = '', placeholder = '', { required = false, hint = 'admite Markdown' } = {}) {
        return `<div class="form-field is-wide"><label for="field-${name}">${escapeHTML(label)}${hint ? ` <span>${escapeHTML(hint)}</span>` : ''}</label><textarea id="field-${name}" name="${name}" placeholder="${escapeHTML(placeholder)}"${required ? ' required' : ''}>${escapeHTML(value ?? '')}</textarea></div>`;
    }
    function selectField(name, label, selected, options, { wide = false, blank = '', required = false } = {}) {
        return `<div class="form-field${wide ? ' is-wide' : ''}"><label for="field-${name}">${escapeHTML(label)}</label><select id="field-${name}" name="${name}"${required ? ' required' : ''}>${blank !== false ? `<option value="">${escapeHTML(blank || 'Sin asignar')}</option>` : ''}${optionList(options, selected)}</select></div>`;
    }
    function rangeField(name, label, value, min = 0, max = 100) {
        return `<div class="form-field range-field"><label for="field-${name}">${escapeHTML(label)}</label><div class="range-row"><input id="field-${name}" name="${name}" type="range" min="${min}" max="${max}" value="${clamp(value ?? min,min,max)}" data-range><output>${clamp(value ?? min,min,max)}</output></div></div>`;
    }
    function tagsField(value, catalog = [], { label = 'Etiquetas', placeholder = 'backend, urgente, aprendizaje' } = {}) {
        return `<div class="form-field is-wide"><label for="field-tags">${escapeHTML(label)} <span>hasta 30, separadas por comas</span></label><input id="field-tags" name="tags" type="text" value="${escapeHTML(asArray(value).join(', '))}" placeholder="${escapeHTML(placeholder)}" list="tag-suggestions" autocomplete="off"><datalist id="tag-suggestions">${catalog.slice(0,100).map(tag => `<option value="${escapeHTML(tag.name)}"></option>`).join('')}</datalist><div class="tag-suggestions" aria-label="Etiquetas sugeridas">${catalog.slice(0,8).map(tag => `<button type="button" data-tag-suggest="${escapeHTML(tag.name)}">#${escapeHTML(tag.name)}</button>`).join('')}</div></div>`;
    }
    function utcToDateTimeLocal(value) {
        const date = parseDate(value); if (!date || Number.isNaN(date.getTime())) return '';
        const zone = state.settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
        return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    }
    function zonedInputToISO(value) {
        if (!value) return null;
        const zone = state.settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const [datePart,timePart='00:00'] = String(value).split('T'); const [year,month,day] = datePart.split('-').map(Number); const [hour,minute] = timePart.split(':').map(Number);
        let instant = new Date(Date.UTC(year,month-1,day,hour,minute));
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
        const represented = Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);
        instant = new Date(instant.getTime() + (Date.UTC(year,month-1,day,hour,minute)-represented));
        return instant.toISOString().slice(0,19).replace('T',' ');
    }

    async function formFields(entity, item = {}) {
        const tagCatalog = await getCollection('tags').catch(() => []);
        if (entity === 'snippet') {
            const projects = await getCollection('projects').catch(() => []);
            return snippetFields(item, projects.filter(project => project.status !== 'archived' || Number(project.id) === Number(item.project_id)), tagCatalog);
        }
        if (entity === 'project') {
            const clients = await getCollection('clients').catch(() => []);
            const type = projectType(item);
            const isCommercial = type === 'commercial';
            return `<div class="form-grid">
                ${textField('name','Nombre del proyecto',item.name,{placeholder:'Ej. Portfolio de Marea',required:true,wide:true})}
                <fieldset class="form-field is-wide project-type-field">
                    <legend>Tipo de proyecto</legend>
                    <div class="project-type-options">
                        <label class="project-type-option">
                            <input id="project-type-personal" type="radio" name="project_type" value="personal" aria-controls="project-commercial-fields" aria-describedby="project-type-note"${type === 'personal' ? ' checked' : ''}>
                            <span class="project-type-icon">${icon('user')}</span>
                            <span class="project-type-copy"><strong>Personal</strong><small>Una idea propia, sin cliente ni fecha de entrega.</small></span>
                        </label>
                        <label class="project-type-option">
                            <input id="project-type-commercial" type="radio" name="project_type" value="commercial" aria-controls="project-commercial-fields" aria-describedby="project-type-note"${isCommercial ? ' checked' : ''}>
                            <span class="project-type-icon">${icon('target')}</span>
                            <span class="project-type-copy"><strong>Comercial</strong><small>Trabajo para vender, cotizar o entregar a un cliente.</small></span>
                        </label>
                    </div>
                    <small class="project-type-note" id="project-type-note">${isCommercial ? 'Cliente y fecha son opcionales: complétalos cuando tenga sentido.' : 'Al guardar como personal se quitarán el cliente y la fecha objetivo.'}</small>
                </fieldset>
                ${textareaField('description','Descripción',item.description,'¿Qué estás construyendo y qué quieres conseguir?')}
                ${selectField('status','Estado',item.status || 'planned',[['planned','Por empezar'],['active','En marcha'],['on_hold','En pausa'],['completed','Terminado'],['archived','Archivado']],{blank:false})}
                ${selectField('priority','Prioridad',item.priority || 'medium',[['low','Baja'],['medium','Media'],['high','Alta'],['urgent','Urgente']],{blank:false})}
                ${rangeField('progress','Progreso',item.progress ?? 0)}
                <div class="project-commercial-fields is-wide" id="project-commercial-fields" data-commercial-fields${isCommercial ? '' : ' hidden'}>
                    <div class="project-commercial-heading"><strong>Datos comerciales</strong><small>Son opcionales; complétalos cuando el acuerdo esté definido.</small></div>
                    <div class="form-field"><label for="field-due_date">Fecha objetivo</label><input id="field-due_date" name="due_date" type="date" value="${escapeHTML(item.due_date ?? '')}"${isCommercial ? '' : ' disabled'}></div>
                    <div class="form-field"><label for="field-client_id">Cliente</label><select id="field-client_id" name="client_id"${isCommercial ? '' : ' disabled'}><option value="">Sin asignar</option>${optionList(clients.map(client => [client.id, `${client.name}${client.company ? ` · ${client.company}` : ''}`]), item.client_id)}</select></div>
                </div>
                ${textField('tech_stack','Tecnologías',asArray(item.tech_stack).join(', '),{placeholder:'PHP, MySQL, JavaScript',wide:true,hint:'separadas por comas'})}
                ${tagsField(item.tags,tagCatalog,{placeholder:'cliente, portfolio, mantenimiento'})}
                ${textField('repository_url','Repositorio',item.repository_url,{type:'url',placeholder:'https://github.com/…'})}
                ${textField('live_url','Sitio publicado',item.live_url,{type:'url',placeholder:'https://…'})}
                <div class="form-field is-wide"><label>Color del proyecto</label><div class="color-options">${PROJECT_COLORS.map((color,index) => `<label class="color-option"><input type="radio" name="color" value="${color}"${safeColor(item.color,PROJECT_COLORS[0]).toLowerCase() === color.toLowerCase() || (!item.color && index === 0) ? ' checked' : ''}><span style="--color:${color}"></span></label>`).join('')}</div></div>
            </div>`;
        }
        if (entity === 'devlog') {
            const projects = await getCollection('projects').catch(() => []);
            return `<div class="form-grid">
                ${textField('title','Título de la entrada',item.title,{placeholder:'Ej. Flujo de registro cerrado',required:true,wide:true})}
                ${selectField('project_id','Proyecto',item.project_id,projects.map(project => [project.id,project.name]),{blank:'Sin proyecto'})}
                ${textField('entry_date','Fecha',item.entry_date || todayISO(),{type:'date',required:true})}
                ${selectField('entry_type','Tipo de entrada',item.entry_type || 'progress',Object.entries(DEVLOG_TYPES),{blank:false})}
                ${textField('minutes_spent','Tiempo dedicado',item.minutes_spent ?? 0,{type:'number',min:0,max:1440,step:5,hint:'minutos'})}
                ${textareaField('content','Qué pasó',item.content,'Resultado, contexto, dudas o próximos pasos…')}
                ${tagsField(item.tags,tagCatalog,{placeholder:'autenticación, backend, aprendizaje'})}
            </div>`;
        }
        if (entity === 'budget') {
            const [clients, projects] = await Promise.all([getCollection('clients').catch(() => []), getCollection('projects').catch(() => [])]);
            return `<div class="form-grid">
                ${textField('title','Título del presupuesto',item.title,{placeholder:'Ej. Sitio institucional — etapa 1',required:true,wide:true})}
                ${selectField('status','Estado',item.status || 'draft',[['draft','Borrador'],['sent','Enviado'],['approved','Aprobado'],['rejected','Rechazado'],['expired','Vencido']],{blank:false})}
                ${selectField('currency','Moneda',item.currency || 'ARS',[['ARS','ARS — Peso argentino'],['USD','USD — Dólar'],['EUR','EUR — Euro']],{blank:false})}
                ${textField('amount','Importe total',item.amount ?? 0,{type:'number',min:0,max:999999999.99,step:0.01,required:true})}
                ${textField('valid_until','Válido hasta',item.valid_until ?? (item.id ? '' : dateAfter(30)),{type:'date'})}
                ${selectField('client_id','Cliente',item.client_id,clients.map(client => [client.id,client.name]),{blank:'Sin cliente'})}
                ${selectField('project_id','Proyecto',item.project_id,projects.map(project => [project.id,project.name]),{blank:'Sin proyecto'})}
                ${textareaField('notes','Alcance y notas',item.notes,'Qué incluye, condiciones, aclaraciones…')}
                ${tagsField(item.tags,tagCatalog,{placeholder:'web, propuesta, mensual'})}
            </div>`;
        }
        if (entity === 'payment') {
            const budgets = await getCollection('budgets').catch(() => []);
            return `<div class="form-grid">
                ${selectField('budget_id','Presupuesto',item.budget_id,budgets.map(budget => [budget.id,`${budget.title} · ${formatMoney(budget.balance, budget.currency)} pendiente`]),{wide:true,blank:'Elige un presupuesto',required:true})}
                ${textField('amount','Importe cobrado',item.amount ?? '',{type:'number',min:0.01,max:999999999.99,step:0.01,required:true})}
                ${textField('paid_at','Fecha del cobro',item.paid_at || todayISO(),{type:'date',required:true})}
                ${selectField('method','Medio de pago',item.method || 'transfer',Object.entries(PAYMENT_METHODS),{blank:false})}
                ${textField('reference','Referencia',item.reference,{placeholder:'Transferencia, recibo…',hint:'nunca datos completos de tarjeta'})}
                ${textareaField('notes','Notas',item.notes,'Detalle útil para conciliar este cobro…')}
            </div>`;
        }
        if (entity === 'release') {
            const projects = await getCollection('projects').catch(() => []);
            return `<div class="form-grid">
                ${textField('title','Nombre de la entrega',item.title,{placeholder:'Ej. Primer release público',required:true,wide:true})}
                ${selectField('project_id','Proyecto',item.project_id,projects.map(project => [project.id,project.name]),{wide:true,blank:'Elige un proyecto',required:true})}
                ${textField('version','Versión',item.version,{placeholder:'v1.0.0'})}
                ${selectField('kind','Clase',item.kind || 'version',Object.entries(RELEASE_KINDS),{blank:false})}
                ${selectField('environment','Entorno',item.environment || 'production',[['development','Desarrollo'],['staging','Pruebas / staging'],['production','Producción'],['client','Cliente']],{blank:false})}
                ${selectField('status','Estado',item.status || 'planned',[['planned','Planificada'],['ready','Lista'],['published','Publicada'],['rolled_back','Revertida']],{blank:false})}
                ${textField('release_date','Fecha',item.release_date ?? (item.id ? '' : todayISO()),{type:'date'})}
                ${textField('url','Enlace',item.url,{type:'url',placeholder:'https://…',wide:true})}
                ${textareaField('notes','Notas de versión',item.notes,'Cambios, instrucciones o contexto de la entrega…')}
                ${tagsField(item.tags,tagCatalog,{placeholder:'release, producción, hotfix'})}
            </div>`;
        }
        if (entity === 'resource') {
            const projects = await getCollection('projects').catch(() => []);
            return `<div class="form-grid">
                <aside class="form-security-note is-wide" role="note">${icon('alert')}<span><strong>No guardes secretos aquí.</strong> Evita contraseñas, tokens, claves privadas y credenciales en todos los campos.</span></aside>
                ${textField('name','Nombre del recurso',item.name,{placeholder:'Ej. Dominio principal',required:true,wide:true})}
                ${selectField('resource_type','Tipo',item.resource_type || 'service',Object.entries(RESOURCE_TYPES),{blank:false})}
                ${textField('provider','Proveedor',item.provider,{placeholder:'Empresa o plataforma'})}
                ${selectField('project_id','Proyecto',item.project_id,projects.map(project => [project.id,project.name]),{blank:'Recurso compartido'})}
                ${selectField('environment','Entorno',item.environment || 'production',[['development','Desarrollo'],['staging','Pruebas / staging'],['production','Producción'],['shared','Compartido']],{blank:false})}
                ${selectField('status','Estado',item.status || 'active',[['active','Activo'],['attention','Requiere atención'],['inactive','Inactivo']],{blank:false})}
                ${textField('url','URL de acceso público',item.url,{type:'url',placeholder:'https://…',wide:true,hint:'sin tokens ni credenciales'})}
                ${feature('credential_refs') ? textField('credential_ref','Dónde está la credencial',item.credential_ref,{placeholder:'1Password → Atlas → Producción',wide:true,hint:'solo la referencia, nunca la clave'}) : ''}
                ${textField('renewal_date','Fecha de renovación',item.renewal_date,{type:'date'})}
                ${textField('cost','Costo',item.cost ?? 0,{type:'number',min:0,max:999999999.99,step:0.01})}
                ${selectField('currency','Moneda',item.currency || 'ARS',[['ARS','ARS'],['USD','USD'],['EUR','EUR']],{blank:false})}
                ${selectField('billing_cycle','Ciclo de cobro',item.billing_cycle || 'none',Object.entries(BILLING_CYCLES),{blank:false})}
                ${textareaField('notes','Notas operativas',item.notes,'Uso, responsable, procedimiento de renovación…',{hint:'sin contraseñas, tokens ni claves'})}
                ${tagsField(item.tags,tagCatalog,{placeholder:'infra, anual, producción'})}
            </div>`;
        }
        if (entity === 'reminder') {
            const projects = await getCollection('projects').catch(() => []);
            return `<div class="form-grid">
                ${textField('title','Qué quieres recordar',item.title,{placeholder:'Ej. Renovar el dominio',required:true,wide:true})}
                ${selectField('project_id','Proyecto',item.project_id,projects.map(project=>[project.id,project.name]),{blank:'Recordatorio personal'})}
                ${textField('due_at','Fecha y hora',utcToDateTimeLocal(item.due_at || new Date(Date.now()+86400000).toISOString()),{type:'datetime-local',required:true})}
                ${selectField('priority','Prioridad',item.priority||'medium',[['low','Baja'],['medium','Media'],['high','Alta']],{blank:false})}
                ${selectField('status','Estado',item.status||'pending',[['pending','Pendiente'],['done','Completado'],['dismissed','Descartado']],{blank:false})}
                ${textareaField('notes','Notas',item.notes,'Contexto o próximo paso…')}
                ${tagsField(item.tags,tagCatalog,{placeholder:'personal, renovación, urgente'})}
            </div>`;
        }
        if (entity === 'time_entry') {
            const [projects,tasks] = await Promise.all([getCollection('projects').catch(()=>[]),getCollection('tasks').catch(()=>[])]);
            const timerMode = Boolean(item.timer_start);
            return `<div class="form-grid">
                ${timerMode ? '<input type="hidden" name="timer_start" value="1"><aside class="form-security-note is-wide" role="note">'+icon('clock')+'<span><strong>El reloj empezará al guardar.</strong> Puedes cerrar CodePanel: el inicio queda guardado en el servidor.</span></aside>' : ''}
                ${textField('description',timerMode?'En qué vas a trabajar':'Qué has hecho',item.description,{placeholder:'Ej. Implementar el flujo de acceso',required:true,wide:true})}
                ${selectField('project_id','Proyecto',item.project_id,projects.map(project=>[project.id,project.name]),{blank:'Sin proyecto'})}
                ${selectField('task_id','Tarea',item.task_id,tasks.filter(task=>task.status!=='done'||Number(task.id)===Number(item.task_id)).map(task=>[task.id,`${task.title}${task.project_name?' · '+task.project_name:''}`]),{blank:'Sin tarea'})}
                ${textField('work_date','Fecha de trabajo',item.work_date||todayISO(),{type:'date',required:true})}
                ${timerMode ? '' : textField('duration_minutes','Duración',item.duration_minutes??0,{type:'number',min:0,max:1440,step:5,required:true,hint:'minutos'})}
                <div class="form-field is-wide"><label class="check-field"><input type="checkbox" name="billable" value="1"${item.billable===undefined||Number(item.billable)?' checked':''}> Tiempo facturable</label></div>
                ${tagsField(item.tags,tagCatalog,{placeholder:'backend, reunión, diseño'})}
            </div>`;
        }
        if (entity === 'weekly_review') {
            const bounds = weekBounds(new Date());
            return `<div class="form-grid">
                ${textField('week_start','Semana que comienza',item.week_start||bounds.start,{type:'date',required:true,wide:true})}
                ${textareaField('wins','Qué salió bien',item.wins,'Avances, decisiones acertadas, pequeñas victorias…')}
                ${textareaField('blockers','Qué te bloqueó',item.blockers,'Dudas, interrupciones, problemas técnicos…')}
                ${textareaField('next_focus','Foco de la próxima semana',item.next_focus,'Una prioridad concreta que ordene el resto…')}
                ${rangeField('rating','Cómo ha ido la semana',item.rating??3,1,5)}
                ${tagsField(item.tags,tagCatalog,{placeholder:'buena-semana, foco, aprendizaje'})}
            </div>`;
        }
        if (entity === 'tag') return `<div class="form-grid">
            ${textField('name','Nombre de la etiqueta',item.name,{placeholder:'Ej. mantenimiento',required:true,wide:true,hint:'máximo 40 caracteres'})}
            ${textField('color','Color',item.color||'#748c76',{type:'color',required:true})}
            <aside class="tag-form-preview"><span style="--tag-color:${safeColor(item.color,'#748c76')}">#${escapeHTML(item.name||'etiqueta')}</span><small>La etiqueta se sugerirá en todos los formularios compatibles.</small></aside>
        </div>`;
        if (entity === 'idea') return `<div class="form-grid">
            ${textField('title','Título de la idea',item.title,{placeholder:'¿Qué podría existir?',required:true,wide:true})}
            ${textareaField('description','Notas e hipótesis',item.description,'Problema, posible solución, para quién…')}
            ${selectField('status','Estado',item.status || 'inbox',[['inbox','En la bandeja'],['exploring','Explorando'],['validated','Validada'],['building','Construyendo'],['parked','En pausa']],{blank:false})}
            ${textField('category','Categoría',item.category,{placeholder:'SaaS, open source…'})}
            ${rangeField('impact','Impacto potencial',item.impact ?? 3,1,5)}
            ${rangeField('effort','Esfuerzo estimado',item.effort ?? 3,1,5)}
            ${tagsField(item.tags,tagCatalog,{placeholder:'productividad, educación'})}
            <div class="form-field is-wide"><label class="check-field"><input type="checkbox" name="archived" value="1"${item.archived ? ' checked' : ''}> Guardar en el archivo</label></div>
        </div>`;
        if (entity === 'client') return `<div class="form-grid">
            ${textField('name','Nombre y apellido',item.name,{placeholder:'Nombre del contacto',required:true,wide:true})}
            ${textField('company','Empresa o estudio',item.company,{placeholder:'Organización'})}
            ${selectField('status','Relación',item.status || 'active',[['active','Cliente activo'],['lead','Cliente potencial'],['inactive','Inactivo']],{blank:false})}
            ${textField('email','Correo electrónico',item.email,{type:'email',placeholder:'persona@empresa.com'})}
            ${textField('phone','Teléfono',item.phone,{type:'tel',placeholder:'+54…'})}
            ${textField('website','Sitio web',item.website,{type:'url',placeholder:'https://…',wide:true})}
            ${textField('source','Cómo llegó',item.source,{placeholder:'Recomendación, evento…'})}
            ${textField('last_contact','Último contacto',item.last_contact,{type:'date'})}
            ${textareaField('notes','Notas',item.notes,'Preferencias, contexto, próximos pasos…')}
            ${tagsField(item.tags,tagCatalog,{placeholder:'vip, diseño, recurrente'})}
        </div>`;
        if (entity === 'lead') return `<div class="form-grid">
            ${textField('name','Nombre y apellido',item.name,{placeholder:'Nombre del contacto',required:true,wide:true})}
            ${textField('company','Empresa',item.company,{placeholder:'Organización'})}
            ${selectField('status','Etapa',item.status || 'new',[['new','Nuevo'],['contacted','Contactado'],['qualified','Calificado'],['proposal','Propuesta enviada'],['won','Ganado'],['lost','Perdido']],{blank:false})}
            ${textField('email','Correo electrónico',item.email,{type:'email',placeholder:'persona@empresa.com'})}
            ${textField('phone','Teléfono',item.phone,{type:'tel',placeholder:'+54…'})}
            ${textField('value','Valor estimado',item.value ?? 0,{type:'number',placeholder:'0'})}
            ${textField('next_follow_up','Próximo seguimiento',item.next_follow_up,{type:'date'})}
            ${textField('source','Origen',item.source,{placeholder:'LinkedIn, evento…',wide:true})}
            ${textareaField('notes','Notas de la conversación',item.notes,'Necesidades, presupuesto, próximo paso…')}
            ${tagsField(item.tags,tagCatalog,{placeholder:'referido, seguimiento, ecommerce'})}
        </div>`;
        const projects = await getCollection('projects').catch(() => []);
        return `<div class="form-grid">
            ${textField('title','Qué hay que hacer',item.title,{placeholder:'Una acción concreta',required:true,wide:true})}
            ${textareaField('description','Detalles',item.description,'Contexto o definición de terminado…')}
            ${selectField('status','Estado',item.status || 'todo',[['todo','Por hacer'],['in_progress','En curso'],['done','Completada']],{blank:false})}
            ${selectField('priority','Prioridad',item.priority || 'medium',[['low','Baja'],['medium','Media'],['high','Alta'],['urgent','Urgente']],{blank:false})}
            ${selectField('project_id','Proyecto',item.project_id,projects.filter(project => project.status !== 'archived').map(project => [project.id,project.name]))}
            ${textField('due_date','Fecha límite',item.due_date,{type:'date'})}
            ${textField('assignee','Responsable',item.assignee,{placeholder:'Yo, compañero…',wide:true})}
            ${taskPlanningFields(item)}
            ${tagsField(item.tags,tagCatalog,{placeholder:'frontend, bug, urgente'})}
        </div>`;
    }

    function syncProjectTypeFields(root = dom.dialogFields) {
        const selected = root.querySelector('[name="project_type"]:checked');
        const fields = root.querySelector('[data-commercial-fields]');
        if (!selected || !fields) return;
        const isCommercial = selected.value === 'commercial';
        fields.hidden = !isCommercial;
        fields.querySelectorAll('input, select, textarea').forEach(field => { field.disabled = !isCommercial; });
        const note = root.querySelector('#project-type-note');
        if (note) note.textContent = isCommercial
            ? 'Cliente y fecha son opcionales: complétalos cuando tenga sentido.'
            : 'Al guardar como personal se quitarán el cliente y la fecha objetivo.';
    }

    async function openEntityDialog(entity, id = null, prefill = null) {
        if (!ENTITY_ROUTE[entity]) return;
        closeDropdowns();
        let item = prefill || {};
        if (entity === 'weekly_review' && id === null && !prefill) {
            try { item = await weeklyReviewPrefill(); } catch { item = {}; }
        }
        if (id !== null && !prefill) {
            try {
                const rows = await getCollection(ENTITY_ROUTE[entity]);
                item = rows.find(row => Number(row.id) === Number(id)) || (await api.get(`${ENTITY_ROUTE[entity]}/${Number(id)}`)).data || {};
            } catch (error) { toast('No pudimos abrir el registro', error.message, 'error'); return; }
        }
        state.form = { entity, id: id === null ? null : Number(id), timerStart: Boolean(prefill?.timer_start) };
        dom.dialogKicker.textContent = id === null ? 'Nuevo registro' : 'Editar registro';
        dom.dialogTitle.textContent = state.form.timerStart ? 'Iniciar temporizador' : `${id === null ? 'Crear' : 'Editar'} ${ENTITY_NAMES[entity]}`;
        dom.dialogSubmit.querySelector('span').textContent = state.form.timerStart ? 'Iniciar ahora' : (id === null ? `Crear ${ENTITY_NAMES[entity]}` : 'Guardar cambios');
        dom.dialogDelete.hidden = id === null;
        dom.dialogFields.innerHTML = '<div class="page-skeleton"><div class="skeleton skeleton-subtitle"></div><div class="skeleton skeleton-panel"></div></div>';
        if (!dom.entityDialog.open) dom.entityDialog.showModal();
        dom.dialogFields.innerHTML = await formFields(entity, item);
        if (entity === 'project') syncProjectTypeFields();
        requestAnimationFrame(() => dom.dialogFields.querySelector('input,textarea,select')?.focus());
    }

    function serializeEntityForm(entity) {
        const raw = Object.fromEntries(new FormData(dom.entityForm).entries());
        const nullable = {
            project: ['description','due_date','client_id','repository_url','live_url'], idea: ['description','category'],
            client: ['company','email','phone','website','source','notes','last_contact'], lead: ['company','email','phone','source','next_follow_up','notes'],
            task: ['description','project_id','assignee','due_date'],
            devlog: ['project_id','content'], budget: ['client_id','project_id','valid_until','notes'],
            payment: ['reference','notes'], release: ['version','release_date','url','notes'],
            resource: ['project_id','provider','url','renewal_date','notes','credential_ref'], snippet: ['project_id','language'],
            reminder: ['project_id','notes'], time_entry: ['project_id','task_id'], weekly_review: ['wins','blockers','next_focus'],
        }[entity] || [];
        nullable.forEach(field => { if (raw[field] === '' || raw[field] === undefined) raw[field] = null; });
        if (entity === 'project') {
            raw.project_type = raw.project_type === 'commercial' ? 'commercial' : 'personal';
            raw.progress = Number(raw.progress); raw.client_id = raw.client_id ? Number(raw.client_id) : null;
            if (raw.project_type === 'personal') { raw.client_id = null; raw.due_date = null; }
            raw.tech_stack = asArray(raw.tech_stack); raw.tags = asArray(raw.tags).slice(0,30);
        } else if (entity === 'idea') {
            raw.effort = Number(raw.effort); raw.impact = Number(raw.impact); raw.tags = asArray(raw.tags).slice(0,30); raw.archived = Boolean(raw.archived);
        } else if (entity === 'lead') { raw.value = Number(raw.value || 0); raw.tags = asArray(raw.tags).slice(0,30); }
        else if (entity === 'client') raw.tags = asArray(raw.tags).slice(0,30);
        else if (entity === 'task') {
            raw.project_id = raw.project_id ? Number(raw.project_id) : null; raw.tags = asArray(raw.tags).slice(0,30);
            const checklist = readChecklistEditor();
            if (checklist !== null) raw.checklist = checklist;
            if ('estimated_hours' in raw) { const hours = Number(String(raw.estimated_hours).replace(',', '.')); raw.estimated_minutes = hours > 0 ? Math.round(hours * 60) : null; delete raw.estimated_hours; }
        }
        else if (entity === 'snippet') { raw.project_id = raw.project_id ? Number(raw.project_id) : null; raw.tags = asArray(raw.tags).slice(0,30); }
        else if (entity === 'devlog') { raw.project_id = raw.project_id ? Number(raw.project_id) : null; raw.minutes_spent = Number(raw.minutes_spent || 0); raw.tags = asArray(raw.tags).slice(0,30); }
        else if (entity === 'budget') { raw.client_id = raw.client_id ? Number(raw.client_id) : null; raw.project_id = raw.project_id ? Number(raw.project_id) : null; raw.amount = Number(raw.amount || 0); raw.tags = asArray(raw.tags).slice(0,30); }
        else if (entity === 'payment') { raw.budget_id = Number(raw.budget_id); raw.amount = Number(raw.amount); }
        else if (entity === 'release') { raw.project_id = raw.project_id ? Number(raw.project_id) : null; raw.tags = asArray(raw.tags).slice(0,30); }
        else if (entity === 'resource') { raw.project_id = raw.project_id ? Number(raw.project_id) : null; raw.cost = Number(raw.cost || 0); raw.tags = asArray(raw.tags).slice(0,30); }
        else if (entity === 'reminder') { raw.project_id = raw.project_id ? Number(raw.project_id) : null; raw.due_at = zonedInputToISO(raw.due_at); raw.tags = asArray(raw.tags).slice(0,30); }
        else if (entity === 'time_entry') {
            raw.project_id = raw.project_id ? Number(raw.project_id) : null; raw.task_id = raw.task_id ? Number(raw.task_id) : null;
            raw.billable = Boolean(raw.billable); raw.tags = asArray(raw.tags).slice(0,30);
            raw.duration_minutes = raw.duration_minutes === undefined || raw.duration_minutes === '' ? 0 : Number(raw.duration_minutes);
            raw._timer_start = Boolean(raw.timer_start); delete raw.timer_start;
        }
        else if (entity === 'weekly_review') { raw.rating = Number(raw.rating || 3); raw.tags = asArray(raw.tags).slice(0,30); }
        return raw;
    }

    function showFormErrors(errors = {}) {
        dom.dialogFields.querySelectorAll('.field-error').forEach(node => node.remove());
        dom.dialogFields.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
        let first;
        Object.entries(errors).forEach(([name,message]) => {
            const field = dom.dialogFields.querySelector(`[name="${name}"]`);
            if (!field) return;
            field.setAttribute('aria-invalid', 'true');
            const error = document.createElement('small'); error.className = 'field-error'; error.textContent = Array.isArray(message) ? message.join(' ') : String(message);
            field.closest('.form-field')?.append(error); first ||= field;
        });
        first?.focus();
    }

    async function submitEntityForm(event) {
        event.preventDefault();
        if (!dom.entityForm.checkValidity()) { dom.entityForm.reportValidity(); return; }
        const { entity, id } = state.form;
        if (!entity) return;
        const route = ENTITY_ROUTE[entity];
        const button = dom.dialogSubmit;
        const old = button.innerHTML; button.disabled = true; button.innerHTML = '<span>Guardando…</span>';
        try {
            const body = serializeEntityForm(entity);
            const timerStart = Boolean(body._timer_start); delete body._timer_start;
            const payload = timerStart ? await api.post('time_entries/timer/start', body) : (id === null ? await api.post(route, body) : await api.patch(`${route}/${id}`, body));
            const back = state.formReturn; state.formReturn = null;
            dom.entityDialog.close();
            invalidate(route, ...relatedCollections(entity));
            toast(id === null ? `${capitalize(ENTITY_NAMES[entity])} ${FEMININE_ENTITIES.has(entity) ? 'creada' : 'creado'}` : 'Cambios guardados', String(payload.data?.title || payload.data?.name || payload.data?.description || '').slice(0, 80) || 'Tu espacio ya está actualizado.');
            await refreshView();
            await returnToPreview(back);
        } catch (error) {
            showFormErrors(error.errors);
            toast('Revisa los datos', error.message, 'error');
        } finally { button.disabled = false; button.innerHTML = old; }
    }

    // Recuerda la ficha (proyecto o registro) desde la que se abrió un formulario para volver a ella al guardar o cancelar.
    function rememberPreview() {
        if (dom.projectPreviewDialog?.open && state.projectPreview.id) return { entity: 'project', id: Number(state.projectPreview.id) };
        if (dom.recordPreviewDialog?.open && state.recordPreview?.entity && state.recordPreview?.id) return { entity: state.recordPreview.entity, id: Number(state.recordPreview.id) };
        return null;
    }
    async function returnToPreview(back) {
        if (!back) return;
        if (back.entity === 'project') await openProjectPreview(back.id, { quiet: true });
        else await openRecordPreview(back.entity, back.id, { quiet: true });
    }

    const capitalize = value => String(value).charAt(0).toUpperCase() + String(value).slice(1);

    function confirmAction(title, message, confirmLabel = 'Sí, eliminar') {
        closeDropdowns();
        dom.confirmTitle.textContent = title;
        dom.confirmMessage.textContent = message;
        dom.confirmDialog.querySelector('[value="confirm"]').textContent = confirmLabel;
        // `HTMLDialogElement.returnValue` persiste entre aperturas. Partimos de
        // un valor seguro y convertimos Escape en un cierre cancelado explícito.
        dom.confirmDialog.returnValue = 'cancel';
        return new Promise(resolve => {
            const onCancel = event => {
                event.preventDefault();
                dom.confirmDialog.close('cancel');
            };
            const onClose = () => {
                dom.confirmDialog.removeEventListener('cancel', onCancel);
                const accepted = dom.confirmDialog.returnValue === 'confirm';
                dom.confirmDialog.returnValue = 'cancel';
                resolve(accepted);
            };
            dom.confirmDialog.addEventListener('cancel', onCancel);
            dom.confirmDialog.addEventListener('close', onClose, { once: true });
            dom.confirmDialog.showModal();
        });
    }

    async function deleteEntity(entity, id, closeDialog = false) {
        const messages = {
            budget: 'También se eliminarán todos los cobros asociados. Esta acción no se puede deshacer.',
            project: 'Sus entregas y versiones se eliminarán. Tareas, bitácora, presupuestos y recursos relacionados quedarán sin proyecto asignado.',
        };
        const accepted = await confirmAction(`¿Eliminar ${ENTITY_NAMES[entity]}?`, messages[entity] || 'Esta acción no se puede deshacer. Los demás registros relacionados no se modificarán salvo que dependan de este elemento.');
        if (!accepted) return;
        try {
            await api.delete(`${ENTITY_ROUTE[entity]}/${Number(id)}`);
            const back = closeDialog ? state.formReturn : null;
            if (closeDialog) state.formReturn = null;
            if (closeDialog && dom.entityDialog.open) dom.entityDialog.close();
            invalidate(ENTITY_ROUTE[entity], ...relatedCollections(entity));
            toast(`${capitalize(ENTITY_NAMES[entity])} ${FEMININE_ENTITIES.has(entity) ? 'eliminada' : 'eliminado'}`, 'El registro ya no aparece en tu espacio.');
            await refreshView();
            const deletedItself = back && back.entity === entity && Number(back.id) === Number(id);
            if (!deletedItself) await returnToPreview(back);
        } catch (error) { toast('No pudimos eliminarlo', error.message, 'error'); }
    }

    async function duplicateEntity(entity, id) {
        const rows = await getCollection(ENTITY_ROUTE[entity]);
        const original = rows.find(row => Number(row.id) === Number(id));
        if (!original) return;
        const copy = { ...original };
        delete copy.id; delete copy.created_at; delete copy.updated_at;
        if (entity === 'project') copy.name = `${copy.name} — copia`;
        await openEntityDialog(entity, null, copy);
    }

    async function toggleTask(id) {
        try {
            const tasks = await getCollection('tasks');
            const task = tasks.find(item => Number(item.id) === Number(id));
            if (!task) return;
            const status = task.status === 'done' ? 'todo' : 'done';
            // Respuesta inmediata: la casilla y la fila cambian antes de que conteste el servidor.
            document.querySelectorAll(`[data-task-toggle="${Number(id)}"]`).forEach(button => {
                button.classList.toggle('is-done', status === 'done');
                button.innerHTML = status === 'done' ? icon('check') : '';
                button.closest('.task-row, .project-preview-task')?.classList.toggle('is-done', status === 'done');
            });
            await api.patch(`tasks/${Number(id)}`, { status });
            invalidate('tasks','attention');
            toast(status === 'done' ? 'Tarea completada' : 'Tarea reabierta', status === 'done' ? 'Buen avance. Seguimos.' : 'Volvió a tu lista.');
            const previewId = dom.projectPreviewDialog?.open ? Number(state.projectPreview.id) : 0;
            if (previewId) await openProjectPreview(previewId, { quiet: true });
            else await refreshView();
        } catch (error) { toast('No pudimos actualizar la tarea', error.message, 'error'); await refreshView(); }
    }

    function toast(title, message = '', type = 'success') {
        const node = document.createElement('article');
        node.className = `toast${type === 'error' ? ' is-error' : ''}`;
        node.innerHTML = `<span class="toast-icon">${type === 'error' ? '!' : '✓'}</span><div><strong>${escapeHTML(title)}</strong>${message ? `<p>${escapeHTML(message)}</p>` : ''}</div><button type="button" aria-label="Cerrar">×</button>`;
        const remove = () => { node.classList.add('is-leaving'); setTimeout(() => node.remove(), 230); };
        node.querySelector('button').addEventListener('click', remove);
        dom.toastRegion.append(node);
        setTimeout(remove, 4_800);
    }

    function openSidebar() { dom.sidebar.classList.add('is-open'); dom.scrim.classList.add('is-visible'); dom.sidebarButtons.forEach(button => button.setAttribute('aria-expanded','true')); document.body.style.overflow = 'hidden'; }
    function closeSidebar() { dom.sidebar.classList.remove('is-open'); dom.scrim.classList.remove('is-visible'); dom.sidebarButtons.forEach(button => button.setAttribute('aria-expanded','false')); document.body.style.overflow = ''; }
    function closeDropdowns(except = null) {
        [[dom.createMenu,dom.quickCreate],[dom.profileMenu,dom.profileButton]].forEach(([menu,button]) => { if (menu !== except) { menu.hidden = true; button?.setAttribute('aria-expanded','false'); } });
        document.querySelectorAll('.card-actions-menu').forEach(menu => { if (menu !== except) menu.hidden = true; });
    }

    function updateProfile() {
        const name = state.user?.name || 'Mi espacio';
        document.querySelector('#user-name').textContent = name;
        document.querySelector('#user-role').textContent = state.demoMode ? 'Espacio de muestra' : (state.user?.email || 'Cuenta personal');
        document.querySelector('#user-avatar').textContent = initials(name);
    }

    function restoreTheme() {
        const saved = localStorage.getItem('cp-theme');
        if (saved === 'night') document.documentElement.dataset.theme = 'night';
    }
    function applyThemeSetting() {
        const theme = state.settings?.theme || localStorage.getItem('cp-theme') || 'system';
        const night = theme === 'night' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
        if (night) document.documentElement.dataset.theme = 'night'; else delete document.documentElement.dataset.theme;
        localStorage.setItem('cp-theme', theme === 'night' ? 'night' : '');
    }
    async function toggleTheme() {
        const next = document.documentElement.dataset.theme === 'night' ? '' : 'night';
        if (next) document.documentElement.dataset.theme = next; else delete document.documentElement.dataset.theme;
        localStorage.setItem('cp-theme', next);
        if (state.user) {
            try {
                const payload = await api.patch('settings', { theme: next ? 'night' : 'light' });
                state.settings = payload.data || { ...(state.settings || {}), theme: next ? 'night' : 'light' };
            } catch (error) { toast('El tema cambió solo en este dispositivo', error.message, 'error'); }
        }
    }

    function applyRegistrationAvailability(enabled) {
        state.registrationEnabled = enabled !== false;
        const registerTab = document.querySelector('[data-auth-mode="register"]');
        const tabs = document.querySelector('.auth-tabs');
        const lead = document.querySelector('.auth-lead');
        if (registerTab) {
            registerTab.hidden = !state.registrationEnabled;
            registerTab.disabled = !state.registrationEnabled;
            registerTab.setAttribute('aria-disabled', String(!state.registrationEnabled));
        }
        tabs?.classList.toggle('is-login-only', !state.registrationEnabled);
        if (lead) {
            lead.textContent = state.databaseAvailable === false
                ? 'CodePanel no puede conectar con la base de datos. Revisa la conexión en el archivo .env o activa DEMO_FALLBACK=true para ver la demo.'
                : state.registrationEnabled
                    ? 'Entra para continuar o crea tu espacio personal en un minuto.'
                    : 'El alta de cuentas está desactivada en este espacio. Entra con una cuenta existente.';
        }
        if (!state.registrationEnabled && dom.authForm.dataset.mode === 'register') setAuthMode('login');
    }
    // Sin base de datos (y sin modo demo) no se puede entrar: se explica en vez de mostrar un formulario inútil.
    function applyDatabaseAvailability(available) {
        state.databaseAvailable = available;
        dom.authForm.querySelectorAll('input, button').forEach(control => { control.disabled = !available; });
        dom.authForm.querySelector('.auth-tabs').hidden = !available;
        applyRegistrationAvailability(state.registrationEnabled);
    }
    function showAuth() {
        applyRegistrationAvailability(state.registrationEnabled);
        if (!state.registrationEnabled) setAuthMode('login');
        dom.shell.inert = true;
        dom.authOverlay.hidden = false;
        setTimeout(() => document.querySelector('#auth-email')?.focus(), 50);
    }
    function setAuthMode(mode) {
        if (mode === 'register' && !state.registrationEnabled) mode = 'login';
        document.querySelectorAll('[data-auth-mode]').forEach(button => { const active = button.dataset.authMode === mode; button.classList.toggle('is-active',active); button.setAttribute('aria-selected',String(active)); });
        dom.authForm.dataset.mode = mode;
        document.querySelector('.auth-name-field').hidden = mode !== 'register';
        document.querySelector('#auth-name').required = mode === 'register';
        document.querySelector('#auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
        dom.authForm.querySelector('.auth-submit span:first-child').textContent = mode === 'register' ? 'Crear mi espacio' : 'Entrar a mi espacio';
        dom.authError.hidden = true;
    }
    async function submitAuth(event) {
        event.preventDefault();
        const mode = dom.authForm.dataset.mode || 'login';
        if (mode === 'register' && !state.registrationEnabled) {
            setAuthMode('login');
            dom.authError.textContent = 'El alta de cuentas está desactivada. Entra con una cuenta existente.';
            dom.authError.hidden = false;
            return;
        }
        if (!dom.authForm.checkValidity()) { dom.authForm.reportValidity(); return; }
        const body = Object.fromEntries(new FormData(dom.authForm).entries());
        const button = dom.authForm.querySelector('.auth-submit'); button.disabled = true;
        try {
            const payload = (await api.post(`auth/${mode}`, body)).data || {};
            state.user = payload.user; state.csrf = payload.csrf_token || ''; state.demoMode = Boolean(payload.demo_mode); state.features = payload.features || state.features || {}; applyFeatureVisibility(); applyRegistrationAvailability(payload.registration_enabled !== false);
            dom.shell.inert = false; dom.authOverlay.hidden = true; dom.authForm.reset(); updateProfile(); invalidate(...Object.values(ENTITY_ROUTE)); state.settings=null; await getSettings(true).catch(()=>{state.settings={};});
            state.calendarDay=todayISO();
            if (mode === 'register') toast('Tu espacio está listo', 'Crea tu primer proyecto para empezar.');
            history.replaceState(null,'','#dashboard'); await navigate('dashboard',{force:true});
        } catch (error) {
            if (mode === 'register' && error.status === 403 && !Object.hasOwn(error.errors, 'csrf')) {
                applyRegistrationAvailability(false);
                setAuthMode('login');
            }
            dom.authError.textContent = error.message;
            dom.authError.hidden = false;
        }
        finally { button.disabled = false; }
    }

    async function logout() {
        if (!await confirmAction('¿Cerrar sesión?', 'Tus datos quedan guardados y puedes volver cuando quieras.', 'Cerrar sesión')) return;
        try { await api.post('auth/logout', {}); } catch (error) { toast('No pudimos cerrar la sesión',error.message,'error'); return; }
        state.user = null; state.cache.clear(); state.dashboard = null; state.settings=null; stopTimerTicker(); showAuth();
        await refreshCsrf(); // la sesión se regeneró: el siguiente acceso necesita un token nuevo
    }

    async function openSearch() {
        if (!dom.searchDialog.open) dom.searchDialog.showModal();
        dom.searchInput.value = ''; dom.searchResults.innerHTML = '<div class="search-hint"><span>⌕</span><p>Preparando tu espacio…</p></div>'; dom.searchInput.focus();
        // Sólo se piden las colecciones que no están en caché (las invalidadas al crear o editar).
        const missing = [...Object.values(ENTITY_ROUTE),'attachments'].filter(route => !state.cache.has(route) && (route !== 'snippets' || feature('snippets')));
        if (missing.length) await Promise.allSettled(missing.map(route => getCollection(route)));
        renderSearchResults(dom.searchInput.value);
    }
    function renderSearchResults(query) {
        const clean = query.trim().toLocaleLowerCase('es');
        const commands = paletteCommands();
        if (!clean) { dom.searchResults.innerHTML = `${commandResults(commands.slice(0, 6), 'Acciones rápidas')}<p class="search-tip">Escribe para buscar. Filtra con <code>tipo:tarea</code>, <code>proyecto:nombre</code>, <code>estado:curso</code> o <code>#etiqueta</code>; empieza por <code>&gt;</code> para ver solo acciones.</p>`; return; }
        if (clean.startsWith('>')) { const term = clean.slice(1).trim(); const found = commands.filter(command => command.label.toLocaleLowerCase('es').includes(term)); dom.searchResults.innerHTML = commandResults(found.slice(0, 12), 'Acciones') || '<div class="search-hint"><span>—</span><p>No hay ninguna acción con ese nombre.</p></div>'; moveSearchSelection(1); return; }
        const parsed = parseSearchQuery(clean);
        const plain = parsed.text.join(' ');
        const matchingCommands = plain && !parsed.types.length && !parsed.tags.length && !parsed.project && !parsed.status ? commands.filter(command => command.label.toLocaleLowerCase('es').includes(plain)).slice(0, 3) : [];
        const definitions = [
            ['projects','project','Proyectos','name','description','folder','var(--coral-wash)'], ['ideas','idea','Ideas','title','description','bulb','var(--yellow-wash)'],
            ['tasks','task','Tareas','title','project_name','check','var(--blue-wash)'], ['clients','client','Clientes','name','company','users','var(--sage-wash)'], ['leads','lead','Oportunidades','name','company','target','var(--purple-wash)'],
            ['devlogs','devlog','Bitácora','title','project_name','journal','var(--coral-wash)'], ['budgets','budget','Presupuestos','title','client_name','receipt','var(--sage-wash)'],
            ['payments','payment','Cobros','budget_title','reference','wallet','var(--yellow-wash)'], ['releases','release','Entregas','title','project_name','package','var(--blue-wash)'],
            ['resources','resource','Recursos','name','provider','server','var(--purple-wash)'],
            ['reminders','reminder','Recordatorios','title','project_name','alert','var(--coral-wash)'],
            ['time_entries','time_entry','Tiempo','description','project_name','clock','var(--blue-wash)'],
            ['weekly_reviews','weekly_review','Revisiones','next_focus','wins','journal','var(--sage-wash)'],
            ['tags','tag','Etiquetas','name','slug','tag','var(--purple-wash)'],
            ...(feature('snippets') ? [['snippets','snippet','Fragmentos','title','language','code','var(--surface-soft)']] : []),
            ['attachments','attachment','Archivos','original_name','mime_type','package','var(--blue-wash)'],
        ];
        const groups = definitions.filter(([route]) => !parsed.types.length || parsed.types.includes(route)).map(([route,entity,label,title,subtitle,iconName,wash]) => {
            const records = (state.cache.get(route)?.data || []).filter(item => searchMatches(item, route, parsed, title, subtitle)).slice(0, parsed.types.length ? 12 : 5);
            if (!records.length) return '';
            return `<p class="search-group-title">${label}</p>${records.map(item => `<button class="search-result" type="button" data-search-open="${entity}" data-id="${Number(item.id)}"><span class="search-result-icon" style="--result-wash:${wash}">${icon(iconName)}</span><span><strong>${escapeHTML(item[title])}</strong><small>${escapeHTML(item[subtitle] || STATUS[item.status] || '')}</small></span></button>`).join('')}`;
        }).join('');
        const html = commandResults(matchingCommands, 'Acciones') + groups;
        dom.searchResults.innerHTML = html || '<div class="search-hint"><span>—</span><p>No hay resultados. Prueba con otra palabra o quita algún filtro.</p></div>';
        if (html) moveSearchSelection(1);
    }

    const filterSearch = debounce((route,value) => {
        state.filters[route].search = value;
        const data = state.pageData[route] || state.cache.get(route)?.data || [];
        paintCollection(route,data);
        const input = document.querySelector(`[data-filter-search="${route}"]`); input?.focus(); input?.setSelectionRange(value.length,value.length);
    }, 260);

    function startTimerTicker() {
        stopTimerTicker();
        const tick = () => document.querySelectorAll('[data-running-start]').forEach(node => {
            const start = parseDate(node.dataset.runningStart); if (!start || Number.isNaN(start.getTime())) return;
            const seconds = Math.max(0, Math.floor((Date.now()-start.getTime())/1000));
            const hours = Math.floor(seconds/3600); const minutes = Math.floor(seconds%3600/60); const rest = seconds%60;
            node.textContent = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(rest).padStart(2,'0')}`;
        });
        tick(); state.timerTick = setInterval(tick,1000);
    }
    function stopTimerTicker() { if (state.timerTick) clearInterval(state.timerTick); state.timerTick = null; }

    async function stopTimer(id, button) {
        if (!id || button?.disabled) return;
        if (button) button.disabled = true;
        try {
            await api.post(`time_entries/${Number(id)}/stop`, {});
            invalidate('time_entries'); toast('Temporizador detenido','El tiempo ha quedado guardado en tu registro.');
            if (state.route === 'time') await refreshView(); else { history.pushState(null,'','#time'); await navigate('time',{force:true}); }
        } catch (error) { toast('No pudimos detener el reloj',error.message,'error'); if (button) button.disabled=false; }
    }

    async function changeReminderStatus(id,status,button) {
        if (!id || button?.disabled) return; if (button) button.disabled=true;
        try { await api.patch(`reminders/${Number(id)}`,{status}); invalidate('reminders','attention'); toast(status==='done'?'Recordatorio completado':status==='pending'?'Recordatorio reabierto':'Recordatorio descartado'); await refreshView(); }
        catch(error){ toast('No pudimos actualizarlo',error.message,'error'); if(button)button.disabled=false; }
    }

    async function openSource(source,id) {
        const entity = entityFromRoute(String(source || ''));
        const route = ENTITY_PAGE[entity];
        if (!route || !Number(id)) return;
        history.pushState(null,'',`#${route}`); await navigate(route);
        if (entity === 'project') await openProjectPreview(id); else await openRecordPreview(entity,id);
    }

    async function saveSettingsForm(form) {
        const feedback = form.querySelector('[data-settings-feedback]'); const button = form.querySelector('[type="submit"]'); button.disabled=true;
        try {
            const data = new FormData(form); const body = Object.fromEntries(data.entries());
            body.default_hourly_cost = Number(body.default_hourly_cost||0);
            body.reminder_days = data.getAll('reminder_days').map(Number);
            const payload = await api.patch('settings',body); state.settings=payload.data||{...(state.settings||{}),...body}; applyThemeSetting();
            invalidate('reminders','attention'); feedback.textContent='Configuración guardada.'; toast('Preferencias guardadas','CodePanel ya usa tus nuevos ajustes.');
        } catch(error) { feedback.textContent=error.message; toast('No pudimos guardar',error.message,'error'); }
        finally { button.disabled=false; }
    }

    async function saveDashboardSettings(form) {
        const feedback=form.querySelector('[data-settings-feedback]'); const button=form.querySelector('[type="submit"]'); button.disabled=true;
        const selected=[...form.querySelectorAll('[data-widget-key]')].filter(row=>row.querySelector('input').checked).map(row=>row.dataset.widgetKey).filter(key=>Object.hasOwn(WIDGETS,key));
        if (!selected.length) { feedback.textContent='Deja al menos un bloque visible.'; button.disabled=false; return; }
        try { const payload=await api.patch('settings',{dashboard_widgets:selected}); state.settings=payload.data||{...(state.settings||{}),dashboard_widgets:selected}; state.dashboard=null; feedback.textContent='Dashboard guardado.'; toast('Dashboard actualizado','Los bloques siguen tu nuevo orden.'); }
        catch(error){ feedback.textContent=error.message; toast('No pudimos guardar',error.message,'error'); }
        finally{button.disabled=false;}
    }
    function updateWidgetMoveButtons(list) {
        const rows=[...list.querySelectorAll('[data-widget-key]')]; rows.forEach((row,index)=>{const up=row.querySelector('[data-widget-move="-1"]');const down=row.querySelector('[data-widget-move="1"]');if(up)up.disabled=index===0;if(down)down.disabled=index===rows.length-1;});
    }

    async function uploadAttachment(form) {
        const file=form.querySelector('[name="file"]')?.files?.[0]; const feedback=form.querySelector('[data-upload-feedback]'); const button=form.querySelector('[type="submit"]');
        if(!file){feedback.textContent='Elige un archivo antes de continuar.';return;}
        const [entityType,idValue=''] = String(form.elements.attachment_target.value).split(':');
        const body=new FormData(); body.append('entity_type',entityType||'general'); body.append('entity_id',String(Number(idValue)||0)); body.append('file',file,file.name);
        button.disabled=true; feedback.textContent=`Subiendo ${file.name} (${bytesLabel(file.size)})…`;
        try { await api.upload('attachments',body); invalidate('attachments'); form.reset(); form.querySelector('[data-file-name]').textContent='Ningún archivo elegido'; feedback.textContent='Archivo subido correctamente.'; toast('Archivo guardado',file.name); await navigate('files',{force:true}); }
        catch(error){feedback.textContent=error.message;toast('No pudimos subir el archivo',error.message,'error');}
        finally{button.disabled=false;}
    }

    async function deleteAttachment(id) {
        if(!await confirmAction('¿Eliminar archivo?','El archivo se borrará del hosting y no se puede recuperar desde CodePanel.'))return;
        try{await api.delete(`attachments/${Number(id)}`);invalidate('attachments');toast('Archivo eliminado');await navigate('files',{force:true});}catch(error){toast('No pudimos eliminarlo',error.message,'error');}
    }

    function setProjectData(id, changes) {
        const projectId = Number(id);
        const apply = list => {
            if (!Array.isArray(list)) return;
            const index = list.findIndex(item => Number(item.id) === projectId);
            if (index >= 0) list[index] = { ...list[index], ...changes };
        };
        apply(state.cache.get('projects')?.data);
        if (state.pageData.projects !== state.cache.get('projects')?.data) apply(state.pageData.projects);
        const previewProject = state.projectPreview.data?.project;
        if (previewProject && Number(previewProject.id) === projectId) state.projectPreview.data.project = { ...previewProject, ...changes };
        state.dashboard = null;
        state.dashboardAt = 0;
    }

    function repaintProjectsAndPreview() {
        if (state.route === 'projects') paintCollection('projects', state.pageData.projects || state.cache.get('projects')?.data || []);
        if (dom.projectPreviewDialog?.open && state.projectPreview.data) renderProjectPreview(state.projectPreview.data);
    }

    async function toggleProjectPin(id) {
        const projectId = Number(id);
        const key = `pin:${projectId}`;
        if (!projectId || state.projectMutations.has(key)) return;
        const project = (state.cache.get('projects')?.data || []).find(item => Number(item.id) === projectId)
            || state.projectPreview.data?.project;
        if (!project) return;
        const previous = isProjectPinned(project);
        state.projectMutations.add(key);
        setProjectData(projectId, { pinned: !previous });
        repaintProjectsAndPreview();
        try {
            const payload = await api.patch(`projects/${projectId}`, { pinned: !previous });
            setProjectData(projectId, payload.data || { pinned: !previous });
            repaintProjectsAndPreview();
            toast(!previous ? 'Proyecto fijado' : 'Proyecto desfijado', !previous ? 'Ahora aparece primero en tu cartera.' : 'Volvió al orden habitual.');
        } catch (error) {
            setProjectData(projectId, { pinned: previous });
            repaintProjectsAndPreview();
            toast('No pudimos cambiar el fijado', error.message, 'error');
        } finally { state.projectMutations.delete(key); }
    }

    async function updateProjectStatus(id, status) {
        const allowed = ['planned','active','on_hold','completed','archived'];
        const projectId = Number(id);
        const key = `status:${projectId}`;
        if (!projectId || !allowed.includes(status) || state.projectMutations.has(key)) return;
        const project = (state.cache.get('projects')?.data || []).find(item => Number(item.id) === projectId)
            || state.projectPreview.data?.project;
        if (!project || project.status === status) return;
        const previous = project.status;
        state.projectMutations.add(key);
        state.kanban.savingId = projectId;
        setProjectData(projectId, { status });
        repaintProjectsAndPreview();
        try {
            const payload = await api.patch(`projects/${projectId}`, { status });
            setProjectData(projectId, payload.data || { status });
            state.cache.delete('attention');
            toast('Proyecto movido', `Ahora está en “${STATUS[status]}”.`);
        } catch (error) {
            setProjectData(projectId, { status: previous });
            toast('No pudimos mover el proyecto', `${error.message} Restauramos su estado anterior.`, 'error');
        } finally {
            state.projectMutations.delete(key);
            state.kanban.savingId = null;
            repaintProjectsAndPreview();
        }
    }

    async function uploadProjectPhotos(form) {
        const projectId = Number(form.dataset.projectPhotoForm);
        const input = form.querySelector('[name="file"]');
        const files = [...(input?.files || [])];
        const feedback = form.querySelector('[data-project-photo-feedback]');
        if (!projectId || !files.length) return;
        const invalid = files.find(file => !['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024);
        if (invalid) {
            feedback.textContent = 'Usa JPG, PNG, WEBP o GIF de hasta 10 MiB.';
            return;
        }
        input.disabled = true;
        try {
            for (let index = 0; index < files.length; index += 1) {
                feedback.textContent = `Subiendo ${index + 1} de ${files.length}…`;
                const body = new FormData();
                body.append('entity_type', 'projects');
                body.append('entity_id', String(projectId));
                body.append('file', files[index], files[index].name);
                await api.upload('attachments', body);
            }
            invalidate('attachments');
            toast(files.length === 1 ? 'Foto agregada' : 'Fotos agregadas', `${files.length} ${files.length === 1 ? 'imagen quedó vinculada' : 'imágenes quedaron vinculadas'} al proyecto.`);
            await openProjectPreview(projectId, { quiet: true });
        } catch (error) {
            feedback.textContent = error.message;
            toast('No pudimos subir las fotos', error.message, 'error');
        } finally { if (input?.isConnected) input.disabled = false; }
    }

    async function deleteProjectPhoto(id) {
        const projectId = Number(state.projectPreview.id);
        if (!await confirmAction('¿Eliminar esta foto?', 'Se borrará del hosting y ya no aparecerá en la galería del proyecto.')) return;
        try {
            await api.delete(`attachments/${Number(id)}`);
            invalidate('attachments');
            toast('Foto eliminada');
            if (projectId) await openProjectPreview(projectId, { quiet: true });
        } catch (error) { toast('No pudimos eliminar la foto', error.message, 'error'); }
    }

    async function changeProjectShare(action, trigger) {
        const projectId = Number(state.projectPreview.id);
        if (!projectId || state.projectShareMutation || !['enable','disable','regenerate'].includes(action)) return;
        if (action === 'disable' && !await confirmAction('¿Desactivar el enlace público?', 'Quien tenga el enlace dejará de poder abrirlo. El feedback recibido se conservará.')) return;
        if (action === 'regenerate' && !await confirmAction('¿Generar un enlace nuevo?', 'El enlace anterior dejará de funcionar de inmediato.')) return;
        state.projectShareMutation = true;
        if (trigger) trigger.disabled = true;
        try {
            await api.post(`project-shares/${projectId}/${action}`, {});
            const labels = {
                enable: ['Enlace público creado', 'Ya puedes copiarlo y compartirlo.'],
                disable: ['Enlace público desactivado', 'Los reportes anteriores siguen guardados.'],
                regenerate: ['Enlace renovado', 'El enlace anterior dejó de funcionar.'],
            };
            toast(labels[action][0], labels[action][1]);
            await openProjectPreview(projectId, { quiet: true });
        } catch (error) {
            toast('No pudimos actualizar el enlace', error.message, 'error');
        } finally {
            state.projectShareMutation = false;
            if (trigger?.isConnected) trigger.disabled = false;
        }
    }

    async function copyProjectShareLink() {
        const share = state.projectPreview.data?.public_share || {};
        const url = projectShareUrl(share);
        if (!url) return;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(url);
            } else {
                const input = dom.projectPreviewContent.querySelector('[id^="project-share-url-"]');
                if (!input) throw new Error('No se encontró el enlace.');
                input.focus();
                input.select();
                if (!document.execCommand('copy')) throw new Error('El navegador no permitió copiar.');
                input.setSelectionRange(0, 0);
            }
            toast('Enlace copiado', 'Ya está listo para enviarlo.');
        } catch {
            const input = dom.projectPreviewContent.querySelector('[id^="project-share-url-"]');
            if (input) {
                input.focus();
                input.select();
            }
            toast('No pudimos copiarlo', 'Selecciona el enlace y cópialo a mano.', 'error');
        }
    }

    async function shareProjectLink() {
        const share = state.projectPreview.data?.public_share || {};
        const project = state.projectPreview.data?.project || {};
        const url = projectShareUrl(share);
        if (!url) return;
        if (typeof navigator.share !== 'function') return copyProjectShareLink();
        try {
            await navigator.share({
                title: `${project.name || 'Proyecto'} · Portal de revisión`,
                text: `Te comparto el portal de revisión de ${project.name || 'este proyecto'}.`,
                url,
            });
        } catch (error) {
            if (error?.name !== 'AbortError') toast('No pudimos compartirlo', 'Puedes copiar el enlace a mano.', 'error');
        }
    }

    async function projectFeedbackToTask(id) {
        const projectId = Number(state.projectPreview.id);
        const feedbackId = Number(id);
        const item = state.projectPreview.data?.public_share?.items?.find(entry => Number(entry.id) === feedbackId);
        if (!projectId || !item) return;
        const type = FEEDBACK_TYPES[item.type] || 'Feedback';
        const summary = String(item.message || '').trim();
        const shortTitle = summary.split(/\r?\n/)[0].slice(0, 135);
        const reference = feedbackReference(item);
        closeProjectPreview();
        await openEntityDialog('task', null, {
            project_id: projectId,
            title: `${type}: ${shortTitle || reference || 'revisar reporte'}`.slice(0, 180),
            description: `${reference ? `${reference}\n\n` : ''}${summary}`.trim().slice(0, 5000),
            priority: item.type === 'error' ? 'high' : 'medium',
            status: 'todo',
            tags: ['feedback', item.type || 'comment'],
        });
    }

    async function updateProjectFeedbackStatus(id, status, select) {
        const projectId = Number(state.projectPreview.id);
        const feedbackId = Number(id);
        if (!projectId || !feedbackId || !Object.hasOwn(FEEDBACK_STATUSES, status)) return;
        const previous = state.projectPreview.data?.public_share?.items?.find(item => Number(item.id) === feedbackId)?.status || 'new';
        if (select) select.disabled = true;
        try {
            const response = await api.patch(`project-shares/${projectId}/feedback/${feedbackId}`, { status });
            const updated = response.data || {};
            const share = state.projectPreview.data?.public_share;
            if (share && Array.isArray(share.items)) {
                const index = share.items.findIndex(item => Number(item.id) === feedbackId);
                if (index >= 0) share.items[index] = { ...share.items[index], ...updated, status };
                const summary = share.summary || share.feedback;
                if (summary && previous !== status) {
                    summary[previous] = Math.max(0, Number(summary[previous] || 0) - 1);
                    summary[status] = Number(summary[status] || 0) + 1;
                }
            }
            const current = state.projectPreview.data?.public_share?.items?.find(item => Number(item.id) === feedbackId);
            const article = dom.projectPreviewContent.querySelector(`[data-project-feedback-item="${feedbackId}"]`);
            if (article && current) article.outerHTML = projectFeedbackItem(current);
            const summary = state.projectPreview.data?.public_share?.summary || state.projectPreview.data?.public_share?.feedback || {};
            const pending = Number(summary.new || 0) + Number(summary.in_review || 0);
            const pendingNode = dom.projectPreviewContent.querySelector('[data-project-share-pending]');
            if (pendingNode) {
                pendingNode.hidden = pending === 0;
                pendingNode.textContent = `${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}`;
            }
            toast('Estado actualizado', `El reporte quedó “${FEEDBACK_STATUSES[status].toLowerCase()}”.`);
            requestAnimationFrame(() => dom.projectPreviewContent.querySelector(`[data-project-feedback-status="${feedbackId}"]`)?.focus());
        } catch (error) {
            if (select?.isConnected) select.value = previous;
            toast('No pudimos actualizar el reporte', error.message, 'error');
        } finally { if (select?.isConnected) select.disabled = false; }
    }

    async function deleteProjectFeedback(id) {
        const projectId = Number(state.projectPreview.id);
        const feedbackId = Number(id);
        if (!projectId || !feedbackId) return;
        if (!await confirmAction('¿Eliminar este reporte?', 'También se borrarán definitivamente las imágenes que contiene.')) return;
        try {
            await api.delete(`project-shares/${projectId}/feedback/${feedbackId}`);
            toast('Reporte eliminado');
            await openProjectPreview(projectId, { quiet: true });
        } catch (error) { toast('No pudimos eliminar el reporte', error.message, 'error'); }
    }

    function closeProjectPreview() {
        if (dom.projectPreviewDialog?.open) dom.projectPreviewDialog.close();
    }

    function clearKanbanDropTargets() {
        document.querySelectorAll('.kanban-column.is-drop-target').forEach(column => column.classList.remove('is-drop-target'));
    }

    function bindKanbanEvents() {
        document.addEventListener('pointerdown', event => {
            state.kanban.blockDrag = Boolean(event.target.closest('button,select,input,label,a'));
        }, true);
        document.addEventListener('pointerup', () => { state.kanban.blockDrag = false; }, true);
        document.addEventListener('dragstart', event => {
            const card = event.target.closest?.('[data-kanban-project]');
            if (!card) return;
            if (state.kanban.blockDrag) { event.preventDefault(); return; }
            const id = Number(card.dataset.kanbanProject);
            if (!id) { event.preventDefault(); return; }
            state.kanban.draggedId = id;
            state.kanban.sourceStatus = card.dataset.projectStatus;
            card.classList.add('is-dragging');
            card.setAttribute('aria-grabbed', 'true');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(id));
        });
        document.addEventListener('dragover', event => {
            const column = event.target.closest?.('[data-kanban-status]');
            if (!column || !state.kanban.draggedId) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            clearKanbanDropTargets();
            column.classList.add('is-drop-target');
        });
        document.addEventListener('dragleave', event => {
            const column = event.target.closest?.('[data-kanban-status]');
            if (column && !column.contains(event.relatedTarget)) column.classList.remove('is-drop-target');
        });
        document.addEventListener('drop', event => {
            const column = event.target.closest?.('[data-kanban-status]');
            if (!column || !state.kanban.draggedId) return;
            event.preventDefault();
            const id = state.kanban.draggedId;
            const status = column.dataset.kanbanStatus;
            state.kanban.suppressClickUntil = Date.now() + 500;
            state.kanban.draggedId = null;
            state.kanban.sourceStatus = null;
            state.kanban.blockDrag = false;
            clearKanbanDropTargets();
            updateProjectStatus(id, status);
        });
        document.addEventListener('dragend', event => {
            const card = event.target.closest?.('[data-kanban-project]');
            card?.classList.remove('is-dragging');
            card?.setAttribute('aria-grabbed', 'false');
            clearKanbanDropTargets();
            state.kanban.draggedId = null;
            state.kanban.sourceStatus = null;
            state.kanban.blockDrag = false;
        });
    }

    function bindGlobalEvents() {
        bindKanbanEvents();
        window.addEventListener('hashchange', () => navigate(location.hash.slice(1) || 'dashboard'));
        dom.sidebarButtons.forEach(button => button.addEventListener('click', openSidebar)); dom.sidebarClose.addEventListener('click', closeSidebar); dom.scrim.addEventListener('click', closeSidebar);
        dom.quickCreate.addEventListener('click', event => { event.stopPropagation(); const hidden = dom.createMenu.hidden; closeDropdowns(); dom.createMenu.hidden = !hidden; dom.quickCreate.setAttribute('aria-expanded',String(hidden)); });
        dom.profileButton.addEventListener('click', event => { event.stopPropagation(); const hidden = dom.profileMenu.hidden; closeDropdowns(); dom.profileMenu.hidden = !hidden; dom.profileButton.setAttribute('aria-expanded',String(hidden)); });
        document.querySelector('#theme-button').addEventListener('click', toggleTheme);
        const markScrolled = () => document.documentElement.classList.toggle('lg-scrolled', window.scrollY > 4);
        window.addEventListener('scroll', markScrolled, { passive: true }); markScrolled();
        document.querySelector('#search-trigger').addEventListener('click', openSearch);
        dom.entityForm.addEventListener('submit', submitEntityForm);
        dom.dialogDelete.addEventListener('click', () => {
            const { entity, id } = state.form;
            if (entity && id !== null) deleteEntity(entity, id, true);
        });
        dom.authForm.addEventListener('submit', submitAuth);
        document.addEventListener('submit', event => {
            if (event.target.matches('[data-project-photo-form]')) { event.preventDefault(); uploadProjectPhotos(event.target); }
            if (event.target.matches('#settings-form')) { event.preventDefault(); saveSettingsForm(event.target); }
            if (event.target.matches('#dashboard-settings-form')) { event.preventDefault(); saveDashboardSettings(event.target); }
            if (event.target.matches('[data-token-form]')) { event.preventDefault(); createApiToken(event.target); }
            if (event.target.matches('#attachment-form')) { event.preventDefault(); uploadAttachment(event.target); }
        });
        dom.searchInput.addEventListener('input', event => renderSearchResults(event.target.value));
        dom.searchInput.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); dom.searchDialog.close(); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveSearchSelection(event.key === 'ArrowDown' ? 1 : -1); return; }
            if (event.key === 'Enter') { const selected = dom.searchResults.querySelector('.search-result.is-selected') || dom.searchResults.querySelector('.search-result'); if (selected) { event.preventDefault(); selected.click(); } }
        });
        dom.searchDialog.addEventListener('click', event => { if (event.target === dom.searchDialog) dom.searchDialog.close(); });
        dom.entityDialog.addEventListener('click', event => { if (event.target === dom.entityDialog) dom.entityDialog.close(); });
        dom.entityDialog.addEventListener('close', () => { const back = state.formReturn; state.formReturn = null; if (back) returnToPreview(back); });
        dom.projectPreviewDialog?.addEventListener('click', event => { if (event.target === dom.projectPreviewDialog) closeProjectPreview(); });
        dom.projectPreviewDialog?.addEventListener('close', () => {
            state.projectPreview.requestId += 1;
            state.projectPreview.id = null;
            state.projectPreview.data = null;
        });
        dom.recordPreviewDialog?.addEventListener('click', event => { if (event.target === dom.recordPreviewDialog) closeRecordPreview(); });
        dom.recordPreviewDialog?.addEventListener('close', () => {
            state.recordPreview.requestId += 1;
            state.recordPreview.entity = null;
            state.recordPreview.id = null;
            state.recordPreview.record = null;
        });

        document.addEventListener('input', event => {
            if (event.target.matches('[data-filter-search]')) filterSearch(event.target.dataset.filterSearch,event.target.value);
            if (event.target.matches('[data-range]')) event.target.parentElement.querySelector('output').value = event.target.value;
            if (event.target.matches('[data-file-search]')) { state.filters.files.search=event.target.value; paintCollection('files',state.pageData.files||[]); const input=document.querySelector('[data-file-search]'); input?.focus(); input?.setSelectionRange(event.target.value.length,event.target.value.length); }
        });
        document.addEventListener('change', event => {
            if (event.target.matches('[data-project-filter]')) {
                const key = event.target.dataset.projectFilter;
                if (Object.hasOwn(state.filters.projects, key)) state.filters.projects[key] = event.target.value;
                paintCollection('projects', state.pageData.projects || state.cache.get('projects')?.data || []);
                document.querySelector(`[data-project-filter="${key}"]`)?.focus();
            }
            if (event.target.matches('[data-filter-status]')) { const route = event.target.dataset.filterStatus; state.filters[route].status = event.target.value; paintCollection(route,state.pageData[route] || state.cache.get(route)?.data || []); }
            if (event.target.matches('[data-task-status-select]')) updateTaskStatus(event.target.dataset.taskStatusSelect, event.target.value);
            if (event.target.matches('[data-kanban-status-select]')) updateProjectStatus(event.target.dataset.kanbanStatusSelect, event.target.value);
            if (event.target.matches('[data-project-feedback-status]')) updateProjectFeedbackStatus(event.target.dataset.projectFeedbackStatus,event.target.value,event.target);
            if (event.target.matches('[name="project_type"]')) syncProjectTypeFields(event.target.closest('#dialog-fields') || dom.dialogFields);
            if (event.target.matches('[data-project-photo-form] [type="file"]')) {
                const feedback = event.target.closest('form')?.querySelector('[data-project-photo-feedback]');
                const count = event.target.files?.length || 0;
                if (feedback) feedback.textContent = count ? `${count} ${count === 1 ? 'foto seleccionada' : 'fotos seleccionadas'}.` : '';
            }
            if (event.target.matches('#attachment-form [type="file"]')) { const file=event.target.files?.[0]; const label=event.target.closest('form')?.querySelector('[data-file-name]'); if(label)label.textContent=file?`${file.name} · ${bytesLabel(file.size)}`:'Ningún archivo elegido'; }
            if (event.target.matches('[data-file-project]')) { state.filters.files.project=event.target.value; paintCollection('files',state.pageData.files||[]); document.querySelector('[data-file-project]')?.focus(); }
            if (event.target.matches('[data-file-entity]')) { state.filters.files.status=event.target.value; paintCollection('files',state.pageData.files||[]); document.querySelector('[data-file-entity]')?.focus(); }
            if (event.target.matches('#dashboard-settings-form [type="checkbox"]')) { const row=event.target.closest('[data-widget-key]'); row?.classList.toggle('is-disabled',!event.target.checked); const hint=row?.querySelector('label small'); if(hint)hint.textContent=event.target.checked?'Visible en el dashboard':'Oculto'; }
        });
        document.addEventListener('keydown', handleShortcut);
        document.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.matches?.('[data-check-text]')) { event.preventDefault(); addChecklistRow(event.target.closest('.checklist-row')); } });
        bindTaskBoard();
        bindCustomSelects();
        document.addEventListener('keydown', event => {
            if (event.key === '/' && !event.ctrlKey && !event.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { event.preventDefault(); openSearch(); }
            if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-edit][role="button"]')) { event.preventDefault(); event.target.click(); }
            if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-project-preview][role="button"]')) { event.preventDefault(); event.target.click(); }
            if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-record-preview][role="button"]')) { event.preventDefault(); event.target.click(); }
            if (event.key === 'Escape') { closeDropdowns(); closeSidebar(); }
        });
        document.addEventListener('click', async event => {
            const nav = event.target.closest('[data-nav]');
            if (nav) { event.preventDefault(); const route = nav.dataset.nav; history.pushState(null,'',`#${route}`); navigate(route); return; }
            const navButton = event.target.closest('[data-nav-button]');
            if (navButton) { const route = navButton.dataset.navButton; history.pushState(null,'',`#${route}`); navigate(route); return; }
            const recordPreviewClose = event.target.closest('[data-record-preview-close]'); if (recordPreviewClose) { closeRecordPreview(); return; }
            const recordPreviewRetry = event.target.closest('[data-record-preview-retry]'); if (recordPreviewRetry) { await openRecordPreview(recordPreviewRetry.dataset.recordPreviewRetry,recordPreviewRetry.dataset.id); return; }
            const recordPreviewEdit = event.target.closest('[data-record-preview-edit]'); if (recordPreviewEdit) { const entity=recordPreviewEdit.dataset.recordPreviewEdit; const id=recordPreviewEdit.dataset.id; state.formReturn = rememberPreview(); closeRecordPreview(); await openEntityDialog(entity,id); return; }
            const previewRelated = event.target.closest('[data-preview-related]'); if (previewRelated) { await openRecordPreview(previewRelated.dataset.previewRelated,previewRelated.dataset.id); return; }
            const previewClose = event.target.closest('[data-project-preview-close]'); if (previewClose) { closeProjectPreview(); return; }
            const previewRetry = event.target.closest('[data-project-preview-retry]'); if (previewRetry) { await openProjectPreview(previewRetry.dataset.projectPreviewRetry); return; }
            const previewEdit = event.target.closest('[data-project-preview-edit]'); if (previewEdit) { const id=previewEdit.dataset.projectPreviewEdit; state.formReturn = rememberPreview(); closeProjectPreview(); await openEntityDialog('project',id); return; }
            const photoDelete = event.target.closest('[data-project-photo-delete]'); if (photoDelete) { await deleteProjectPhoto(photoDelete.dataset.projectPhotoDelete); return; }
            const shareAction = event.target.closest('[data-project-share-action]'); if (shareAction) { await changeProjectShare(shareAction.dataset.projectShareAction,shareAction); return; }
            const shareCopy = event.target.closest('[data-project-share-copy]'); if (shareCopy) { await copyProjectShareLink(); return; }
            const shareNative = event.target.closest('[data-project-share-native]'); if (shareNative) { await shareProjectLink(); return; }
            const feedbackRetry = event.target.closest('[data-project-feedback-retry]'); if (feedbackRetry) { await openProjectPreview(state.projectPreview.id, { quiet: true }); return; }
            const feedbackTask = event.target.closest('[data-project-feedback-task]'); if (feedbackTask) { await projectFeedbackToTask(feedbackTask.dataset.projectFeedbackTask); return; }
            const feedbackDelete = event.target.closest('[data-project-feedback-delete]'); if (feedbackDelete) { await deleteProjectFeedback(feedbackDelete.dataset.projectFeedbackDelete); return; }
            const projectPin = event.target.closest('[data-project-pin]'); if (projectPin) { await toggleProjectPin(projectPin.dataset.projectPin); return; }
            const create = event.target.closest('[data-create]'); if (create) {
                const prefill = create.dataset.prefillBudget
                    ? { budget_id: Number(create.dataset.prefillBudget) }
                    : create.dataset.prefillProject
                        ? { project_id: Number(create.dataset.prefillProject) }
                        : null;
                state.formReturn = create.closest('#project-preview-dialog, #record-preview-dialog') ? rememberPreview() : null;
                if (create.closest('#project-preview-dialog')) closeProjectPreview();
                if (create.closest('#record-preview-dialog')) closeRecordPreview();
                await openEntityDialog(create.dataset.create,null,prefill); return;
            }
            const edit = event.target.closest('[data-edit]'); if (edit) { state.formReturn = edit.closest('#project-preview-dialog, #record-preview-dialog') ? rememberPreview() : null; if (edit.closest('#project-preview-dialog')) closeProjectPreview(); if (edit.closest('#record-preview-dialog')) closeRecordPreview(); await openEntityDialog(edit.dataset.edit,edit.dataset.id); return; }
            const remove = event.target.closest('[data-delete]'); if (remove) { await deleteEntity(remove.dataset.delete,remove.dataset.id); return; }
            const duplicate = event.target.closest('[data-duplicate]'); if (duplicate) { await duplicateEntity(duplicate.dataset.duplicate,duplicate.dataset.id); return; }
            const menu = event.target.closest('[data-card-menu]'); if (menu) { event.stopPropagation(); const popup = menu.closest('[data-record]')?.querySelector('.card-actions-menu'); const hidden = popup?.hidden; closeDropdowns(); if (popup) popup.hidden = !hidden; return; }
            if (event.target.closest('.kanban-card-controls')) return;
            const projectPreview = event.target.closest('[data-project-preview]'); if (projectPreview) { if (Date.now() < state.kanban.suppressClickUntil) return; await openProjectPreview(projectPreview.dataset.projectPreview); return; }
            const retry = event.target.closest('[data-retry]'); if (retry) { navigate(state.route,{force:true}); return; }
            const clear = event.target.closest('[data-clear-filters]'); if (clear) { const route = clear.dataset.clearFilters; state.filters[route].search=''; state.filters[route].status='all'; if(route==='files')state.filters.files.project='all'; if(route==='projects')Object.assign(state.filters.projects,{type:'all',priority:'all',tech:'all',pinned:'all'}); paintCollection(route,state.pageData[route] || state.cache.get(route)?.data || []); return; }
            const view = event.target.closest('[data-project-view]'); if (view) { state.filters.projects.view = view.dataset.projectView; localStorage.setItem('cp-project-view',view.dataset.projectView); paintCollection('projects',state.cache.get('projects')?.data || []); return; }
            const toggle = event.target.closest('[data-task-toggle]'); if (toggle) { await toggleTask(toggle.dataset.taskToggle); return; }
            const reminderStatus=event.target.closest('[data-reminder-status]'); if(reminderStatus){await changeReminderStatus(reminderStatus.dataset.id,reminderStatus.dataset.reminderStatus,reminderStatus);return;}
            const timerStart=event.target.closest('[data-timer-start]'); if(timerStart){await openEntityDialog('time_entry',null,{timer_start:true,work_date:todayISO(),billable:1});return;}
            const timerStop=event.target.closest('[data-timer-stop]'); if(timerStop){await stopTimer(timerStop.dataset.timerStop,timerStop);return;}
            const sourceOpen=event.target.closest('[data-source-open]'); if(sourceOpen){await openSource(sourceOpen.dataset.sourceOpen,sourceOpen.dataset.id);return;}
            const calendarMove=event.target.closest('[data-calendar-move]'); if(calendarMove){state.calendarMonth=new Date(state.calendarMonth.getFullYear(),state.calendarMonth.getMonth()+Number(calendarMove.dataset.calendarMove),1);state.calendarDay=dateISO(state.calendarMonth);await navigate('calendar',{force:true});return;}
            const calendarToday=event.target.closest('[data-calendar-today]'); if(calendarToday){state.calendarDay=todayISO();const today=parseDate(state.calendarDay);state.calendarMonth=new Date(today.getFullYear(),today.getMonth(),1);await navigate('calendar',{force:true});return;}
            const calendarDay=event.target.closest('[data-calendar-day]'); if(calendarDay){state.calendarDay=calendarDay.dataset.calendarDay;const selected=parseDate(state.calendarDay);if(selected&&(selected.getMonth()!==state.calendarMonth.getMonth()||selected.getFullYear()!==state.calendarMonth.getFullYear())){state.calendarMonth=new Date(selected.getFullYear(),selected.getMonth(),1);await navigate('calendar',{force:true});}else paintCollection('calendar',state.pageData.calendar||[]);return;}
            const widgetMove=event.target.closest('[data-widget-move]'); if(widgetMove){const row=widgetMove.closest('[data-widget-key]');const sibling=Number(widgetMove.dataset.widgetMove)<0?row?.previousElementSibling:row?.nextElementSibling;if(row&&sibling){if(Number(widgetMove.dataset.widgetMove)<0)sibling.before(row);else sibling.after(row);updateWidgetMoveButtons(row.parentElement);row.focus?.();}return;}
            const dashboardReset=event.target.closest('[data-dashboard-reset]'); if(dashboardReset){try{const payload=await api.patch('settings',{dashboard_widgets:[...DEFAULT_WIDGETS]});state.settings=payload.data||{...(state.settings||{}),dashboard_widgets:[...DEFAULT_WIDGETS]};toast('Diseño restaurado');await navigate('dashboard-settings',{force:true});}catch(error){toast('No pudimos restaurarlo',error.message,'error');}return;}
            const attachmentDelete=event.target.closest('[data-attachment-delete]'); if(attachmentDelete){await deleteAttachment(attachmentDelete.dataset.attachmentDelete);return;}
            const focusUpload=event.target.closest('[data-focus-upload]'); if(focusUpload){document.querySelector('#attachment-form [type="file"]')?.click();return;}
            const uploadOpen=event.target.closest('[data-upload-open]'); if(uploadOpen){history.pushState(null,'','#files');await navigate('files');document.querySelector('#attachment-form [type="file"]')?.click();return;}
            const tagSuggest=event.target.closest('[data-tag-suggest]'); if(tagSuggest){const input=tagSuggest.closest('.form-field')?.querySelector('[name="tags"]');if(input){const values=asArray(input.value);if(!values.includes(tagSuggest.dataset.tagSuggest))values.push(tagSuggest.dataset.tagSuggest);input.value=values.slice(0,30).join(', ');input.focus();}return;}
            const dialogClose = event.target.closest('[data-dialog-close]'); if (dialogClose) { dom.entityDialog.close(); return; }
            const authMode = event.target.closest('[data-auth-mode]'); if (authMode) { setAuthMode(authMode.dataset.authMode); return; }
            const profileAction = event.target.closest('[data-profile-action]'); if (profileAction) { if (profileAction.dataset.profileAction === 'logout') await logout(); return; }
            const checkAdd = event.target.closest('[data-check-add]'); if (checkAdd) { addChecklistRow(); return; }
            const checkRemove = event.target.closest('[data-check-remove]'); if (checkRemove) { const row = checkRemove.closest('.checklist-row'); const next = row?.nextElementSibling || row?.previousElementSibling; row?.remove(); (next?.querySelector('[data-check-text]') || dom.entityForm.querySelector('[data-check-add]'))?.focus(); return; }
            const subtask = event.target.closest('[data-subtask-toggle]'); if (subtask) { await toggleSubtask(subtask.dataset.subtaskToggle, subtask.dataset.index); return; }
            const copySnippetButton = event.target.closest('[data-copy-snippet]'); if (copySnippetButton) { event.stopPropagation(); await copySnippet(copySnippetButton.dataset.copySnippet, copySnippetButton); return; }
            const copyValue = event.target.closest('[data-copy-value]'); if (copyValue) { const ok = await copyText(copyValue.dataset.copyValue); toast(ok ? 'Copiado' : 'No pudimos copiarlo', ok ? 'Guárdalo en un lugar seguro.' : 'Selecciona el texto y cópialo a mano.', ok ? 'success' : 'error'); return; }
            const tokenRevoke = event.target.closest('[data-token-revoke]'); if (tokenRevoke) { await revokeApiToken(tokenRevoke.dataset.tokenRevoke, tokenRevoke.dataset.tokenName); return; }
            const command = event.target.closest('[data-command]'); if (command) { const action = paletteCommands().find(item => item.id === command.dataset.command); dom.searchDialog.close(); if (action) await action.run(); return; }
            const exportButton = event.target.closest('[data-export]'); if (exportButton) { await exportData(exportButton.dataset.export, exportButton); return; }
            const taskTimer = event.target.closest('[data-task-timer]'); if (taskTimer) { event.stopPropagation(); await startTimerForTask(taskTimer.dataset.taskTimer); return; }
            const taskView = event.target.closest('[data-task-view]'); if (taskView) { state.filters.tasks.view = taskView.dataset.taskView; try { localStorage.setItem('cp-task-view', taskView.dataset.taskView); } catch {} paintCollection('tasks', state.cache.get('tasks')?.data || []); return; }
            const searchOpen = event.target.closest('[data-search-open]'); if (searchOpen) { dom.searchDialog.close(); const entity=entityFromRoute(searchOpen.dataset.searchOpen); const route=ENTITY_PAGE[entity]; if(!route)return; history.pushState(null,'',`#${route}`); await navigate(route); if(entity==='project')await openProjectPreview(searchOpen.dataset.id);else await openRecordPreview(entity,searchOpen.dataset.id); return; }
            const recordPreview = event.target.closest('[data-record-preview]');
            if (recordPreview) {
                const interactive = event.target.closest('a,button,input,select,textarea,label');
                if (interactive && !interactive.hasAttribute('data-record-preview')) return;
                await openRecordPreview(recordPreview.dataset.recordPreview,recordPreview.dataset.id || recordPreview.closest('[data-id]')?.dataset.id);
                return;
            }
            if (!event.target.closest('.create-menu,.profile-menu,.card-actions-menu')) closeDropdowns();
        });
    }

})();
