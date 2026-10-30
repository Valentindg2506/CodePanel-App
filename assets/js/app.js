(() => {
    'use strict';

    const API_BASE = 'api/index.php';
    const ROUTES = ['dashboard', 'projects', 'ideas', 'tasks', 'reminders', 'calendar', 'devlogs', 'clients', 'leads', 'budgets', 'releases', 'resources', 'time', 'profitability', 'weekly', 'files', 'tags', 'dashboard-settings', 'settings'];
    const ENTITY_ROUTE = {
        project: 'projects', idea: 'ideas', task: 'tasks', devlog: 'devlogs', client: 'clients', lead: 'leads',
        budget: 'budgets', payment: 'payments', release: 'releases', resource: 'resources', reminder: 'reminders',
        time_entry: 'time_entries', weekly_review: 'weekly_reviews', tag: 'tags',
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
            tasks: { search: '', status: 'all' },
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
    const ROUTE_NAMES = { dashboard: 'Panorama', projects: 'Proyectos', ideas: 'Semillero', tasks: 'Tareas', reminders: 'Recordatorios', calendar: 'Calendario', devlogs: 'Bitácora', clients: 'Clientes', leads: 'Oportunidades', budgets: 'Presupuestos y cobros', releases: 'Entregas y versiones', resources: 'Recursos e infraestructura', time: 'Control de tiempo', profitability: 'Rentabilidad', weekly: 'Revisión semanal', files: 'Archivos y documentación', tags: 'Etiquetas', 'dashboard-settings': 'Personalizar inicio', settings: 'Configuración' };
    const ENTITY_NAMES = { project: 'proyecto', idea: 'idea', task: 'tarea', devlog: 'entrada', client: 'cliente', lead: 'oportunidad', budget: 'presupuesto', payment: 'cobro', release: 'entrega', resource: 'recurso', reminder: 'recordatorio', time_entry: 'registro de tiempo', weekly_review: 'revisión semanal', tag: 'etiqueta' };
    const RECORD_PREVIEW_ENTITIES = new Set(['idea','task','reminder','devlog','client','lead','budget','payment','release','resource','time_entry','weekly_review','attachment','tag']);
    const RECORD_PREVIEW_LABELS = {
        idea: 'Idea', task: 'Tarea', reminder: 'Recordatorio', devlog: 'Bitácora', client: 'Cliente',
        lead: 'Oportunidad', budget: 'Presupuesto', payment: 'Cobro', release: 'Entrega y versión',
        resource: 'Recurso e infraestructura', time_entry: 'Registro de tiempo', weekly_review: 'Revisión semanal',
        attachment: 'Archivo', tag: 'Etiqueta',
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
        return formatDate(value);
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
            spark: '<path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3ZM19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/>',
            pin: '<path d="m8 4h8l-1 5 3 3v1H6v-1l3-3-1-5ZM12 13v8"/>',
            image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 3 3 2-2 6 5"/>',
            drag: '<path d="M8 5h.01M8 12h.01M8 19h.01M16 5h.01M16 12h.01M16 19h.01"/>',
        };
        return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name] || paths.spark}</svg>`;
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
                throw new ApiError('No pudimos conectar con CodePanel. Revisá tu conexión e intentá otra vez.');
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
        if (entity === 'project') return ['tasks', 'devlogs', 'budgets', 'releases', 'resources', 'reminders', 'time_entries', 'attachments', 'attention'];
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
        dom.view.setAttribute('aria-busy', 'true');
        dom.view.innerHTML = `<div class="page-skeleton" aria-label="Cargando"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-subtitle"></div><div class="skeleton-grid"><div></div><div></div><div></div><div></div></div><div class="skeleton skeleton-panel"></div></div>`;
    }

    function renderError(error) {
        dom.view.setAttribute('aria-busy', 'false');
        dom.view.innerHTML = `<div class="empty-state error-state"><div class="empty-inner"><div class="empty-art"><span>!</span></div><h2>No pudimos abrir esta página</h2><p>${escapeHTML(error?.message || 'Ocurrió algo inesperado.')}</p><button class="button button-secondary" type="button" data-retry>${icon('arrow')} Volver a intentar</button></div></div>`;
    }

    function emptyState(entity, title, copy) {
        return `<div class="empty-state"><div class="empty-inner"><div class="empty-art"><span>＋</span></div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(copy)}</p><button class="button button-primary" type="button" data-create="${entity}">Crear ${ENTITY_NAMES[entity]}</button></div></div>`;
    }

    function pageHeading(eyebrow, title, copy, entity, secondary = '') {
        return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">${escapeHTML(eyebrow)}</span><h1>${title}</h1><p>${escapeHTML(copy)}</p></div><div class="heading-actions">${secondary}<button class="button button-primary" type="button" data-create="${entity}"><span aria-hidden="true">＋</span> Nuevo ${ENTITY_NAMES[entity]}</button></div></header>`;
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
            <div><h3><button class="task-title-button" type="button" data-record-preview="task" data-id="${Number(task.id)}">${escapeHTML(task.title || 'Tarea sin título')}</button></h3>${compact ? `<p>${escapeHTML(task.project_name || 'Tarea independiente')}</p>` : `<div class="task-meta"><span>${escapeHTML(task.project_name || 'Sin proyecto')}</span><span>${escapeHTML(PRIORITY[task.priority] || 'Media')}</span></div>`}</div>
            ${dueMarkup(task.due_date)}
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
            const name = String(state.user?.name || 'creador').split(' ')[0];
            const hour = Number(new Intl.DateTimeFormat('en-US',{hour:'2-digit',hourCycle:'h23',timeZone:state.settings?.timezone||undefined}).formatToParts(new Date()).find(part=>part.type==='hour')?.value || new Date().getHours());
            const greeting = hour < 12 ? 'Buen día' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
            const date = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone:state.settings?.timezone||undefined }).format(new Date());
            const widgetOrder = sanitizeWidgetOrder(state.settings?.dashboard_widgets);
            const upcomingReminders = reminders.filter(item => item.status === 'pending').sort((a,b) => String(a.due_at).localeCompare(String(b.due_at))).slice(0, 5);
            const week = weekBounds(new Date());
            const weekMinutes = timeEntries.filter(item => item.work_date >= week.start && item.work_date <= week.end).reduce((sum,item) => sum + elapsedMinutes(item), 0);
            const widgets = {
                overview: `<div class="metric-grid dashboard-widget is-wide" data-dashboard-widget="overview">
                    ${metricCard('Proyectos activos', stats.active_projects ?? 0, `${stats.project_progress ?? 0}% de avance promedio`, 'folder')}
                    ${metricCard('Tareas abiertas', stats.pending_tasks ?? 0, stats.overdue_tasks ? `${stats.overdue_tasks} necesitan atención` : 'Todo dentro de fecha', 'check')}
                    ${metricCard('Ideas guardadas', stats.ideas ?? 0, 'Tu semillero personal', 'bulb')}
                    ${metricCard('Relaciones activas', (stats.active_clients ?? 0) + (stats.open_leads ?? 0), `${stats.open_leads ?? 0} oportunidades abiertas`, 'users')}
                </div>`,
                projects: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Proyectos en foco</h2><p>Fijados, activos y recientes</p></div><button class="text-button" type="button" data-nav-button="projects">Ver todos →</button></div>${focus ? focusProject(focus) : '<div class="inline-empty">Todavía no hay un proyecto activo.</div>'}<div class="project-rows widget-project-rows">${orderedProjects.filter(item => !focus || Number(item.id) !== Number(focus.id)).slice(0, 3).map(projectRow).join('')}</div></section>`,
                tasks: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Próximas tareas</h2><p>Pequeños pasos que mueven todo</p></div><button class="text-button" type="button" data-create="task">＋</button></div><div class="task-list">${tasks.length ? tasks.slice(0, 5).map(task => taskRow(task, true)).join('') : '<div class="inline-empty">Tu lista está despejada.</div>'}</div></section>`,
                reminders: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Recordatorios próximos</h2><p>Lo que no conviene dejar pasar</p></div><button class="text-button" type="button" data-nav-button="reminders">Ver centro →</button></div><div class="compact-reminders">${upcomingReminders.length ? upcomingReminders.map(reminderCompact).join('') : '<div class="inline-empty">No hay alertas pendientes.</div>'}</div></section>`,
                time_tracking: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Tiempo de esta semana</h2><p>${escapeHTML(formatDate(week.start))} al ${escapeHTML(formatDate(week.end))}</p></div><button class="text-button" type="button" data-nav-button="time">Abrir control →</button></div><div class="widget-time-value">${escapeHTML(minutesLabel(weekMinutes))}</div><p class="muted-copy">${timeEntries.filter(item => item.work_date >= week.start && item.work_date <= week.end).length} registros de trabajo.</p></section>`,
                profitability: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Rentabilidad</h2><p>Ingresos menos costos registrados</p></div><button class="text-button" type="button" data-nav-button="profitability">Ver detalle →</button></div>${profitabilityWidget(profitability)}</section>`,
                calendar: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Agenda próxima</h2><p>Fechas que se acercan</p></div><button class="text-button" type="button" data-nav-button="calendar">Abrir calendario →</button></div><div class="compact-reminders">${upcomingReminders.length ? upcomingReminders.slice(0,4).map(reminderCompact).join('') : '<div class="inline-empty">La agenda está despejada.</div>'}</div></section>`,
                weekly_review: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Revisión semanal</h2><p>Aprender del ritmo de trabajo</p></div><button class="text-button" type="button" data-nav-button="weekly">Revisar semana →</button></div>${weeklyReviews.length ? `<strong class="review-widget-score">${clamp(weeklyReviews[0].rating,1,5)}/5</strong><p class="muted-copy">${escapeHTML(weeklyReviews[0].wins || 'Revisión guardada sin logros destacados.')}</p>` : '<div class="inline-empty">Todavía no cerraste esta semana.</div>'}</section>`,
                budgets: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Presupuestos y cobros</h2><p>Saldos separados por moneda</p></div><button class="text-button" type="button" data-nav-button="budgets">Abrir finanzas →</button></div><div class="finance-values widget-finance">${groupedMoney(budgets, 'balance')}</div></section>`,
                resources: `<section class="panel panel-padded dashboard-widget"><div class="panel-heading"><div><h2>Infraestructura</h2><p>Recursos que necesitan atención</p></div><button class="text-button" type="button" data-nav-button="resources">Ver inventario →</button></div><div class="widget-time-value">${resources.filter(item => item.status === 'attention' || (daysUntil(item.renewal_date) !== null && daysUntil(item.renewal_date) <= 30)).length}</div><p class="muted-copy">alertas entre estado y renovaciones próximas.</p></section>`,
            };

            dom.view.innerHTML = `
                <header class="page-heading">
                    <div class="page-heading-copy"><span class="eyebrow">Tu estudio de hoy</span><h1>${greeting}, <em>${escapeHTML(name)}</em>.</h1><p>Acá está lo importante: lo que avanza, lo que necesita atención y las ideas que no conviene perder.</p></div>
                    <div class="date-chip">${icon('calendar')}<span>${escapeHTML(date.charAt(0).toUpperCase() + date.slice(1))}</span></div>
                </header>
                ${state.demoMode ? `<div class="demo-banner"><span>Estás explorando datos de muestra</span><small>Todo lo que cambies se guarda solo durante esta sesión.</small></div>` : ''}
                <div class="dashboard-widget-grid">${widgetOrder.map(key => widgets[key] || '').join('')}</div>`;
            finishRender();
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
        return `<article class="focus-project" style="--coral:${color}"><div><div class="focus-kickers"><span class="focus-kicker">${escapeHTML(STATUS[project.status] || 'Proyecto')}</span>${projectTypeBadge(project, true)}${isProjectPinned(project) ? '<span class="focus-pinned">Fijado</span>' : ''}</div><h3>${escapeHTML(project.name)}</h3><p>${escapeHTML(project.description || 'Sin descripción todavía.')}</p><div class="focus-tags">${tags.slice(0, 4).map(tag => `<span>${escapeHTML(tag)}</span>`).join('')}</div><button class="text-button focus-action" type="button" data-project-preview="${Number(project.id)}">Abrir proyecto →</button></div><div class="progress-ring" style="--progress:${clamp(project.progress, 0, 100)}"><span>${clamp(project.progress, 0, 100)}%</span></div></article>`;
    }
    function projectRow(project) {
        const color = safeColor(project.color);
        const typeLabel = projectType(project) === 'commercial' ? 'Comercial' : 'Personal';
        return `<article class="project-row" role="button" tabindex="0" aria-label="Abrir proyecto ${escapeHTML(typeLabel.toLowerCase())}: ${escapeHTML(project.name)}" data-project-preview="${Number(project.id)}"><span class="project-color" style="--project-color:${color}"></span><div><h3>${isProjectPinned(project) ? '<span class="row-pin" aria-label="Fijado">◆</span>' : ''}${escapeHTML(project.name)}</h3><p>${escapeHTML(STATUS[project.status] || '')}<span class="project-type-inline"> · ${escapeHTML(typeLabel)}</span></p></div><div class="mini-progress" style="--project-color:${color}"><span style="--progress:${clamp(project.progress, 0, 100)}%"></span></div><span class="row-percent">${clamp(project.progress, 0, 100)}%</span></article>`;
    }
    function ideaPreview(idea) { return `<article class="idea-preview"><small>${escapeHTML(idea.category || STATUS[idea.status] || 'Idea')}</small><h3>${escapeHTML(idea.title)}</h3><p>${escapeHTML(idea.description || 'Una idea esperando más contexto.')}</p></article>`; }
    function followCard(lead, index) { const colors = ['var(--blue-wash)', 'var(--sage-wash)', 'var(--purple-wash)']; return `<article class="follow-card" role="button" tabindex="0" aria-label="Abrir oportunidad de ${escapeHTML(lead.name)}" data-record-preview="lead" data-id="${Number(lead.id)}"><span class="contact-initial" style="--avatar-color:${colors[index % colors.length]}">${initials(lead.name)}</span><div><strong>${escapeHTML(lead.name)}</strong><small>${escapeHTML(lead.company || 'Contacto independiente')}</small></div><span class="follow-date">${escapeHTML(dateDistance(lead.next_follow_up))}</span></article>`; }

    function finishRender() {
        dom.view.setAttribute('aria-busy', 'false');
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

    async function navigate(route, { force = false } = {}) {
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
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (clean === 'dashboard') return renderDashboard(force);
        return renderCollectionPage(clean, force);
    }

    async function boot() {
        bindGlobalEvents();
        restoreTheme();
        try {
            const session = (await api.get('auth/me')).data || {};
            state.user = session.user || null;
            state.csrf = session.csrf_token || '';
            state.demoMode = Boolean(session.demo_mode);
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
            weekly: renderWeeklyReviews, files: renderFiles, tags: renderTags, settings: renderSettings, 'dashboard-settings': renderDashboardSettings,
        };
        state.pageData[route] = data;
        dom.view.innerHTML = painters[route](data);
        finishRender();
        if (route === 'time') startTimerTicker(); else stopTimerTicker();
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
            ${viewToggle ? `<div class="segmented" aria-label="Vista"><button class="${filters.view === 'grid' ? 'is-active' : ''}" type="button" data-project-view="grid" aria-label="Vista de tarjetas">${icon('grid')}</button><button class="${filters.view === 'board' ? 'is-active' : ''}" type="button" data-project-view="board" aria-label="Vista por etapas">${icon('columns')}</button></div>` : ''}
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
            ? (items.length ? noFilterResults('projects') : emptyState('project', 'Tu primer proyecto empieza acá', 'Guardá el contexto, las fechas y el progreso sin perderte en planillas.'))
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
            : `<span class="personal-project-note">${icon('spark')}Proyecto propio</span><span>${escapeHTML(PRIORITY[project.priority] || 'Prioridad media')}</span>`;
        return `<article class="project-card${isProjectPinned(project) ? ' is-pinned' : ''}" style="--project-color:${color}" data-record="project" data-id="${Number(project.id)}" data-project-preview="${Number(project.id)}">
            <div class="card-topline"><div class="card-badges">${statusBadge(project.status)}${projectTypeBadge(project)}</div><div class="project-card-actions">${projectPinButton(project)}<button class="icon-button card-menu-button" type="button" data-card-menu aria-label="Opciones de ${escapeHTML(project.name)}">${icon('more')}</button></div></div>
            <div class="card-actions-menu" hidden><button type="button" data-edit="project" data-id="${Number(project.id)}">Editar</button><button type="button" data-duplicate="project" data-id="${Number(project.id)}">Duplicar</button><button class="danger" type="button" data-delete="project" data-id="${Number(project.id)}">Eliminar</button></div>
            <button class="card-content-button" type="button" data-project-preview="${Number(project.id)}" aria-label="Abrir vista de ${escapeHTML(project.name)}"><h2>${escapeHTML(project.name)}</h2><p class="description">${escapeHTML(project.description || 'Este proyecto todavía no tiene una descripción.')}</p></button>
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
        return `<div class="kanban-help" role="note"><span>${icon('drag')}</span><p><strong>Mové el trabajo a medida que avanza.</strong> Arrastrá una tarjeta entre columnas o usá su selector de estado con teclado y en pantallas táctiles.</p></div><div class="kanban-board">${columns.map(([status,label,color]) => {
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
            <button class="kanban-open" type="button" data-project-preview="${Number(project.id)}" aria-label="Abrir vista del proyecto ${escapeHTML(project.name)}"><h3>${escapeHTML(project.name)}</h3><p>${escapeHTML(project.description || 'Sin descripción')}</p></button>
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
        dom.projectPreviewContent.innerHTML = `<header class="project-preview-hero" style="--project-color:${color}">
            <div class="project-preview-hero-copy"><div class="project-preview-kickers">${statusBadge(project.status)}${projectTypeBadge(project)}<span class="priority-badge priority-${escapeHTML(project.priority || 'medium')}">${escapeHTML(PRIORITY[project.priority] || 'Prioridad media')}</span></div><h2 id="project-preview-title">${escapeHTML(project.name || 'Proyecto')}</h2><p>${escapeHTML(project.description || 'Este proyecto todavía no tiene una descripción.')}</p></div>
            <div class="project-preview-progress" style="--progress:${clamp(project.progress,0,100)}"><span>${clamp(project.progress,0,100)}%</span><small>avance</small></div>
            <div class="project-preview-top-actions">${projectPinButton(project)}<button class="icon-button project-preview-close" type="button" data-project-preview-close aria-label="Cerrar vista del proyecto">×</button></div>
        </header>
        <div class="project-preview-body">
            <section class="project-preview-summary" aria-label="Información del proyecto">
                <dl class="project-preview-metadata">
                    <div><dt>Modalidad</dt><dd>${isCommercial ? 'Proyecto comercial' : 'Proyecto personal'}</dd></div>
                    <div><dt>Prioridad</dt><dd>${escapeHTML(PRIORITY[project.priority] || 'Media')}</dd></div>
                    <div><dt>${isCommercial ? 'Cliente' : 'Propósito'}</dt><dd>${escapeHTML(isCommercial ? (project.client_name || 'Sin cliente asignado') : 'Proyecto propio')}</dd></div>
                    <div><dt>${isCommercial ? 'Fecha objetivo' : 'Planificación'}</dt><dd>${escapeHTML(isCommercial ? (project.due_date ? `${formatDate(project.due_date)} · ${dateDistance(project.due_date)}` : 'Sin fecha definida') : 'Sin fecha de entrega')}</dd></div>
                    <div><dt>Creado</dt><dd>${escapeHTML(formatDate(project.created_at))}</dd></div>
                    <div><dt>Último cambio</dt><dd>${escapeHTML(formatDate(project.updated_at))}</dd></div>
                </dl>
                ${links.length ? `<nav class="project-preview-links" aria-label="Enlaces del proyecto">${links.map(([label,url,iconName]) => `<a href="${escapeHTML(safeUrl(url))}" target="_blank" rel="noopener">${icon(iconName)}<span>${escapeHTML(label)}</span>${icon('arrow')}</a>`).join('')}</nav>` : '<p class="project-preview-no-links">Todavía no hay repositorio ni sitio publicado.</p>'}
                <div class="project-preview-taxonomy"><div><strong>Tecnologías y lenguajes</strong><div class="tech-list">${tech.length ? tech.map(item => `<span class="tag">${escapeHTML(item)}</span>`).join('') : '<span class="muted-copy">Sin stack definido</span>'}</div></div><div><strong>Etiquetas</strong><div class="tag-cloud">${tags.length ? tags.map(item => `<span>#${escapeHTML(item)}</span>`).join('') : '<span class="muted-copy">Sin etiquetas</span>'}</div></div></div>
            </section>

            <div class="project-preview-grid">
                <main class="project-preview-main">
                    ${projectShareSection(project, publicShare)}
                    ${projectPhotoSection(project, photos)}
                    <section class="project-detail-section" aria-labelledby="project-tasks-title"><header><div><span class="eyebrow">Próximas acciones</span><h3 id="project-tasks-title">Tareas asociadas</h3><p>${completed} de ${tasks.length} completadas.</p></div><button class="button button-secondary button-small" type="button" data-create="task" data-prefill-project="${Number(project.id)}">＋ Nueva tarea</button></header><div class="project-preview-tasks">${tasks.length ? tasks.map(projectPreviewTask).join('') : '<div class="preview-inline-empty">Todavía no hay tareas para este proyecto.</div>'}</div></section>
                    <section class="project-detail-section" aria-labelledby="project-timeline-title"><header><div><span class="eyebrow">Memoria del proyecto</span><h3 id="project-timeline-title">Línea de tiempo</h3><p>Avances, decisiones, bloqueos y aprendizajes.</p></div><button class="button button-secondary button-small" type="button" data-create="devlog" data-prefill-project="${Number(project.id)}">＋ Registrar cambio</button></header><div class="project-preview-timeline">${timeline.length ? timeline.map(projectTimelineEntry).join('') : '<div class="preview-inline-empty">Registrá el primer cambio para empezar la historia del proyecto.</div>'}</div></section>
                    ${documents.length ? projectDocumentSection(documents) : ''}
                </main>
                <aside class="project-preview-aside">
                    ${projectRelatedSection('Entregas y versiones', releases, item => `<button type="button" data-record-preview="release" data-id="${Number(item.id)}"><span>${escapeHTML(item.version || RELEASE_KINDS[item.kind] || 'Entrega')}</span><strong>${escapeHTML(item.title || 'Sin título')}</strong><small>${escapeHTML(item.release_date ? formatDate(item.release_date) : STATUS[item.status] || 'Sin fecha')}</small></button>`)}
                    ${projectRelatedSection('Recursos', resources, item => `<button type="button" data-record-preview="resource" data-id="${Number(item.id)}"><span>${escapeHTML(RESOURCE_TYPES[item.resource_type] || 'Recurso')}</span><strong>${escapeHTML(item.name || 'Sin nombre')}</strong><small>${escapeHTML(item.provider || ENVIRONMENTS[item.environment] || 'Sin proveedor')}</small></button>`)}
                    ${projectRelatedSection('Presupuestos', budgets, item => `<button type="button" data-record-preview="budget" data-id="${Number(item.id)}"><span>${escapeHTML(STATUS[item.status] || 'Presupuesto')}</span><strong>${escapeHTML(item.title || 'Sin título')}</strong><small>${escapeHTML(formatMoney(item.amount,item.currency))}</small></button>`)}
                </aside>
            </div>
        </div>
        <footer class="project-preview-footer"><div><small>Proyecto #${Number(project.id)}</small><span>${isProjectPinned(project) ? 'Fijado en tu cartera' : 'Disponible en tu cartera'}</span></div><button class="button button-ghost" type="button" data-project-preview-close>Cerrar</button><button class="button button-primary" type="button" data-project-preview-edit="${Number(project.id)}">Editar proyecto</button></footer>`;
    }

    function projectPhotoSection(project, photos) {
        return `<section class="project-detail-section project-photo-section" aria-labelledby="project-gallery-title"><header><div><span class="eyebrow">Galería</span><h3 id="project-gallery-title">Fotos del proyecto</h3><p>Capturas, avances visuales y referencias.</p></div><form class="project-photo-form" data-project-photo-form="${Number(project.id)}" enctype="multipart/form-data"><div><label class="button button-secondary button-small"><input type="file" name="file" accept=".jpg,.jpeg,.png,.webp,.gif" multiple required><span>${icon('image')} Elegir fotos</span></label><button class="button button-primary button-small" type="submit">Subir</button></div><small data-project-photo-feedback role="status" aria-live="polite"></small></form></header><div class="project-photo-gallery">${photos.length ? photos.map(projectPhoto).join('') : `<div class="project-photo-empty">${icon('image')}<strong>Tu galería está vacía</strong><span>Subí una captura para mostrar cómo va tomando forma.</span></div>`}</div></section>`;
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
        return `<article class="project-preview-task${done ? ' is-done' : ''}"><button class="task-check${done ? ' is-done' : ''}" type="button" data-task-toggle="${Number(task.id)}" aria-label="${done ? 'Reabrir' : 'Completar'} ${escapeHTML(task.title)}">${done ? icon('check') : ''}</button><button class="project-preview-task-copy" type="button" data-record-preview="task" data-id="${Number(task.id)}"><strong>${escapeHTML(task.title || 'Tarea sin título')}</strong><span>${escapeHTML(PRIORITY[task.priority] || 'Prioridad media')}${task.due_date ? ` · ${dateDistance(task.due_date)}` : ' · Sin fecha'}</span></button>${statusBadge(task.status)}</article>`;
    }

    function projectTimelineEntry(entry) {
        const date = entry.entry_date || entry.created_at || entry.updated_at;
        const type = entry.entry_type || entry.type || 'note';
        return `<article class="project-timeline-entry" data-record-preview="devlog" data-id="${Number(entry.id)}"><span class="project-timeline-mark entry-type-${escapeHTML(type)}"></span><div><header><div>${devlogTypeBadge(type)}<time datetime="${escapeHTML(date || '')}">${escapeHTML(formatDate(date))}</time></div><button class="text-button" type="button" data-edit="devlog" data-id="${Number(entry.id)}">Editar</button></header><h4 role="button" tabindex="0" data-record-preview="devlog" data-id="${Number(entry.id)}">${escapeHTML(entry.title || 'Cambio registrado')}</h4><p>${escapeHTML(entry.content || 'Sin detalles adicionales.')}</p>${Number(entry.minutes_spent) ? `<small>${icon('clock')}${Number(entry.minutes_spent)} min</small>` : ''}</div></article>`;
    }

    function projectDocumentSection(documents) {
        return `<section class="project-detail-section" aria-labelledby="project-documents-title"><header><div><span class="eyebrow">Documentación</span><h3 id="project-documents-title">Archivos vinculados</h3><p>${documents.length} ${documents.length === 1 ? 'archivo relacionado' : 'archivos relacionados'}.</p></div></header><div class="project-preview-documents">${documents.map(item => `<a href="${escapeHTML(attachmentHref(item))}"><span class="file-type">${escapeHTML(String(item.original_name || '').split('.').pop().slice(0,5).toUpperCase() || 'DOC')}</span><span><strong>${escapeHTML(item.original_name || 'Archivo')}</strong><small>${escapeHTML(bytesLabel(item.size_bytes))}</small></span>${icon('arrow')}</a>`).join('')}</div></section>`;
    }

    function projectRelatedSection(title, items, renderer) {
        return `<section class="project-related-section"><header><h3>${escapeHTML(title)}</h3><span>${items.length}</span></header><div>${items.length ? items.slice(0,6).map(renderer).join('') : '<p>No hay registros vinculados.</p>'}</div></section>`;
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
            return `<section class="project-detail-section project-share-section is-unavailable" aria-labelledby="project-share-title"><header><div><span class="eyebrow">Validación externa</span><h3 id="project-share-title">Portal de revisión</h3><p>El portal no está disponible en este entorno.</p></div></header></section>`;
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
                : `<div class="project-share-empty"><span>${icon('mail')}</span><div><strong>Creá un enlace de revisión no listado</strong><p>La persona que lo reciba podrá registrar comentarios, bugs y errores con capturas, sin entrar a CodePanel.</p></div><button class="button button-primary button-small" type="button" data-project-share-action="enable">Crear enlace</button></div>`;
        const feedbackContent = share.feedback_unavailable
            ? `<div class="project-feedback-empty is-error" role="status"><strong>No pudimos cargar los reportes</strong><span>El enlace sigue disponible; reintentá para consultar el feedback recibido.</span><button class="text-button" type="button" data-project-feedback-retry>Reintentar</button></div>`
            : items.length
                ? `<div class="project-feedback-list" role="list" aria-label="Feedback recibido">${items.map(projectFeedbackItem).join('')}</div>`
                : `<div class="project-feedback-empty"><strong>Todavía no llegó feedback</strong><span>Los reportes nuevos van a aparecer acá con sus imágenes y estado.</span></div>`;
        return `<section class="project-detail-section project-share-section${enabled ? ' is-enabled' : ''}" aria-labelledby="project-share-title">
            <header><div><span class="eyebrow">Validación externa</span><h3 id="project-share-title">Portal de revisión</h3><p>${enabled ? 'Compartí el avance y recibí reportes directamente en el proyecto.' : 'El portal está cerrado hasta que decidas habilitarlo.'}</p></div><div class="project-share-summary"><strong data-project-share-total>${total}</strong><span>${total === 1 ? 'reporte' : 'reportes'}</span><em data-project-share-pending${pending ? '' : ' hidden'}>${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}</em></div></header>
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
            release: item.title, resource: item.name, time_entry: item.description,
            weekly_review: item.week_start ? `Semana del ${formatDate(item.week_start)}` : 'Revisión semanal',
            attachment: item.original_name, tag: item.name ? `#${item.name}` : 'Etiqueta',
        }[entity];
        return title || `${RECORD_PREVIEW_LABELS[entity] || 'Registro'} #${Number(item.id)}`;
    }

    function recordSubtitle(entity, item = {}) {
        if (entity === 'task' || entity === 'devlog' || entity === 'reminder' || entity === 'release' || entity === 'resource' || entity === 'time_entry') return item.project_name || 'Sin proyecto asociado';
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
        return `<section class="record-preview-section"><header class="record-preview-section-head"><h3>${escapeHTML(title)}</h3></header>${content ? `<div class="record-preview-copy">${escapeHTML(content)}</div>` : `<div class="record-preview-empty">${escapeHTML(empty)}</div>`}</section>`;
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
        } else if (entity === 'task') {
            main.push(previewSection('Descripción',item.description,'Esta tarea no tiene detalles adicionales.'));
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
            main.push(previewSection('Notas de la relación',item.notes,'Todavía no guardaste notas sobre este cliente.'),previewRelatedSection('Proyectos',[...projects.map(row => previewRelationItem('project',row))]),previewRelatedSection('Presupuestos',[...budgets.map(row => previewRelationItem('budget',row,formatMoney(row.amount,row.currency)))]));
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
            aside.push(previewMetaSection('Infraestructura',[['Tipo',RESOURCE_TYPES[item.resource_type] || item.resource_type],['Estado',STATUS[item.status] || item.status],['Entorno',ENVIRONMENTS[item.environment] || item.environment],['Proveedor',item.provider],['Costo',Number(item.cost) ? formatMoney(item.cost,item.currency) : 'Sin costo'],['Ciclo',BILLING_CYCLES[item.billing_cycle] || item.billing_cycle],['Renovación',item.renewal_date ? `${formatDate(item.renewal_date)} · ${dateDistance(item.renewal_date)}` : null],...base]),projectRelation(item.project_id,item.project_name));
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
        dom.recordPreviewContent.innerHTML = `<header class="record-preview-header"><div class="record-preview-hero"><span class="record-preview-eyebrow">${escapeHTML(RECORD_PREVIEW_LABELS[entity] || 'Registro')}</span>${recordPills(entity,item)}<h2 class="record-preview-title" id="record-preview-title">${escapeHTML(recordTitle(entity,item))}</h2><p class="record-preview-subtitle">${escapeHTML(recordSubtitle(entity,item))}</p></div><button class="record-preview-close" type="button" data-record-preview-close aria-label="Cerrar vista previa">×</button></header><div class="record-preview-body"><div class="record-preview-grid"><main class="record-preview-main">${details.main || '<div class="record-preview-empty">No hay información adicional.</div>'}</main><aside class="record-preview-aside">${details.aside}</aside></div></div><footer class="record-preview-footer"><span>${escapeHTML(RECORD_PREVIEW_LABELS[entity] || 'Registro')} #${Number(item.id)}</span><div class="record-preview-actions"><button class="button button-ghost" type="button" data-record-preview-close>Cerrar</button>${download ? `<a class="button button-secondary" href="${escapeHTML(download)}">Descargar</a>` : ''}${canEdit ? `<button class="button button-primary" type="button" data-record-preview-edit="${escapeHTML(entity)}" data-id="${Number(item.id)}">Editar</button>` : ''}</div></footer>`;
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
                    ? '<div class="empty-state"><div class="empty-inner"><div class="empty-art"><span>◇</span></div><h2>El archivo está vacío</h2><p>Cuando archives una idea, vas a poder recuperarla desde acá.</p><button class="button button-ghost" type="button" data-clear-filters="ideas">Volver al semillero</button></div></div>'
                    : emptyState('idea', 'Plantá tu primera idea', 'No necesita estar resuelta. Guardala ahora y dale forma cuando sea el momento.'))
            : `<div class="idea-layout"><div class="idea-grid">${visible.map(ideaCard).join('')}</div><aside class="idea-sidebar"><div class="idea-quote"><span>“</span><p>Las ideas mejoran cuando tienen un lugar al que volver.</p><small>El semillero de CodePanel</small></div><div class="idea-breakdown"><h3>Por categoría</h3>${Object.entries(categories).slice(0,5).map(([category,count], index) => `<div class="breakdown-row"><span>${escapeHTML(category)}</span><strong>${count}</strong><div class="breakdown-bar" style="--bar-color:${['var(--yellow)','var(--coral)','var(--sage)','var(--blue)','var(--purple)'][index % 5]}"><span style="width:${Math.round(count/maxCategory*100)}%"></span></div></div>`).join('')}</div></aside></div>`;
        return `${pageHeading('Tu semillero', 'Ideas que pueden <em>crecer</em>.', 'Capturá la chispa, medí su potencial y dejá que madure sin presión.', 'idea')}
            ${collectionToolbar('ideas', visible.length, [['inbox','En la bandeja'],['exploring','Explorando'],['validated','Validadas'],['building','Construyendo'],['parked','En pausa'],['archived','Archivadas']])}${content}`;
    }

    function ideaCard(idea, index) {
        const colors = [
            ['var(--yellow)', 'var(--yellow-wash)'], ['var(--sage)', 'var(--sage-wash)'],
            ['var(--coral)', 'var(--coral-wash)'], ['var(--blue)', 'var(--blue-wash)'], ['var(--purple)', 'var(--purple-wash)'],
        ];
        const [color,wash] = colors[index % colors.length];
        const dots = score => Array.from({length:5}, (_, i) => `<i class="${i < clamp(score,1,5) ? 'is-filled' : ''}"></i>`).join('');
        return `<article class="idea-card" style="--idea-color:${color};--idea-wash:${wash}" data-record="idea" data-id="${Number(idea.id)}" data-record-preview="idea"><span class="pin"></span><div class="card-topline">${statusBadge(idea.archived ? 'archived' : idea.status)}<button class="icon-button card-menu-button" type="button" data-card-menu aria-label="Opciones">${icon('more')}</button></div><div class="card-actions-menu" hidden><button type="button" data-edit="idea" data-id="${Number(idea.id)}">Editar</button><button class="danger" type="button" data-delete="idea" data-id="${Number(idea.id)}">Eliminar</button></div><button class="card-content-button" type="button" data-record-preview="idea" data-id="${Number(idea.id)}"><h2>${escapeHTML(idea.title)}</h2><p class="description">${escapeHTML(idea.description || 'Una idea que todavía está buscando palabras.')}</p></button><div class="idea-tags">${asArray(idea.tags).map(tag => `<span>${escapeHTML(tag)}</span>`).join('')}</div><footer class="idea-score"><span>Impacto <span class="dot-score">${dots(idea.impact)}</span></span><span>Esfuerzo <span class="dot-score">${dots(idea.effort)}</span></span></footer></article>`;
    }

    function renderClients(items) {
        const visible = filtered(items, 'clients');
        const content = !visible.length ? (items.length ? noFilterResults('clients') : emptyState('client', 'Construí tu red de trabajo', 'Guardá a tus clientes y todo el contexto que hace más humana cada relación.')) : `<div class="contact-grid">${visible.map(contactCard).join('')}</div>`;
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
        const content = !visible.length ? (items.length ? noFilterResults('leads') : emptyState('lead', 'Tu próxima colaboración puede empezar acá', 'Registrá personas interesadas y acompañá cada conversación hasta convertirla en trabajo.')) : `<div class="pipeline">${stages.map(([status,label,color]) => { const leads = visible.filter(lead => lead.status === status); return `<section class="pipeline-stage" style="--stage-color:${color}"><header class="pipeline-header"><i></i><strong>${label}</strong><span>${leads.length}</span></header><div class="lead-list">${leads.length ? leads.map(leadCard).join('') : '<div class="inline-empty">Vacío</div>'}</div></section>`; }).join('')}</div>`;
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
        const board = !visible.length ? (items.length ? noFilterResults('tasks') : emptyState('task', 'Una próxima acción cambia todo', 'Anotá tareas concretas y conectalas con tus proyectos para mantener el impulso.')) : `<div class="task-page-grid"><div class="task-board">${groups.map(([status,label,color]) => { const tasks = visible.filter(task => task.status === status); return `<section class="task-group"><header class="task-group-header" style="--group-color:${color}"><strong><i></i>${label}</strong><span>${tasks.length}</span></header>${tasks.length ? tasks.map(task => taskRow(task)).join('') : '<div class="inline-empty">No hay tareas en esta etapa.</div>'}</section>`; }).join('')}</div><aside class="task-aside"><div class="week-card"><h2>Ritmo actual</h2><p>${done} de ${items.length} tareas completadas</p><div class="week-progress"><span style="width:${completion}%"></span></div><div class="week-caption"><span>Avance total</span><strong>${completion}%</strong></div></div><div class="priority-legend"><h3>Prioridades</h3><p><i class="priority-dot" style="--priority-color:var(--danger)"></i>Urgente</p><p><i class="priority-dot" style="--priority-color:var(--coral)"></i>Alta</p><p><i class="priority-dot" style="--priority-color:var(--yellow)"></i>Media</p><p><i class="priority-dot" style="--priority-color:var(--sage)"></i>Baja</p></div></aside></div>`;
        return `${pageHeading('Tu próxima acción', 'Tareas para <em>avanzar</em>.', 'Una lista deliberadamente simple: qué hacer, para cuándo y dentro de qué proyecto.', 'task')}
            ${collectionToolbar('tasks', visible.length, [['in_progress','En curso'],['todo','Por hacer'],['done','Completadas']])}${board}`;
    }

    function devlogTypeBadge(type) {
        return `<span class="entry-type-badge entry-type-${escapeHTML(type || 'note')}">${escapeHTML(DEVLOG_TYPES[type] || 'Nota')}</span>`;
    }

    function renderDevlogs(items) {
        const visible = filtered(items, 'devlogs');
        const minutes = visible.reduce((sum, item) => sum + Number(item.minutes_spent || 0), 0);
        const content = !visible.length
            ? (items.length ? noFilterResults('devlogs') : emptyState('devlog', 'Empezá a registrar el camino', 'Guardá avances, decisiones y aprendizajes para volver a ellos cuando los necesites.'))
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
                <button class="devlog-content-button" type="button" data-record-preview="devlog" data-id="${Number(entry.id)}"><h2>${escapeHTML(entry.title)}</h2><p>${escapeHTML(entry.content || 'Sin notas adicionales.')}</p></button>
                <footer class="devlog-footer"><div class="devlog-tags">${tags.map(tag => `<span>#${escapeHTML(tag)}</span>`).join('')}</div>${Number(entry.minutes_spent) > 0 ? `<small>${icon('clock')}${Number(entry.minutes_spent)} min</small>` : ''}</footer>
            </div>
        </article>`;
    }

    function groupedMoney(items, field) {
        const currencies = ['ARS', 'USD', 'EUR'].filter(currency => items.some(item => item.currency === currency));
        if (!currencies.length) return '<span>$ 0</span>';
        return currencies.map(currency => `<span><small>${currency}</small>${escapeHTML(formatMoney(items.filter(item => item.currency === currency).reduce((sum, item) => sum + Number(item[field] || 0), 0), currency))}</span>`).join('');
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
            ? (items.length ? noFilterResults('budgets') : emptyState('budget', 'Dale forma a tu primer presupuesto', 'Ordená alcance, valor y vigencia antes de compartir una propuesta.'))
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
            <button class="budget-content-button" type="button" data-record-preview="budget" data-id="${Number(budget.id)}"><h2>${escapeHTML(budget.title)}</h2><p>${escapeHTML(budget.client_name || 'Sin cliente asignado')}${budget.project_name ? ` · ${escapeHTML(budget.project_name)}` : ''}</p><strong>${escapeHTML(formatMoney(amount, budget.currency))}</strong></button>
            <div class="budget-progress"><div><span>Cobrado</span><strong>${progress}%</strong></div><div class="progress-bar"><span style="--progress:${progress}%"></span></div><small>Saldo ${escapeHTML(formatMoney(budget.balance, budget.currency))}</small></div>
            <footer><span class="budget-validity${validityClass}">${icon('calendar')}${budget.valid_until ? `Vigente ${escapeHTML(dateDistance(budget.valid_until).toLowerCase())}` : 'Sin vencimiento'}</span><button class="text-button" type="button" data-create="payment" data-prefill-budget="${Number(budget.id)}">＋ Cobro</button></footer>
        </article>`;
    }

    function paymentPanel(payments, canCharge) {
        return `<aside class="payment-panel"><header><div><span class="eyebrow">Movimientos</span><h2>Cobros recientes</h2></div>${canCharge ? '<button class="icon-button" type="button" data-create="payment" aria-label="Registrar cobro">＋</button>' : ''}</header><div class="payment-list">${payments.length ? payments.map(paymentRow).join('') : '<div class="inline-empty">Todavía no registraste cobros.</div>'}</div></aside>`;
    }

    function paymentRow(payment) {
        const budget = (state.cache.get('budgets')?.data || []).find(item => Number(item.id) === Number(payment.budget_id));
        const currency = budget?.currency || 'USD';
        return `<article class="payment-row" role="button" tabindex="0" aria-label="Abrir cobro de ${escapeHTML(formatMoney(payment.amount, currency))}" data-record-preview="payment" data-id="${Number(payment.id)}"><span class="payment-mark">${icon('wallet')}</span><div><strong>${escapeHTML(formatMoney(payment.amount, currency))}</strong><p>${escapeHTML(payment.budget_title || 'Presupuesto')} · ${escapeHTML(PAYMENT_METHODS[payment.method] || 'Otro medio')}</p></div><time datetime="${escapeHTML(payment.paid_at || '')}">${escapeHTML(formatDate(payment.paid_at))}</time></article>`;
    }

    function renderReleases(items) {
        const visible = filtered(items, 'releases');
        const published = items.filter(item => item.status === 'published').length;
        const content = !visible.length
            ? (items.length ? noFilterResults('releases') : emptyState('release', 'Registrá tu primera entrega', 'Conservá versiones, enlaces y contexto para saber exactamente qué llegó a cada entorno.'))
            : `<div class="release-timeline">${visible.map(releaseCard).join('')}</div>`;
        return `${pageHeading('Historial de salida', 'Entregas con <em>trazabilidad</em>.', `${published} publicadas de ${items.length}. Cada versión deja una huella clara.`, 'release')}
            ${collectionToolbar('releases', visible.length, [['planned','Planificadas'],['ready','Listas'],['published','Publicadas'],['rolled_back','Revertidas']])}${content}`;
    }

    function releaseCard(release) {
        const date = release.release_date ? parseDate(release.release_date) : null;
        return `<article class="release-card" data-record="release" data-id="${Number(release.id)}" data-record-preview="release"><div class="release-date"><strong>${date ? date.getDate() : '—'}</strong><span>${date ? new Intl.DateTimeFormat('es-AR', { month: 'short' }).format(date).replace('.', '') : 'Sin fecha'}</span></div><div class="release-body"><header><div class="release-labels">${statusBadge(release.status)}<span class="release-kind">${escapeHTML(RELEASE_KINDS[release.kind] || 'Versión')}</span><span>${escapeHTML(ENVIRONMENTS[release.environment] || release.environment || 'Sin entorno')}</span></div><button class="icon-button card-menu-button" type="button" data-card-menu aria-label="Opciones de ${escapeHTML(release.title)}">${icon('more')}</button></header><div class="card-actions-menu" hidden><button type="button" data-edit="release" data-id="${Number(release.id)}">Editar</button><button class="danger" type="button" data-delete="release" data-id="${Number(release.id)}">Eliminar</button></div><button class="release-content-button" type="button" data-record-preview="release" data-id="${Number(release.id)}"><span class="release-version">${escapeHTML(release.version || 'Sin versión')}</span><h2>${escapeHTML(release.title)}</h2><p>${escapeHTML(release.notes || 'Sin notas para esta salida.')}</p></button><footer><span>${icon('folder')}${escapeHTML(release.project_name || 'Sin proyecto')}</span>${release.url ? `<a href="${escapeHTML(safeUrl(release.url))}" target="_blank" rel="noopener">Abrir enlace ${icon('arrow')}</a>` : ''}</footer></div></article>`;
    }

    function renderResources(items) {
        const visible = filtered(items, 'resources');
        const attention = items.filter(item => item.status === 'attention').length;
        const renewals = items.filter(item => { const days = daysUntil(item.renewal_date); return days !== null && days >= 0 && days <= 30; }).length;
        const content = !visible.length
            ? (items.length ? noFilterResults('resources') : emptyState('resource', 'Armá tu inventario técnico', 'Dominios, servicios y repositorios en un solo lugar, sin guardar credenciales sensibles.'))
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
        }).join('')}</div><aside class="reminder-explainer panel panel-padded"><span class="reminder-bell">${icon('alert')}</span><h2>Todo lo que pide atención</h2><p>CodePanel combina tus recordatorios con vencimientos de tareas, oportunidades, presupuestos, entregas y recursos.</p><button class="text-button" type="button" data-nav-button="settings">Cambiar anticipación →</button></aside></div>`
            : emptyState('reminder', 'Nada pendiente por ahora', 'Creá un recordatorio personal o dejá que CodePanel reúna las fechas de tu espacio.');
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
            <div class="reminder-copy" role="button" tabindex="0" ${previewAttributes}><div>${statusBadge(item.status)}${isDerived ? '<span class="derived-badge">Automático</span>' : ''}</div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.notes || item.project_name || 'Sin notas adicionales.')}</p><small>${escapeHTML(item.project_name || (isDerived ? sourceLabel(item.source_type) : 'Personal'))}</small></div>
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
        const content = visible.length ? `<div class="time-layout"><section class="time-list">${visible.map(timeEntryCard).join('')}</section><aside class="time-summary panel panel-padded"><span class="eyebrow">Esta semana</span><div class="time-ring"><strong>${escapeHTML(minutesLabel(total))}</strong><small>registrados</small></div><dl><div><dt>Facturable</dt><dd>${escapeHTML(minutesLabel(billable))}</dd></div><div><dt>Hoy</dt><dd>${escapeHTML(minutesLabel(today.reduce((sum,item) => sum + elapsedMinutes(item),0)))}</dd></div><div><dt>Sesiones</dt><dd>${weekly.length}</dd></div></dl></aside></div>`
            : emptyState('time_entry', 'Empezá a medir sin complicarte', 'Usá el temporizador mientras trabajás o cargá el tiempo manualmente al terminar.');
        return `${pageHeading('Ritmo de trabajo', 'Tiempo con <em>contexto</em>.', 'Medí el esfuerzo real por proyecto y comparalo con el valor que genera.', 'time_entry', action)}
            <div class="finance-metrics">${metricCard('Esta semana', minutesLabel(total), `${weekly.length} sesiones`, 'clock')}${metricCard('Facturable', minutesLabel(billable), total ? `${Math.round(billable/total*100)}% del tiempo` : 'Sin horas todavía', 'wallet')}${metricCard('Hoy', minutesLabel(today.reduce((sum,item) => sum + elapsedMinutes(item),0)), `${today.length} registros`, 'calendar')}</div>
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
        return `<div class="widget-profit-list">${Object.entries(byCurrency).map(([currency,row]) => `<div><span>${escapeHTML(currency)}</span><strong class="${row.revenue-row.costs < 0 ? 'negative' : ''}">${escapeHTML(formatMoney(row.revenue-row.costs,currency))}</strong></div>`).join('')}</div>`;
    }

    function renderProfitability(data = []) {
        const projects = profitabilityRows(data);
        const cards = projects.flatMap(project => profitabilityBuckets(project).map(bucket => profitabilityCard(project,bucket)));
        const period = data && !Array.isArray(data) ? data.period : null;
        const periodLabel = period?.from && period?.to ? `${formatDate(period.from)} al ${formatDate(period.to)}${period.timezone ? ` · ${period.timezone}` : ''}` : 'Mes civil actual';
        return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">Salud económica · ${escapeHTML(periodLabel)}</span><h1>Rentabilidad con <em>los pies en la tierra</em>.</h1><p>Ingresos cobrados menos tiempo e infraestructura. Cada moneda se mantiene separada para evitar totales engañosos.</p></div><button class="button button-ghost" type="button" data-nav-button="settings">Configurar costo por hora</button></header>
            <aside class="calculation-note" role="note">${icon('alert')}<p><strong>Una estimación para ${escapeHTML(periodLabel)}, no contabilidad.</strong> El costo de tiempo usa el valor guardado en cada registro; los recursos recurrentes se prorratean dentro de ese período y los costos únicos se incluyen si fueron creados durante el mes. Si faltan costos, la tarjeta lo indica.</p></aside>
            ${cards.length ? `<div class="profitability-grid">${cards.join('')}</div>` : '<div class="empty-state"><div class="empty-inner"><div class="empty-art"><span>$</span></div><h2>Todavía no hay una rentabilidad calculable</h2><p>Vinculá presupuestos, cobros, tiempo y costos de infraestructura a un proyecto comercial.</p><button class="button button-primary" type="button" data-nav-button="time">Registrar tiempo</button></div></div>'}`;
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
        return `<article class="profit-card${profit < 0 ? ' is-negative' : ''}"><header><div><span class="eyebrow">${escapeHTML(currency)}</span><h2>${escapeHTML(project.project_name || project.name || bucket.project_name || 'Proyecto')}</h2></div><span class="profit-margin">${margin}%</span></header><strong class="profit-value">${escapeHTML(formatMoney(profit,currency))}</strong><span class="profit-label">resultado estimado después de costos únicos</span><dl><div><dt>Cobrado</dt><dd>${escapeHTML(formatMoney(revenue,currency))}</dd></div><div><dt>Tiempo</dt><dd>− ${escapeHTML(formatMoney(labor,currency))}</dd></div><div><dt>Infraestructura mensual</dt><dd>− ${escapeHTML(formatMoney(infrastructure,currency))}</dd></div>${oneTime?`<div><dt>Costos únicos</dt><dd>− ${escapeHTML(formatMoney(oneTime,currency))}</dd></div>`:''}</dl>${incomplete ? '<p class="incomplete-note">◌ Faltan costos en algunos registros; el resultado es parcial.</p>' : '<p class="complete-note">✓ Todos los costos vinculados tienen valor.</p>'}</article>`;
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
        return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">Todas tus fechas</span><h1>Un calendario para <em>anticiparte</em>.</h1><p>Tareas, seguimientos, presupuestos, recordatorios, entregas y renovaciones reunidos sin duplicados.</p></div><button class="button button-primary" type="button" data-create="reminder">＋ Nuevo recordatorio</button></header>
            <div class="calendar-toolbar"><button class="icon-button" type="button" data-calendar-move="-1" aria-label="Mes anterior">←</button><h2>${escapeHTML(monthLabel.charAt(0).toUpperCase()+monthLabel.slice(1))}</h2><button class="icon-button" type="button" data-calendar-move="1" aria-label="Mes siguiente">→</button><button class="button button-ghost button-small" type="button" data-calendar-today>Hoy</button></div>
            <div class="calendar-layout"><section class="calendar-board" aria-label="Calendario de ${escapeHTML(monthLabel)}"><div class="calendar-weekdays">${labels.map(label => `<span>${label}</span>`).join('')}</div><div class="calendar-grid">${cells.map(date => calendarCell(date,monthIndex)).join('')}</div></section>
            <aside class="calendar-day-list panel panel-padded"><span class="eyebrow">${escapeHTML(formatDate(state.calendarDay,{weekday:'long',day:'numeric',month:'long'}))}</span><h2>Agenda del día</h2><div>${selectedEvents.length ? selectedEvents.map(calendarEventRow).join('') : '<div class="inline-empty">No hay eventos para este día.</div>'}</div></aside></div>
            <section class="calendar-agenda-mobile"><h2>Lista del mes</h2>${state.calendarEvents.some(event=>String(event.date).startsWith(`${year}-${String(monthIndex+1).padStart(2,'0')}`)) ? state.calendarEvents.filter(event=>String(event.date).startsWith(`${year}-${String(monthIndex+1).padStart(2,'0')}`)).sort((a,b) => String(a.date).localeCompare(String(b.date))).map(calendarEventRow).join('') : '<div class="inline-empty">No hay eventos este mes.</div>'}</section>`;
    }

    function calendarCell(date,monthIndex) {
        const iso = dateISO(date); const events = (state.calendarEvents || []).filter(event => event.date === iso);
        const selected = iso === state.calendarDay; const outside = date.getMonth() !== monthIndex; const today = iso === todayISO();
        return `<button class="calendar-cell${selected ? ' is-selected' : ''}${outside ? ' is-outside' : ''}${today ? ' is-today' : ''}" type="button" data-calendar-day="${iso}" aria-pressed="${selected}" aria-label="${escapeHTML(formatDate(iso,{day:'numeric',month:'long'}))}, ${events.length} eventos"><span>${date.getDate()}</span><div>${events.slice(0,3).map(event => `<i class="event-${escapeHTML(event.source_type || 'reminder')}" title="${escapeHTML(event.title)}"></i>`).join('')}</div>${events.length > 3 ? `<small>+${events.length-3}</small>` : ''}</button>`;
    }
    function calendarEventRow(event) {
        const source = event.source_type || 'reminder';
        return `<button class="calendar-event-row" type="button" data-source-open="${escapeHTML(source)}" data-id="${Number(event.source_id)}"><i class="event-${escapeHTML(source)}"></i><span><strong>${escapeHTML(event.title)}</strong><small>${escapeHTML(sourceLabel(source))}${event.project_name ? ` · ${escapeHTML(event.project_name)}` : ''}</small></span><time>${escapeHTML(formatDate(event.date))}</time></button>`;
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
        return `${pageHeading('Cierre y aprendizaje', 'Tu semana, <em>en perspectiva</em>.', `${escapeHTML(formatDate(bounds.start))} al ${escapeHTML(formatDate(bounds.end))}${escapeHTML(zone)}. Datos reales para decidir mejor la próxima.`, 'weekly_review', current ? `<button class="button button-ghost" type="button" data-edit="weekly_review" data-id="${Number(current.id)}">Editar esta semana</button>` : '')}
            <div class="weekly-metrics">${metricCard('Tareas terminadas',tasksCompleted,'En esta semana','check')}${metricCard('Tiempo registrado',minutesLabel(timeMinutes),`${timeEntriesCount} sesiones · ${minutesLabel(billableMinutes)} facturables`,'clock')}${metricCard('Bitácora',devlogsCount,`${releasesCount} entregas o versiones`,'journal')}<article class="metric-card"><div class="metric-top"><span>Cobros</span><span class="metric-icon">${icon('wallet')}</span></div><div class="weekly-money">${paidByCurrency.length ? paidByCurrency.map(value => `<strong>${escapeHTML(value)}</strong>`).join('') : '<strong>Sin cobros</strong>'}</div><div class="metric-caption">Siempre separados por moneda</div></article></div>
            <div class="weekly-layout"><section class="weekly-prompt panel panel-padded"><span class="eyebrow">Ritual de 10 minutos</span><h2>${current ? 'Esta semana ya tiene una mirada.' : 'Cerrá la semana antes de empezar otra.'}</h2><p>Rescatá lo que salió bien, nombrá los bloqueos y elegí un foco concreto.</p><button class="button button-primary" type="button" ${current ? `data-record-preview="weekly_review" data-id="${Number(current.id)}"` : 'data-create="weekly_review"'}>${current ? 'Ver revisión' : 'Hacer mi revisión'}</button></section><section class="review-history"><h2>Historial</h2>${reviews.length ? reviews.map(reviewCard).join('') : '<div class="inline-empty">Tus cierres semanales aparecerán acá.</div>'}</section></div>`;
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
            ${visible.length ? `<div class="file-grid">${visible.map(fileCard).join('')}</div>` : (items.length ? noFilterResults('files') : '<div class="empty-state"><div class="empty-inner"><div class="empty-art"><span>↑</span></div><h2>Tu biblioteca está vacía</h2><p>Subí el primer documento y vinculalo a su proyecto.</p><button class="button button-primary" type="button" data-focus-upload>Elegir archivo</button></div></div>')}`;
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
            ${visible.length ? `<div class="tag-catalog">${visible.map(tag => `<article class="tag-card" style="--tag-color:${safeColor(tag.color,'#748c76')}" data-record-preview="tag" data-id="${Number(tag.id)}"><span class="catalog-tag" role="button" tabindex="0" data-record-preview="tag" data-id="${Number(tag.id)}">#${escapeHTML(tag.name)}</span><strong>${Number(tag.usage_count||0)} usos</strong><div><button class="text-button" type="button" data-edit="tag" data-id="${Number(tag.id)}">Editar</button><button class="text-button danger-text" type="button" data-delete="tag" data-id="${Number(tag.id)}">Eliminar</button></div></article>`).join('')}</div>` : emptyState('tag','Creá tu vocabulario','Usá etiquetas breves para cruzar proyectos, tareas, clientes y notas sin crear carpetas de más.')}`;
    }

    function renderDashboardSettings(settings = {}) {
        const selected = sanitizeWidgetOrder(settings.dashboard_widgets);
        const disabled = Object.keys(WIDGETS).filter(key => !selected.includes(key));
        const ordered = [...selected,...disabled];
        return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">Un inicio a tu medida</span><h1>Tu panorama, <em>en tu orden</em>.</h1><p>Elegí qué bloques aparecen y movelos según la forma en que trabajás.</p></div><button class="button button-ghost" type="button" data-dashboard-reset>Restaurar diseño</button></header>
            <form class="widget-settings panel panel-padded" id="dashboard-settings-form"><header><div><h2>Bloques del panorama</h2><p>El orden de esta lista es el que verás al entrar.</p></div><span>${selected.length} visibles</span></header><ol>${ordered.map((key,index) => `<li data-widget-key="${key}" class="${selected.includes(key)?'':'is-disabled'}"><span class="widget-handle" aria-hidden="true">☰</span><label><input type="checkbox" name="dashboard_widgets" value="${key}"${selected.includes(key)?' checked':''}><span><strong>${escapeHTML(WIDGETS[key])}</strong><small>${selected.includes(key)?'Visible en el panorama':'Oculto'}</small></span></label><div><button class="icon-button" type="button" data-widget-move="-1" aria-label="Subir ${escapeHTML(WIDGETS[key])}"${index===0?' disabled':''}>↑</button><button class="icon-button" type="button" data-widget-move="1" aria-label="Bajar ${escapeHTML(WIDGETS[key])}"${index===ordered.length-1?' disabled':''}>↓</button></div></li>`).join('')}</ol><footer><button class="button button-primary" type="submit">Guardar panorama</button><p role="status" aria-live="polite" data-settings-feedback></p></footer></form>`;
    }

    function renderSettings(settings = {}) {
        const reminderDays = Array.isArray(settings.reminder_days) ? settings.reminder_days.map(Number) : [Number(settings.reminder_days ?? 7)];
        return `<header class="page-heading"><div class="page-heading-copy"><span class="eyebrow">Preferencias personales</span><h1>CodePanel habla <em>tu idioma</em>.</h1><p>Ajustá cómo se muestran fechas, dinero, semanas, recordatorios y apariencia.</p></div></header>
            <form class="settings-form" id="settings-form"><section class="settings-section panel panel-padded"><header><span>${icon('wallet')}</span><div><h2>Trabajo y dinero</h2><p>Valores predeterminados para nuevos registros y cálculos.</p></div></header><div class="settings-grid">${selectField('default_currency','Moneda predeterminada',settings.default_currency||'ARS',[['ARS','ARS — Peso argentino'],['USD','USD — Dólar'],['EUR','EUR — Euro']],{blank:false})}${textField('default_hourly_cost','Costo por hora',settings.default_hourly_cost??0,{type:'number',min:0,step:.01,hint:'para estimar rentabilidad'})}</div></section>
            <section class="settings-section panel panel-padded"><header><span>${icon('calendar')}</span><div><h2>Fechas y agenda</h2><p>Las fechas civiles no cambian de día; las horas se convierten a tu zona.</p></div></header><div class="settings-grid">${selectField('date_format','Formato de fecha',settings.date_format||'d/m/Y',[['d/m/Y','DD/MM/AAAA'],['m/d/Y','MM/DD/AAAA'],['Y-m-d','AAAA-MM-DD']],{blank:false})}${textField('timezone','Zona horaria',settings.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,{placeholder:'America/Argentina/Buenos_Aires',required:true})}${selectField('week_start','La semana empieza',settings.week_start||'monday',[['monday','Lunes'],['sunday','Domingo']],{blank:false})}</div><fieldset class="reminder-days"><legend>Avisarme con anticipación</legend>${[1,3,7,14,30].map(day=>`<label><input type="checkbox" name="reminder_days" value="${day}"${reminderDays.includes(day)?' checked':''}><span>${day} ${day===1?'día':'días'}</span></label>`).join('')}</fieldset></section>
            <section class="settings-section panel panel-padded"><header><span>${icon('spark')}</span><div><h2>Apariencia</h2><p>Elegí un tema fijo o seguí la preferencia del dispositivo.</p></div></header><div class="theme-options">${[['system','Sistema'],['light','Claro'],['night','Noche']].map(([value,label])=>`<label><input type="radio" name="theme" value="${value}"${(settings.theme||'system')===value?' checked':''}><span><i class="theme-preview is-${value}"></i><strong>${label}</strong></span></label>`).join('')}</div></section><footer class="settings-footer"><button class="button button-primary" type="submit">Guardar configuración</button><p role="status" aria-live="polite" data-settings-feedback></p></footer></form>`;
    }

    function noFilterResults(route) {
        return `<div class="empty-state"><div class="empty-inner"><div class="empty-art"><span>⌕</span></div><h2>No encontramos coincidencias</h2><p>Probá con otra palabra o quitá alguno de los filtros.</p><button class="button button-ghost" type="button" data-clear-filters="${route}">Limpiar filtros</button></div></div>`;
    }

    function optionList(options, selected) {
        return options.map(([value,label]) => `<option value="${escapeHTML(value)}"${String(selected ?? '') === String(value) ? ' selected' : ''}>${escapeHTML(label)}</option>`).join('');
    }
    function textField(name, label, value = '', { type = 'text', placeholder = '', required = false, wide = false, hint = '', min = '', max = '', step = '' } = {}) {
        return `<div class="form-field${wide ? ' is-wide' : ''}"><label for="field-${name}">${escapeHTML(label)}${hint ? ` <span>${escapeHTML(hint)}</span>` : ''}</label><input id="field-${name}" name="${name}" type="${type}" value="${escapeHTML(value ?? '')}" placeholder="${escapeHTML(placeholder)}"${required ? ' required' : ''}${min !== '' ? ` min="${escapeHTML(min)}"` : ''}${max !== '' ? ` max="${escapeHTML(max)}"` : ''}${step !== '' ? ` step="${escapeHTML(step)}"` : ''}></div>`;
    }
    function textareaField(name, label, value = '', placeholder = '', { required = false, hint = '' } = {}) {
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
                            <span class="project-type-icon">${icon('spark')}</span>
                            <span class="project-type-copy"><strong>Personal</strong><small>Una idea propia, sin cliente ni fecha de entrega.</small></span>
                        </label>
                        <label class="project-type-option">
                            <input id="project-type-commercial" type="radio" name="project_type" value="commercial" aria-controls="project-commercial-fields" aria-describedby="project-type-note"${isCommercial ? ' checked' : ''}>
                            <span class="project-type-icon">${icon('target')}</span>
                            <span class="project-type-copy"><strong>Comercial</strong><small>Trabajo para vender, cotizar o entregar a un cliente.</small></span>
                        </label>
                    </div>
                    <small class="project-type-note" id="project-type-note">${isCommercial ? 'Cliente y fecha son opcionales: completalos cuando tenga sentido.' : 'Al guardar como personal se quitarán el cliente y la fecha objetivo.'}</small>
                </fieldset>
                ${textareaField('description','Descripción',item.description,'¿Qué estás construyendo y qué querés lograr?')}
                ${selectField('status','Estado',item.status || 'planned',[['planned','Por empezar'],['active','En marcha'],['on_hold','En pausa'],['completed','Terminado'],['archived','Archivado']],{blank:false})}
                ${selectField('priority','Prioridad',item.priority || 'medium',[['low','Baja'],['medium','Media'],['high','Alta'],['urgent','Urgente']],{blank:false})}
                ${rangeField('progress','Progreso en porcentaje',item.progress ?? 0)}
                <div class="project-commercial-fields is-wide" id="project-commercial-fields" data-commercial-fields${isCommercial ? '' : ' hidden'}>
                    <div class="project-commercial-heading"><strong>Datos comerciales</strong><small>Son opcionales; completalos cuando el acuerdo esté definido.</small></div>
                    <div class="form-field"><label for="field-due_date">Fecha objetivo</label><input id="field-due_date" name="due_date" type="date" value="${escapeHTML(item.due_date ?? '')}"${isCommercial ? '' : ' disabled'}></div>
                    <div class="form-field"><label for="field-client_id">Cliente</label><select id="field-client_id" name="client_id"${isCommercial ? '' : ' disabled'}><option value="">Sin asignar</option>${optionList(clients.map(client => [client.id, `${client.name}${client.company ? ` · ${client.company}` : ''}`]), item.client_id)}</select></div>
                </div>
                ${textField('tech_stack','Tecnologías',asArray(item.tech_stack).join(', '),{placeholder:'PHP, MySQL, JavaScript',wide:true,hint:'separadas por comas'})}
                ${tagsField(item.tags,tagCatalog,{placeholder:'cliente, portfolio, mantenimiento'})}
                ${textField('repository_url','Repositorio',item.repository_url,{type:'url',placeholder:'https://github.com/…',wide:true})}
                ${textField('live_url','Sitio publicado',item.live_url,{type:'url',placeholder:'https://…',wide:true})}
                <div class="form-field is-wide"><label>Color del proyecto</label><div class="color-options">${PROJECT_COLORS.map((color,index) => `<label class="color-option"><input type="radio" name="color" value="${color}"${safeColor(item.color,PROJECT_COLORS[0]).toLowerCase() === color.toLowerCase() || (!item.color && index === 0) ? ' checked' : ''}><span style="--color:${color}"></span></label>`).join('')}</div></div>
            </div>`;
        }
        if (entity === 'devlog') {
            const projects = await getCollection('projects').catch(() => []);
            return `<div class="form-grid">
                ${textField('title','Título de la entrada',item.title,{placeholder:'Ej. Cerré el flujo de registro',required:true,wide:true})}
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
                ${selectField('budget_id','Presupuesto',item.budget_id,budgets.map(budget => [budget.id,`${budget.title} · ${formatMoney(budget.balance, budget.currency)} pendiente`]),{wide:true,blank:'Elegí un presupuesto',required:true})}
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
                ${selectField('project_id','Proyecto',item.project_id,projects.map(project => [project.id,project.name]),{wide:true,blank:'Elegí un proyecto',required:true})}
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
                <aside class="form-security-note is-wide" role="note">${icon('alert')}<span><strong>No guardes secretos acá.</strong> Evitá contraseñas, tokens, claves privadas y credenciales en todos los campos.</span></aside>
                ${textField('name','Nombre del recurso',item.name,{placeholder:'Ej. Dominio principal',required:true,wide:true})}
                ${selectField('resource_type','Tipo',item.resource_type || 'service',Object.entries(RESOURCE_TYPES),{blank:false})}
                ${textField('provider','Proveedor',item.provider,{placeholder:'Empresa o plataforma'})}
                ${selectField('project_id','Proyecto',item.project_id,projects.map(project => [project.id,project.name]),{blank:'Recurso compartido'})}
                ${selectField('environment','Entorno',item.environment || 'production',[['development','Desarrollo'],['staging','Pruebas / staging'],['production','Producción'],['shared','Compartido']],{blank:false})}
                ${selectField('status','Estado',item.status || 'active',[['active','Activo'],['attention','Requiere atención'],['inactive','Inactivo']],{blank:false})}
                ${textField('url','URL de acceso público',item.url,{type:'url',placeholder:'https://…',wide:true,hint:'sin tokens ni credenciales'})}
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
                ${textField('title','Qué querés recordar',item.title,{placeholder:'Ej. Renovar el dominio',required:true,wide:true})}
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
                ${timerMode ? '<input type="hidden" name="timer_start" value="1"><aside class="form-security-note is-wide" role="note">'+icon('clock')+'<span><strong>El reloj empezará al guardar.</strong> Podés cerrar CodePanel: el inicio queda guardado en el servidor.</span></aside>' : ''}
                ${textField('description',timerMode?'En qué vas a trabajar':'Qué hiciste',item.description,{placeholder:'Ej. Implementar el flujo de acceso',required:true,wide:true})}
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
                ${rangeField('rating','Cómo sentís la semana',item.rating??3,1,5)}
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
            ? 'Cliente y fecha son opcionales: completalos cuando tenga sentido.'
            : 'Al guardar como personal se quitarán el cliente y la fecha objetivo.';
    }

    async function openEntityDialog(entity, id = null, prefill = null) {
        if (!ENTITY_ROUTE[entity]) return;
        closeDropdowns();
        let item = prefill || {};
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
            resource: ['project_id','provider','url','renewal_date','notes'],
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
        else if (entity === 'task') { raw.project_id = raw.project_id ? Number(raw.project_id) : null; raw.tags = asArray(raw.tags).slice(0,30); }
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
            dom.entityDialog.close();
            invalidate(route, ...relatedCollections(entity));
            toast(id === null ? `${capitalize(ENTITY_NAMES[entity])} creado` : 'Cambios guardados', payload.message || 'Tu espacio ya está actualizado.');
            await navigate(state.route, { force: true });
        } catch (error) {
            showFormErrors(error.errors);
            toast('Revisá los datos', error.message, 'error');
        } finally { button.disabled = false; button.innerHTML = old; }
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
            if (closeDialog && dom.entityDialog.open) dom.entityDialog.close();
            invalidate(ENTITY_ROUTE[entity], ...relatedCollections(entity));
            toast(`${capitalize(ENTITY_NAMES[entity])} eliminado`, 'El registro ya no aparece en tu espacio.');
            await navigate(state.route, { force: true });
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
            await api.patch(`tasks/${Number(id)}`, { status });
            invalidate('tasks','attention');
            toast(status === 'done' ? 'Tarea completada' : 'Tarea reabierta', status === 'done' ? 'Buen avance. Seguimos.' : 'Volvió a tu lista.');
            const previewId = dom.projectPreviewDialog?.open ? Number(state.projectPreview.id) : 0;
            if (previewId) await openProjectPreview(previewId, { quiet: true });
            else await navigate(state.route, { force: true });
        } catch (error) { toast('No pudimos actualizar la tarea', error.message, 'error'); }
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
                ? 'CodePanel no puede conectar con la base de datos. Revisá la conexión en el archivo .env o activá DEMO_FALLBACK=true para ver la demo.'
                : state.registrationEnabled
                    ? 'Ingresá para continuar o creá tu espacio personal en un minuto.'
                    : 'El alta de cuentas está desactivada en este espacio. Ingresá con una cuenta existente.';
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
            dom.authError.textContent = 'El alta de cuentas está desactivada. Ingresá con una cuenta existente.';
            dom.authError.hidden = false;
            return;
        }
        if (!dom.authForm.checkValidity()) { dom.authForm.reportValidity(); return; }
        const body = Object.fromEntries(new FormData(dom.authForm).entries());
        const button = dom.authForm.querySelector('.auth-submit'); button.disabled = true;
        try {
            const payload = (await api.post(`auth/${mode}`, body)).data || {};
            state.user = payload.user; state.csrf = payload.csrf_token || ''; state.demoMode = Boolean(payload.demo_mode); applyRegistrationAvailability(payload.registration_enabled !== false);
            dom.shell.inert = false; dom.authOverlay.hidden = true; dom.authForm.reset(); updateProfile(); invalidate(...Object.values(ENTITY_ROUTE)); state.settings=null; await getSettings(true).catch(()=>{state.settings={};});
            state.calendarDay=todayISO();
            toast(mode === 'register' ? 'Tu espacio está listo' : 'Qué bueno verte de nuevo', 'Empecemos por lo importante.');
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
        if (!await confirmAction('¿Cerrar sesión?', 'Tus datos quedan guardados y podés volver cuando quieras.', 'Cerrar sesión')) return;
        try { await api.post('auth/logout', {}); } catch (error) { toast('No pudimos cerrar la sesión',error.message,'error'); return; }
        state.user = null; state.cache.clear(); state.dashboard = null; state.settings=null; stopTimerTicker(); showAuth();
        await refreshCsrf(); // la sesión se regeneró: el siguiente acceso necesita un token nuevo
    }

    async function openSearch() {
        if (!dom.searchDialog.open) dom.searchDialog.showModal();
        dom.searchInput.value = ''; dom.searchResults.innerHTML = '<div class="search-hint"><span>⌕</span><p>Preparando tu espacio…</p></div>'; dom.searchInput.focus();
        // Sólo se piden las colecciones que no están en caché (las invalidadas al crear o editar).
        const missing = [...Object.values(ENTITY_ROUTE),'attachments'].filter(route => !state.cache.has(route));
        if (missing.length) await Promise.allSettled(missing.map(route => getCollection(route)));
        renderSearchResults(dom.searchInput.value);
    }
    function renderSearchResults(query) {
        const clean = query.trim().toLocaleLowerCase('es');
        if (!clean) { dom.searchResults.innerHTML = '<div class="search-hint"><span>⌕</span><p>Escribí para encontrar cualquier cosa en tu espacio.</p></div>'; return; }
        const definitions = [
            ['projects','project','Proyectos','name','description','folder','var(--coral-wash)'], ['ideas','idea','Ideas','title','description','bulb','var(--yellow-wash)'],
            ['tasks','task','Tareas','title','project_name','check','var(--blue-wash)'], ['clients','client','Clientes','name','company','users','var(--sage-wash)'], ['leads','lead','Oportunidades','name','company','target','var(--purple-wash)'],
            ['devlogs','devlog','Bitácora','title','project_name','journal','var(--coral-wash)'], ['budgets','budget','Presupuestos','title','client_name','receipt','var(--sage-wash)'],
            ['payments','payment','Cobros','budget_title','reference','wallet','var(--yellow-wash)'], ['releases','release','Entregas','title','project_name','package','var(--blue-wash)'],
            ['resources','resource','Recursos','name','provider','server','var(--purple-wash)'],
            ['reminders','reminder','Recordatorios','title','project_name','alert','var(--coral-wash)'],
            ['time_entries','time_entry','Tiempo','description','project_name','clock','var(--blue-wash)'],
            ['weekly_reviews','weekly_review','Revisiones','next_focus','wins','journal','var(--sage-wash)'],
            ['tags','tag','Etiquetas','name','slug','spark','var(--purple-wash)'],
            ['attachments','attachment','Archivos','original_name','mime_type','package','var(--blue-wash)'],
        ];
        const groups = definitions.map(([route,entity,label,title,subtitle,iconName,wash]) => {
            const records = (state.cache.get(route)?.data || []).filter(item => [item[title],item[subtitle],item.email,item.notes,item.content,item.version,item.reference,...asArray(item.tags),...asArray(item.tech_stack)].some(value => String(value || '').toLocaleLowerCase('es').includes(clean))).slice(0,5);
            if (!records.length) return '';
            return `<p class="search-group-title">${label}</p>${records.map(item => `<button class="search-result" type="button" data-search-open="${entity}" data-id="${Number(item.id)}"><span class="search-result-icon" style="--result-wash:${wash}">${icon(iconName)}</span><span><strong>${escapeHTML(item[title])}</strong><small>${escapeHTML(item[subtitle] || STATUS[item.status] || '')}</small></span></button>`).join('')}`;
        }).join('');
        dom.searchResults.innerHTML = groups || '<div class="search-hint"><span>—</span><p>No encontramos nada con ese nombre.</p></div>';
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
            invalidate('time_entries'); toast('Temporizador detenido','El tiempo quedó guardado en tu registro.');
            await navigate('time',{force:true});
        } catch (error) { toast('No pudimos detener el reloj',error.message,'error'); if (button) button.disabled=false; }
    }

    async function changeReminderStatus(id,status,button) {
        if (!id || button?.disabled) return; if (button) button.disabled=true;
        try { await api.patch(`reminders/${Number(id)}`,{status}); invalidate('reminders','attention'); toast(status==='done'?'Recordatorio completado':status==='pending'?'Recordatorio reabierto':'Recordatorio descartado'); await navigate(state.route,{force:true}); }
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
        if (!selected.length) { feedback.textContent='Dejá al menos un bloque visible.'; button.disabled=false; return; }
        try { const payload=await api.patch('settings',{dashboard_widgets:selected}); state.settings=payload.data||{...(state.settings||{}),dashboard_widgets:selected}; state.dashboard=null; feedback.textContent='Panorama guardado.'; toast('Panorama actualizado','El inicio respeta tu nuevo orden.'); }
        catch(error){ feedback.textContent=error.message; toast('No pudimos guardar',error.message,'error'); }
        finally{button.disabled=false;}
    }
    function updateWidgetMoveButtons(list) {
        const rows=[...list.querySelectorAll('[data-widget-key]')]; rows.forEach((row,index)=>{const up=row.querySelector('[data-widget-move="-1"]');const down=row.querySelector('[data-widget-move="1"]');if(up)up.disabled=index===0;if(down)down.disabled=index===rows.length-1;});
    }

    async function uploadAttachment(form) {
        const file=form.querySelector('[name="file"]')?.files?.[0]; const feedback=form.querySelector('[data-upload-feedback]'); const button=form.querySelector('[type="submit"]');
        if(!file){feedback.textContent='Elegí un archivo antes de continuar.';return;}
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
            feedback.textContent = 'Usá JPG, PNG, WEBP o GIF de hasta 10 MiB.';
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
                enable: ['Enlace público creado', 'Ya podés copiarlo y compartirlo.'],
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
            toast('No pudimos copiarlo', 'Seleccioná el enlace y copialo manualmente.', 'error');
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
            if (error?.name !== 'AbortError') toast('No pudimos compartirlo', 'Podés copiar el enlace manualmente.', 'error');
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
            if (event.target.matches('#attachment-form')) { event.preventDefault(); uploadAttachment(event.target); }
        });
        dom.searchInput.addEventListener('input', event => renderSearchResults(event.target.value));
        dom.searchInput.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); dom.searchDialog.close(); } });
        dom.searchDialog.addEventListener('click', event => { if (event.target === dom.searchDialog) dom.searchDialog.close(); });
        dom.entityDialog.addEventListener('click', event => { if (event.target === dom.entityDialog) dom.entityDialog.close(); });
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
            if (event.target.matches('#dashboard-settings-form [type="checkbox"]')) { const row=event.target.closest('[data-widget-key]'); row?.classList.toggle('is-disabled',!event.target.checked); const hint=row?.querySelector('label small'); if(hint)hint.textContent=event.target.checked?'Visible en el panorama':'Oculto'; }
        });
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
            const recordPreviewEdit = event.target.closest('[data-record-preview-edit]'); if (recordPreviewEdit) { const entity=recordPreviewEdit.dataset.recordPreviewEdit; const id=recordPreviewEdit.dataset.id; closeRecordPreview(); await openEntityDialog(entity,id); return; }
            const previewRelated = event.target.closest('[data-preview-related]'); if (previewRelated) { await openRecordPreview(previewRelated.dataset.previewRelated,previewRelated.dataset.id); return; }
            const previewClose = event.target.closest('[data-project-preview-close]'); if (previewClose) { closeProjectPreview(); return; }
            const previewRetry = event.target.closest('[data-project-preview-retry]'); if (previewRetry) { await openProjectPreview(previewRetry.dataset.projectPreviewRetry); return; }
            const previewEdit = event.target.closest('[data-project-preview-edit]'); if (previewEdit) { const id=previewEdit.dataset.projectPreviewEdit; closeProjectPreview(); await openEntityDialog('project',id); return; }
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
                if (create.closest('#project-preview-dialog')) closeProjectPreview();
                if (create.closest('#record-preview-dialog')) closeRecordPreview();
                await openEntityDialog(create.dataset.create,null,prefill); return;
            }
            const edit = event.target.closest('[data-edit]'); if (edit) { if (edit.closest('#project-preview-dialog')) closeProjectPreview(); if (edit.closest('#record-preview-dialog')) closeRecordPreview(); await openEntityDialog(edit.dataset.edit,edit.dataset.id); return; }
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
