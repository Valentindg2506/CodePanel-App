(() => {
    'use strict';

    const token = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    const basePath = window.location.pathname.replace(/\/share\.php$/, '');
    const endpoint = `${basePath}/api/index.php/public-feedback`;
    const projectCard = document.querySelector('#project-card');
    const feedbackPanel = document.querySelector('#feedback-panel');
    const unavailablePanel = document.querySelector('#unavailable-panel');
    const form = document.querySelector('#feedback-form');
    const successPanel = document.querySelector('#success-panel');
    const imageInput = document.querySelector('#feedback-images');
    const previews = document.querySelector('#image-previews');
    const message = form?.elements.message;
    const messageCount = document.querySelector('#message-count');
    let previewUrls = [];
    let submitting = false;

    const request = async (options = {}) => {
        const response = await fetch(endpoint, {
            ...options,
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            headers: { ...(options.headers || {}), 'X-Public-Project-Token': token },
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
            const error = new Error(payload?.message || 'No se pudo completar la solicitud.');
            error.status = response.status;
            error.fields = payload?.errors || {};
            throw error;
        }
        return payload.data;
    };

    const showUnavailable = () => {
        projectCard.hidden = true;
        feedbackPanel.hidden = true;
        unavailablePanel.hidden = false;
        document.title = 'Enlace no disponible · CodePanel';
    };

    const statusLabel = (status) => ({
        planned: 'Planificado', active: 'En desarrollo', on_hold: 'En pausa',
        completed: 'Completado', archived: 'Archivado',
    })[status] || 'Proyecto';

    const loadProject = async () => {
        if (!/^[a-f0-9]{64}$/.test(token)) {
            showUnavailable();
            return;
        }
        try {
            const data = await request();
            document.querySelector('#project-name').textContent = data.project.name;
            const description = document.querySelector('#project-description');
            description.textContent = data.project.description || 'Un espacio directo para compartir observaciones sobre el proyecto.';
            const progress = Math.max(0, Math.min(100, Number(data.project.progress) || 0));
            document.querySelector('#project-status').textContent = statusLabel(data.project.status);
            document.querySelector('#project-progress-value').textContent = `${progress}%`;
            document.querySelector('#project-progress-bar').style.width = `${progress}%`;
            document.querySelector('#project-progress').hidden = false;
            feedbackPanel.hidden = false;
            document.title = `${data.project.name} · Feedback`;
        } catch (error) {
            showUnavailable();
        }
    };

    const clearErrors = () => {
        document.querySelectorAll('[data-error]').forEach((node) => { node.textContent = ''; });
    };

    const showErrors = (errors = {}) => {
        let shown = false;
        Object.entries(errors).forEach(([field, value]) => {
            const node = document.querySelector(`[data-error="${CSS.escape(field)}"]`);
            if (node) {
                node.textContent = Array.isArray(value) ? value.join(' ') : String(value);
                shown = true;
            }
        });
        return shown;
    };

    const updatePreviews = () => {
        previewUrls.forEach(URL.revokeObjectURL);
        previewUrls = [];
        previews.replaceChildren();
        const files = Array.from(imageInput.files || []);
        if (files.length > 4) {
            document.querySelector('[data-error="images"]').textContent = 'Seleccioná como máximo cuatro imágenes.';
        }
        files.slice(0, 4).forEach((file) => {
            const url = URL.createObjectURL(file);
            previewUrls.push(url);
            const figure = document.createElement('div');
            figure.className = 'image-preview';
            const image = document.createElement('img');
            image.src = url;
            image.alt = `Vista previa de ${file.name}`;
            figure.append(image);
            previews.append(figure);
        });
    };

    message?.addEventListener('input', () => {
        messageCount.textContent = `${message.value.length} / 5000`;
    });
    imageInput?.addEventListener('change', () => {
        clearErrors();
        updatePreviews();
    });

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (submitting) return;
        clearErrors();
        if (!form.reportValidity()) return;
        if ((imageInput.files?.length || 0) > 4) {
            showErrors({ images: 'Seleccioná como máximo cuatro imágenes.' });
            return;
        }
        const button = document.querySelector('#submit-feedback');
        submitting = true;
        button.disabled = true;
        button.querySelector('span').textContent = 'Enviando…';
        try {
            const body = new FormData(form);
            if (!imageInput.files?.length) body.delete('images[]'); // sin capturas no se envía un archivo vacío
            const data = await request({ method: 'POST', body });
            form.hidden = true;
            successPanel.hidden = false;
            document.querySelector('#feedback-reference').textContent = `Referencia CP-${data.reference.slice(0, 10).toUpperCase()}`;
            successPanel.focus();
        } catch (error) {
            const hasFieldError = showErrors(error.fields);
            const fallback = document.querySelector('[data-error="message"]');
            if (!hasFieldError && fallback) fallback.textContent = error.message;
        } finally {
            submitting = false;
            button.disabled = false;
            button.querySelector('span').textContent = 'Enviar reporte';
        }
    });

    document.querySelector('#send-another')?.addEventListener('click', () => {
        form.elements.message.value = '';
        imageInput.value = '';
        messageCount.textContent = '0 / 5000';
        updatePreviews();
        successPanel.hidden = true;
        form.hidden = false;
        form.elements.message.focus();
    });

    window.addEventListener('pagehide', () => previewUrls.forEach(URL.revokeObjectURL));
    loadProject();
})();
