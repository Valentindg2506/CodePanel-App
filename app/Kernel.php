<?php

declare(strict_types=1);

namespace CodePanel;

use PDO;

final class Kernel
{
    private readonly ?PDO $pdo;
    private readonly bool $demoMode;
    private readonly Auth $auth;
    private readonly ?DataStore $store;

    public function __construct()
    {
        $this->pdo = Database::connect();
        // El modo demo se activa a propósito (DEMO_FALLBACK=true): en producción, una base caída
        // debe dar error y no abrir un espacio de muestra con sesión automática.
        $fallback = Env::bool('DEMO_FALLBACK', false);
        $this->demoMode = $this->pdo === null && $fallback;
        $this->auth = new Auth($this->pdo, $this->demoMode);
        $this->store = $this->pdo !== null
            ? new DatabaseStore($this->pdo)
            : ($this->demoMode ? new DemoStore() : null);
    }

    public function run(): never
    {
        $method = Http::method();
        if ($method === 'OPTIONS') {
            header('Allow: GET, POST, PUT, PATCH, DELETE, OPTIONS');
            Http::success(null, 'Métodos disponibles.');
        }

        $route = $this->route();
        $segments = $route === '' ? [] : explode('/', $route);
        $resource = strtolower((string) ($segments[0] ?? ''));

        if ($resource === '') {
            Http::success([
                'name' => 'CodePanel API',
                'version' => '1.0.0',
                'health' => 'api/index.php/health',
            ], 'API disponible.', 200, $this->meta());
        }

        if ($resource === 'health') {
            $this->only($method, ['GET']);
            $database = $this->pdo !== null ? 'connected' : 'unavailable';
            $data = [
                'status' => $this->store !== null ? 'ok' : 'degraded',
                'database' => $database,
                'demo_mode' => $this->demoMode,
                'time' => date(DATE_ATOM),
            ];
            if (Env::bool('APP_DEBUG')) {
                $data['php'] = PHP_VERSION;
                if ($this->pdo === null) {
                    $data['database_error'] = Database::lastError();
                }
            }
            Http::success($data, 'CodePanel está operativo.', 200, $this->meta());
        }

        if ($resource === 'auth') {
            $this->handleAuth($method, strtolower((string) ($segments[1] ?? ($_GET['action'] ?? 'me'))));
        }

        if ($resource === 'public-feedback') {
            $this->handlePublicFeedback($method);
        }

        if ($this->store === null) {
            throw new ApiException('La base de datos no está disponible y el modo demo está desactivado.', 503);
        }

        $user = $this->auth->requireUser();
        $userId = (int) $user['id'];

        if ($resource === 'dashboard') {
            $this->only($method, ['GET']);
            Http::success(
                $this->store->dashboard($userId),
                'Resumen actualizado.',
                200,
                $this->meta(),
            );
        }

        if ($resource === 'attention') {
            $this->only($method, ['GET']);
            $items = $this->store->attention($userId);
            Http::success($items, 'Centro de recordatorios actualizado.', 200, array_merge($this->meta(), [
                'count' => count($items),
            ]));
        }

        if ($resource === 'weekly_summary') {
            $this->only($method, ['GET']);
            [$from, $to] = $this->weeklyRange($_GET['week_start'] ?? null, $userId);
            Http::success(
                $this->store->weeklySummary($userId, $from, $to),
                'Resumen semanal actualizado.',
                200,
                $this->meta(),
            );
        }

        if ($resource === 'settings') {
            $this->handleSettings($method, $userId);
        }

        if ($resource === 'calendar') {
            $this->only($method, ['GET']);
            [$from, $to] = $this->calendarRange($_GET['from'] ?? null, $_GET['to'] ?? null, $userId);
            $events = $this->store->calendar($userId, $from, $to);
            Http::success($events, 'Calendario actualizado.', 200, array_merge($this->meta(), [
                'count' => count($events), 'from' => $from, 'to' => $to,
            ]));
        }

        if ($resource === 'profitability') {
            $this->only($method, ['GET']);
            Http::success(
                $this->store->profitability($userId),
                'Rentabilidad estimada actualizada.',
                200,
                $this->meta(),
            );
        }

        if ($resource === 'attachments') {
            $this->handleAttachments($method, $segments, $userId);
        }

        if ($resource === 'project-shares') {
            $this->handleProjectShares($method, $segments, $userId);
        }

        if ($resource === 'time_entries'
            && (($segments[1] ?? null) === 'timer' || ($segments[2] ?? null) === 'stop')) {
            $this->handleTimeEntryAction($method, $segments, $userId);
        }

        if ($resource === 'projects' && strtolower((string) ($segments[2] ?? '')) === 'overview') {
            $this->only($method, ['GET']);
            $projectId = $this->resourceId($segments[1] ?? null);
            if ($projectId === null) {
                throw new ApiException('Indica el proyecto que quieres consultar.', 400);
            }
            $overview = $this->store->projectOverview($projectId, $userId);
            if ($overview === null) {
                throw new ApiException('No encontramos ese proyecto.', 404);
            }
            $attachmentService = new AttachmentService();
            $overview['attachments'] = array_map(
                static fn (array $row): array => $attachmentService->present($row),
                $overview['attachments'],
            );
            Http::success($overview, 'Vista del proyecto actualizada.', 200, $this->meta());
        }

        EntityCatalog::get($resource);
        $id = $this->resourceId($segments[1] ?? ($_GET['id'] ?? null));

        if ($method === 'GET') {
            if ($id !== null) {
                $record = $this->store->find($resource, $id, $userId);
                if ($record === null) {
                    throw new ApiException('No encontramos ese registro.', 404);
                }
                Http::success($record, 'Registro encontrado.', 200, $this->meta());
            }

            $filters = [];
            foreach ([
                'status', 'priority', 'project_type', 'client_id', 'project_id', 'budget_id',
                'task_id', 'entry_type', 'kind', 'environment', 'resource_type', 'archived',
                'billable', 'pinned', 'work_date', 'week_start',
                'search', 'q', 'tech', 'limit',
            ] as $filter) {
                if (array_key_exists($filter, $_GET)) {
                    $filters[$filter] = $_GET[$filter];
                }
            }
            $records = $this->store->list($resource, $userId, $filters);
            Http::success(
                $records,
                'Listado actualizado.',
                200,
                array_merge($this->meta(), ['count' => count($records)]),
            );
        }

        if ($method === 'POST') {
            if ($id !== null) {
                throw new ApiException('No incluyas un ID al crear un registro.', 400);
            }
            $this->auth->assertCsrf();
            $data = $this->validatedData($resource, Http::body(), true, $userId);
            $record = $this->store->create($resource, $userId, $data);
            Http::success($record, 'Registro creado.', 201, $this->meta());
        }

        if (in_array($method, ['PUT', 'PATCH'], true)) {
            if ($id === null) {
                throw new ApiException('Indica el ID del registro que quieres editar.', 400);
            }
            $this->auth->assertCsrf();
            $current = $this->store->find($resource, $id, $userId);
            if ($current === null) {
                throw new ApiException('No encontramos ese registro.', 404);
            }
            $data = $this->validatedData($resource, Http::body(), false, $userId, $current);
            $record = $this->store->update($resource, $id, $userId, $data);
            if ($record === null) {
                throw new ApiException('No encontramos ese registro.', 404);
            }
            Http::success($record, 'Cambios guardados.', 200, $this->meta());
        }

        if ($method === 'DELETE') {
            if ($id === null) {
                throw new ApiException('Indica el ID del registro que quieres eliminar.', 400);
            }
            $this->auth->assertCsrf();
            $attachmentTargets = $this->store->dependentAttachmentTargets($resource, $id, $userId);
            $feedbackFiles = $resource === 'projects' && $this->pdo !== null
                ? (new PublicFeedbackService($this->pdo))->projectStoredFiles($id, $userId)
                : [];
            if (!$this->store->delete($resource, $id, $userId)) {
                throw new ApiException('No encontramos ese registro.', 404);
            }
            $attachments = new AttachmentService();
            $attachments->purgeEntity($this->store, $resource, $id, $userId);
            foreach ($attachmentTargets as $target) {
                $attachments->purgeEntity($this->store, $target['entity_type'], $target['entity_id'], $userId);
            }
            if ($feedbackFiles !== [] && $this->pdo !== null) {
                (new PublicFeedbackService($this->pdo))->removeStoredFiles($feedbackFiles);
            }
            Http::success(null, 'Registro eliminado.', 200, $this->meta());
        }

        $this->only($method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    }

    private function handleAuth(string $method, string $action): never
    {
        if ($action === 'me' || $action === 'session') {
            $this->only($method, ['GET']);
            $user = $this->auth->user();
            Http::success([
                'authenticated' => $user !== null,
                'user' => $user,
                'csrf_token' => $this->auth->csrfToken(),
                'demo_mode' => $this->demoMode,
                'database_available' => $this->store !== null,
                'registration_enabled' => $this->auth->registrationEnabled(),
            ], $user !== null ? 'Sesión activa.' : 'No hay una sesión activa.', 200, $this->meta());
        }

        if ($action === 'csrf') {
            $this->only($method, ['GET']);
            Http::success(['csrf_token' => $this->auth->csrfToken()], 'Token actualizado.', 200, $this->meta());
        }

        if ($action === 'login') {
            $this->only($method, ['POST']);
            $this->auth->assertCsrf();
            Http::success($this->auth->login(Http::body()), 'Bienvenido de nuevo.', 200, $this->meta());
        }

        if ($action === 'register') {
            $this->only($method, ['POST']);
            $this->auth->assertCsrf();
            Http::success($this->auth->register(Http::body()), 'Tu cuenta está lista.', 201, $this->meta());
        }

        if ($action === 'logout') {
            $this->only($method, ['POST']);
            if ($this->auth->user(false) !== null) {
                $this->auth->assertCsrf();
            }
            $this->auth->logout();
            Http::success(null, 'Sesión cerrada.', 200, $this->meta());
        }

        throw new ApiException('Acción de autenticación no encontrada.', 404);
    }

    private function handleSettings(string $method, int $userId): never
    {
        if ($method === 'GET') {
            Http::success($this->store?->getSettings($userId), 'Preferencias actualizadas.', 200, $this->meta());
        }
        $this->only($method, ['GET', 'PATCH']);
        $this->auth->assertCsrf();
        $validated = SettingsCatalog::validate(Http::body(), true);
        if ($validated['errors'] !== []) {
            throw new ApiException('Revisa los campos marcados.', 422, $validated['errors']);
        }
        Http::success(
            $this->store?->updateSettings($userId, $validated['data']),
            'Preferencias guardadas.',
            200,
            $this->meta(),
        );
    }

    private function handlePublicFeedback(string $method): never
    {
        $this->only($method, ['GET', 'POST']);
        if ($this->pdo === null) {
            throw new ApiException('El portal público no está disponible temporalmente.', 503);
        }
        header('Cache-Control: no-store, max-age=0');
        header('Referrer-Policy: no-referrer');
        header('X-Robots-Tag: noindex, nofollow, noarchive');

        $token = is_string($_SERVER['HTTP_X_PUBLIC_PROJECT_TOKEN'] ?? null)
            ? trim((string) $_SERVER['HTTP_X_PUBLIC_PROJECT_TOKEN'])
            : '';
        $service = new PublicFeedbackService($this->pdo);
        if ($method === 'GET') {
            Http::success($service->publicProject($token), 'Portal público disponible.', 200, $this->meta());
        }

        $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($contentLength > 14_680_064) {
            throw new ApiException('La petición supera el tamaño permitido.', 413, [
                'images' => 'El total de imágenes debe pesar como máximo 12 MiB.',
            ]);
        }
        Http::success($service->submit($token), 'Reporte enviado. Gracias por ayudarnos a mejorar.', 201, $this->meta());
    }

    /** @param array<int, string> $segments */
    private function handleProjectShares(string $method, array $segments, int $userId): never
    {
        if ($this->pdo === null) {
            throw new ApiException('Los enlaces públicos requieren una base de datos disponible.', 503);
        }
        $projectId = $this->resourceId($segments[1] ?? null);
        if ($projectId === null) {
            throw new ApiException('Indica el proyecto que quieres compartir.', 400);
        }
        $action = strtolower((string) ($segments[2] ?? ''));
        $childId = $this->resourceId($segments[3] ?? null);
        $service = new PublicFeedbackService($this->pdo);

        if ($action === '') {
            $this->only($method, ['GET']);
            Http::success($service->sharingConfig($projectId, $userId), 'Enlace público actualizado.', 200, $this->meta());
        }
        if (in_array($action, ['enable', 'disable', 'regenerate'], true)) {
            $this->only($method, ['POST']);
            $this->auth->assertCsrf();
            $config = match ($action) {
                'enable' => $service->enable($projectId, $userId),
                'disable' => $service->disable($projectId, $userId),
                'regenerate' => $service->regenerate($projectId, $userId),
            };
            $message = match ($action) {
                'enable' => 'Enlace público activado.',
                'disable' => 'Enlace público desactivado.',
                'regenerate' => 'Enlace público renovado. El anterior dejó de funcionar.',
            };
            Http::success($config, $message, 200, $this->meta());
        }
        if ($action === 'feedback' && $childId === null) {
            $this->only($method, ['GET']);
            Http::success(
                $service->listFeedback($projectId, $userId, [
                    'status' => $_GET['status'] ?? null,
                    'type' => $_GET['type'] ?? null,
                    'limit' => $_GET['limit'] ?? null,
                ]),
                'Reportes actualizados.',
                200,
                $this->meta(),
            );
        }
        if ($action === 'feedback' && $childId !== null && $method === 'PATCH') {
            $this->auth->assertCsrf();
            $body = Http::body();
            Http::success(
                $service->updateStatus($projectId, $childId, $userId, $body['status'] ?? null),
                'Estado del reporte actualizado.',
                200,
                $this->meta(),
            );
        }
        if ($action === 'feedback' && $childId !== null && $method === 'DELETE') {
            $this->auth->assertCsrf();
            Http::success(
                $service->deleteFeedback($projectId, $childId, $userId),
                'Reporte eliminado.',
                200,
                $this->meta(),
            );
        }
        if ($action === 'feedback-images' && $childId !== null) {
            $this->only($method, ['GET']);
            $service->previewOwnerImage($projectId, $childId, $userId);
        }
        throw new ApiException('Ruta de enlaces públicos no encontrada.', 404);
    }

    /** @param array<int, string> $segments */
    private function handleAttachments(string $method, array $segments, int $userId): never
    {
        $service = new AttachmentService();
        $rawId = $segments[1] ?? null;
        $id = $rawId === null ? null : $this->resourceId($rawId);
        $action = strtolower((string) ($segments[2] ?? ''));

        if ($this->demoMode && !($method === 'GET' && $id === null)) {
            throw new ApiException(
                'Los archivos no están disponibles mientras CodePanel funciona en modo demo.',
                503,
            );
        }

        if ($method === 'GET' && $id !== null && $action === 'download') {
            $service->download($this->store, $id, $userId);
        }
        if ($method === 'GET' && $id !== null && $action === 'preview') {
            $service->preview($this->store, $id, $userId);
        }
        if ($method === 'GET' && $id === null) {
            $entityType = isset($_GET['entity_type']) ? trim((string) $_GET['entity_type']) : null;
            $entityType = $entityType === '' ? null : $entityType;
            $entityId = null;
            if (isset($_GET['entity_id']) && $_GET['entity_id'] !== '') {
                $filtered = filter_var($_GET['entity_id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
                if ($filtered === false) {
                    throw new ApiException('El ID indicado no es válido.', 400);
                }
                $entityId = (int) $filtered;
            }
            $records = $service->list($this->store, $userId, $entityType, $entityId);
            Http::success($records, 'Archivos actualizados.', 200, array_merge($this->meta(), ['count' => count($records)]));
        }
        if ($method === 'POST' && $id === null) {
            $this->auth->assertCsrf();
            Http::success($service->upload($this->store, $userId), 'Archivo guardado.', 201, $this->meta());
        }
        if ($method === 'DELETE' && $id !== null && $action === '') {
            $this->auth->assertCsrf();
            Http::success($service->delete($this->store, $id, $userId), 'Archivo eliminado.', 200, $this->meta());
        }
        throw new ApiException('Ruta de archivos no encontrada.', 404);
    }

    /** @param array<int, string> $segments */
    private function handleTimeEntryAction(string $method, array $segments, int $userId): never
    {
        if (($segments[1] ?? null) === 'timer' && ($segments[2] ?? null) === 'start') {
            $this->only($method, ['POST']);
            $this->auth->assertCsrf();
            $input = Http::body();
            $input['_timer_start'] = true;
            $data = $this->validatedData('time_entries', $input, true, $userId);
            Http::success($this->store?->create('time_entries', $userId, $data), 'Temporizador iniciado.', 201, $this->meta());
        }

        if (($segments[2] ?? null) === 'stop') {
            $this->only($method, ['POST', 'PATCH']);
            $id = $this->resourceId($segments[1] ?? null);
            if ($id === null) {
                throw new ApiException('Indica el temporizador que quieres detener.', 400);
            }
            $this->auth->assertCsrf();
            $current = $this->store?->find('time_entries', $id, $userId);
            if ($current === null) {
                throw new ApiException('No encontramos ese registro de tiempo.', 404);
            }
            if (($current['started_at'] ?? null) === null) {
                throw new ApiException('Ese registro no corresponde a un temporizador.', 422);
            }
            if (($current['ended_at'] ?? null) !== null) {
                Http::success($current, 'El temporizador ya estaba detenido.', 200, $this->meta());
            }
            $data = $this->validatedData(
                'time_entries',
                ['ended_at' => gmdate('Y-m-d H:i:s')],
                false,
                $userId,
                $current,
            );
            $record = $this->store?->update('time_entries', $id, $userId, $data);
            Http::success($record, 'Temporizador detenido.', 200, $this->meta());
        }
        throw new ApiException('Acción de temporizador no encontrada.', 404);
    }

    /** @return array{0: string, 1: string} */
    private function calendarRange(mixed $rawFrom, mixed $rawTo, int $userId): array
    {
        $timezoneName = (string) (($this->store?->getSettings($userId)['timezone'] ?? null) ?: 'UTC');
        $timezone = new \DateTimeZone($timezoneName);
        $today = new \DateTimeImmutable('today', $timezone);
        $from = $rawFrom === null || $rawFrom === '' ? $today->format('Y-m-d') : (string) $rawFrom;
        $to = $rawTo === null || $rawTo === '' ? $today->modify('+30 days')->format('Y-m-d') : (string) $rawTo;
        $fromDate = \DateTimeImmutable::createFromFormat('!Y-m-d', $from, $timezone);
        $fromErrors = \DateTimeImmutable::getLastErrors();
        $toDate = \DateTimeImmutable::createFromFormat('!Y-m-d', $to, $timezone);
        $toErrors = \DateTimeImmutable::getLastErrors();
        if ($fromDate === false || $toDate === false
            || ($fromErrors !== false && ($fromErrors['warning_count'] > 0 || $fromErrors['error_count'] > 0))
            || ($toErrors !== false && ($toErrors['warning_count'] > 0 || $toErrors['error_count'] > 0))) {
            throw new ApiException('El rango del calendario no es válido.', 422, [
                'range' => 'Usa fechas AAAA-MM-DD válidas.',
            ]);
        }
        if ($fromDate > $toDate) {
            throw new ApiException('El rango del calendario no es válido.', 422, [
                'to' => 'La fecha final debe ser igual o posterior a la inicial.',
            ]);
        }
        if ((int) $fromDate->diff($toDate)->days + 1 > 366) {
            throw new ApiException('El rango del calendario es demasiado amplio.', 422, [
                'range' => 'Consulta como máximo 366 días.',
            ]);
        }
        return [$fromDate->format('Y-m-d'), $toDate->format('Y-m-d')];
    }

    /** @return array{0: string, 1: string} */
    private function weeklyRange(mixed $rawStart, int $userId): array
    {
        $settings = $this->store?->getSettings($userId) ?? SettingsCatalog::defaults();
        $timezone = new \DateTimeZone((string) $settings['timezone']);
        $expectedDay = $settings['week_start'] === 'sunday' ? 7 : 1;
        if ($rawStart === null || $rawStart === '') {
            $start = new \DateTimeImmutable('today', $timezone);
            $offset = ((int) $start->format('N') - $expectedDay + 7) % 7;
            $start = $start->modify("-{$offset} days");
        } else {
            $start = \DateTimeImmutable::createFromFormat('!Y-m-d', (string) $rawStart, $timezone);
            $errors = \DateTimeImmutable::getLastErrors();
            if ($start === false || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))) {
                throw new ApiException('La semana indicada no es válida.', 422, [
                    'week_start' => 'Usa una fecha AAAA-MM-DD válida.',
                ]);
            }
            if ((int) $start->format('N') !== $expectedDay) {
                throw new ApiException('La semana indicada no coincide con tu configuración.', 422, [
                    'week_start' => $expectedDay === 1 ? 'Debe ser un lunes.' : 'Debe ser un domingo.',
                ]);
            }
        }
        return [$start->format('Y-m-d'), $start->modify('+6 days')->format('Y-m-d')];
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    private function validatedData(
        string $entity,
        array $input,
        bool $creating,
        int $userId,
        ?array $current = null,
    ): array
    {
        $timerStop = $entity === 'time_entries'
            && !$creating
            && ($current['started_at'] ?? null) !== null
            && ($current['ended_at'] ?? null) === null
            && array_key_exists('ended_at', $input)
            && array_diff(array_keys($input), ['_csrf', 'ended_at']) === [];
        $timerStart = $entity === 'time_entries'
            && filter_var($input['_timer_start'] ?? false, FILTER_VALIDATE_BOOL);
        unset($input['_csrf'], $input['_timer_start']);

        if ($timerStart) {
            $settings = $this->store?->getSettings($userId) ?? SettingsCatalog::defaults();
            $timezone = new \DateTimeZone((string) $settings['timezone']);
            $input['work_date'] ??= (new \DateTimeImmutable('now', $timezone))->format('Y-m-d');
            $input['started_at'] = gmdate('Y-m-d H:i:s');
            $input['ended_at'] = null;
            $input['duration_minutes'] = 0;
        }

        if ($entity === 'projects') {
            $requestedType = $input['project_type'] ?? ($current['project_type'] ?? ($creating ? 'personal' : null));
            if (is_scalar($requestedType) && trim((string) $requestedType) === 'personal') {
                if (array_key_exists('client_id', $input)) {
                    $input['client_id'] = null;
                }
                if (array_key_exists('due_date', $input)) {
                    $input['due_date'] = null;
                }
            }
        }

        $validated = EntityCatalog::validate($entity, $input, $creating);
        $data = $validated['data'];
        $errors = $validated['errors'];
        $spec = EntityCatalog::get($entity);

        if ($entity === 'tags' && ($creating || array_key_exists('name', $data))) {
            $name = TagNormalizer::name($data['name'] ?? '');
            $slug = TagNormalizer::slug($name);
            if ($name === '' || $slug === '') {
                $errors['name'] = 'Usa al menos una letra o un número.';
            } else {
                $data['name'] = $name;
                $data['slug'] = $slug;
                if ($this->store?->tagSlugExists($slug, $userId, $creating ? null : (int) ($current['id'] ?? 0))) {
                    $errors['name'] = 'Ya existe una etiqueta con ese nombre.';
                }
            }
        }

        if ($entity === 'projects') {
            $effectiveType = $data['project_type'] ?? ($current['project_type'] ?? 'personal');
            if ($effectiveType === 'personal') {
                $data['client_id'] = null;
                $data['due_date'] = null;
            }
        }

        foreach ($spec['fields'] as $field => $rules) {
            if (!isset($rules['foreign']) || !array_key_exists($field, $data) || $data[$field] === null) {
                continue;
            }
            if (!$this->store?->foreignExists((string) $rules['foreign'], (int) $data[$field], $userId)) {
                $errors[$field] = 'El registro relacionado no existe o no te pertenece.';
            }
        }

        if ($entity === 'time_entries') {
            $settings = $this->store?->getSettings($userId) ?? SettingsCatalog::defaults();
            if ($creating) {
                $data['hourly_cost'] = (float) $settings['default_hourly_cost'];
                $data['cost_currency'] = (string) $settings['default_currency'];
            }

            $effectiveTaskId = array_key_exists('task_id', $data) ? $data['task_id'] : ($current['task_id'] ?? null);
            $effectiveProjectId = array_key_exists('project_id', $data) ? $data['project_id'] : ($current['project_id'] ?? null);
            if (is_int($effectiveTaskId)) {
                $task = $this->store?->find('tasks', $effectiveTaskId, $userId);
                $taskProjectId = $task['project_id'] ?? null;
                if ($task !== null && $taskProjectId !== null && $effectiveProjectId === null) {
                    $data['project_id'] = (int) $taskProjectId;
                    $effectiveProjectId = (int) $taskProjectId;
                } elseif ($task !== null && $taskProjectId !== null
                    && (int) $taskProjectId !== (int) $effectiveProjectId) {
                    $errors['task_id'] = 'La tarea no pertenece al proyecto seleccionado.';
                }
            }

            $startedAt = array_key_exists('started_at', $data) ? $data['started_at'] : ($current['started_at'] ?? null);
            $endedAt = array_key_exists('ended_at', $data) ? $data['ended_at'] : ($current['ended_at'] ?? null);
            $duration = array_key_exists('duration_minutes', $data) ? $data['duration_minutes'] : ($current['duration_minutes'] ?? 0);
            if ($endedAt !== null && $startedAt === null) {
                $errors['ended_at'] = 'No puede haber una finalización sin un inicio.';
            } elseif (is_string($startedAt) && is_string($endedAt)) {
                $start = new \DateTimeImmutable($startedAt, new \DateTimeZone('UTC'));
                $end = new \DateTimeImmutable($endedAt, new \DateTimeZone('UTC'));
                $seconds = $end->getTimestamp() - $start->getTimestamp();
                if ($seconds < 0) {
                    $errors['ended_at'] = 'La finalización debe ser posterior al inicio.';
                } elseif ($seconds > 86400 && !$timerStop) {
                    $errors['ended_at'] = 'Una entrada de tiempo no puede superar 24 horas.';
                } else {
                    $data['duration_minutes'] = min(1440, (int) ceil($seconds / 60));
                }
            } elseif ($startedAt !== null && $endedAt === null) {
                $data['duration_minutes'] = 0;
                if ($this->store?->runningTimeEntry($userId, $creating ? null : (int) ($current['id'] ?? 0)) !== null) {
                    $errors['timer'] = 'Ya tienes otro temporizador en curso.';
                }
            } elseif ((int) $duration < 1) {
                $errors['duration_minutes'] = 'Un registro manual debe durar al menos un minuto.';
            }
        }

        if ($entity === 'weekly_reviews' && (
            $creating
            || (array_key_exists('week_start', $data) && $data['week_start'] !== ($current['week_start'] ?? null))
        )) {
            $weekStart = (string) ($data['week_start'] ?? $current['week_start'] ?? '');
            $settings = $this->store?->getSettings($userId) ?? SettingsCatalog::defaults();
            $expectedWeekday = $settings['week_start'] === 'sunday' ? 7 : 1;
            $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $weekStart);
            if ($date !== false && (int) $date->format('N') !== $expectedWeekday) {
                $errors['week_start'] = $expectedWeekday === 1
                    ? 'La semana debe comenzar un lunes.'
                    : 'La semana debe comenzar un domingo.';
            }
            foreach ($this->store?->list('weekly_reviews', $userId, ['week_start' => $weekStart, 'limit' => 2]) ?? [] as $review) {
                if ($creating || (int) $review['id'] !== (int) ($current['id'] ?? 0)) {
                    $errors['week_start'] = 'Ya existe una revisión para esa semana.';
                    break;
                }
            }
        }

        $errors += $this->financialErrors($entity, $data, $creating, $userId, $current);

        if ($entity === 'projects' && ($data['status'] ?? null) === 'completed') {
            $data['progress'] = 100;
        }
        if ($entity === 'tasks' && array_key_exists('status', $data)) {
            if ($data['status'] === 'done'
                && ($current['status'] ?? null) !== 'done'
                && (!array_key_exists('completed_at', $data) || $data['completed_at'] === null)) {
                $data['completed_at'] = gmdate('Y-m-d H:i:s');
            } elseif ($data['status'] === 'done'
                && ($current['status'] ?? null) === 'done'
                && ($data['completed_at'] ?? null) === null) {
                unset($data['completed_at']);
            } elseif ($data['status'] !== 'done') {
                $data['completed_at'] = null;
            }
        }

        if ($errors !== []) {
            throw new ApiException('Revisa los campos marcados.', 422, $errors);
        }
        return $data;
    }

    /**
     * @param array<string, mixed> $data
     * @param array<string, mixed>|null $current
     * @return array<string, string>
     */
    private function financialErrors(
        string $entity,
        array $data,
        bool $creating,
        int $userId,
        ?array $current,
    ): array
    {
        $errors = [];

        if ($entity === 'budgets' && $current !== null) {
            $paidAmount = (float) ($current['paid_amount'] ?? 0);
            if ($paidAmount > 0
                && array_key_exists('currency', $data)
                && $data['currency'] !== ($current['currency'] ?? null)) {
                $errors['currency'] = 'No puedes cambiar la moneda de un presupuesto que ya tiene pagos.';
            }
            if (array_key_exists('amount', $data) && (float) $data['amount'] + 0.00001 < $paidAmount) {
                $errors['amount'] = 'El monto no puede ser menor que el total ya pagado.';
            }
        }

        $paymentTotalsChanged = $entity === 'payments'
            && ($creating || array_key_exists('amount', $data) || array_key_exists('budget_id', $data));
        if (!$paymentTotalsChanged) {
            return $errors;
        }

        $budgetId = $data['budget_id'] ?? ($current['budget_id'] ?? null);
        $amount = $data['amount'] ?? ($current['amount'] ?? null);
        if (!is_int($budgetId) || !is_numeric($amount)) {
            return $errors;
        }

        $budget = $this->store?->find('budgets', $budgetId, $userId);
        if ($budget === null) {
            return $errors;
        }

        $currentAmountInBudget = !$creating
            && (int) ($current['budget_id'] ?? 0) === $budgetId
            ? (float) ($current['amount'] ?? 0)
            : 0.0;
        $totalAfterPayment = (float) ($budget['paid_amount'] ?? 0) - $currentAmountInBudget + (float) $amount;
        if ($totalAfterPayment > (float) ($budget['amount'] ?? 0) + 0.00001) {
            $errors['amount'] = 'El pago supera el saldo disponible del presupuesto.';
        }

        return $errors;
    }

    /** @param array<int, string> $allowed */
    private function only(string $method, array $allowed): void
    {
        if (!in_array($method, $allowed, true)) {
            header('Allow: ' . implode(', ', $allowed));
            throw new ApiException('Método no permitido para esta ruta.', 405);
        }
    }

    private function resourceId(mixed $raw): ?int
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        $id = filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($id === false) {
            throw new ApiException('El ID indicado no es válido.', 400);
        }
        return (int) $id;
    }

    private function route(): string
    {
        $explicit = $_GET['route'] ?? $_SERVER['CODEPANEL_ROUTE'] ?? null;
        if (is_string($explicit) && trim($explicit) !== '') {
            return trim(rawurldecode($explicit), '/');
        }

        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        $path = is_string($path) ? rawurldecode($path) : '';
        $marker = strpos($path, '/index.php');
        if ($marker !== false) {
            return trim(substr($path, $marker + strlen('/index.php')), '/');
        }
        $apiMarker = strpos($path, '/api/');
        if ($apiMarker !== false) {
            $path = substr($path, $apiMarker + strlen('/api/'));
        }
        $path = trim($path, '/');
        if (str_ends_with($path, '.php')) {
            $path = substr($path, 0, -4);
        }
        return $path;
    }

    /** @return array<string, mixed> */
    private function meta(): array
    {
        return ['demo_mode' => $this->demoMode];
    }
}
