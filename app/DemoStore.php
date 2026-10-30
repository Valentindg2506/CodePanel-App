<?php

declare(strict_types=1);

namespace CodePanel;

final class DemoStore implements DataStore
{
    private const SESSION_KEY = 'codepanel_demo_data';
    private const OVERVIEW_TASK_LIMIT = 2000;
    private const OVERVIEW_TIMELINE_LIMIT = 2000;
    private const OVERVIEW_RELEASE_LIMIT = 1000;
    private const OVERVIEW_RESOURCE_LIMIT = 1000;
    private const OVERVIEW_BUDGET_LIMIT = 1000;
    private const OVERVIEW_ATTACHMENT_LIMIT = 500;

    public function __construct()
    {
        $this->initialize();
        $this->migrateProjectTypes();
        $this->migrateProjectEnhancements();
        $this->migrateProductivityData();
    }

    public function list(string $entity, int $userId, array $filters = []): array
    {
        EntityCatalog::get($entity);
        $rows = array_values(array_filter(
            $this->rows($entity),
            static fn (array $row): bool => (int) $row['user_id'] === $userId,
        ));

        foreach ([
            'status', 'priority', 'project_type', 'client_id', 'project_id', 'budget_id',
            'task_id', 'entry_type', 'kind', 'environment', 'resource_type', 'archived',
            'billable', 'pinned', 'work_date', 'week_start',
        ] as $field) {
            if (!array_key_exists($field, $filters) || $filters[$field] === '') {
                continue;
            }
            $expected = $filters[$field];
            if (in_array($field, ['archived', 'billable', 'pinned'], true)) {
                $expected = filter_var($expected, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
                if ($expected === null) {
                    continue;
                }
            }
            $rows = array_values(array_filter(
                $rows,
                static fn (array $row): bool => array_key_exists($field, $row)
                    && (string) (intOrString($row[$field])) === (string) (intOrString($expected)),
            ));
        }

        if ($entity === 'projects' && is_scalar($filters['tech'] ?? null)) {
            $technology = mb_strtolower(trim(mb_substr((string) $filters['tech'], 0, 50)));
            if ($technology !== '') {
                $rows = array_values(array_filter($rows, static function (array $row) use ($technology): bool {
                    foreach (($row['tech_stack'] ?? []) as $item) {
                        if (mb_strtolower(trim((string) $item)) === $technology) {
                            return true;
                        }
                    }
                    return false;
                }));
            }
        }

        $search = mb_strtolower(trim((string) ($filters['search'] ?? $filters['q'] ?? '')));
        if ($search !== '') {
            $spec = EntityCatalog::get($entity);
            $rows = array_values(array_filter($rows, static function (array $row) use ($search, $spec): bool {
                foreach ($spec['search'] as $field) {
                    if (str_contains(mb_strtolower((string) ($row[$field] ?? '')), $search)) {
                        return true;
                    }
                }
                if (($spec['table'] ?? null) === 'projects') {
                    foreach (['tech_stack', 'tags'] as $field) {
                        $haystack = is_array($row[$field] ?? null)
                            ? implode(' ', $row[$field])
                            : (string) ($row[$field] ?? '');
                        if (str_contains(mb_strtolower($haystack), $search)) {
                            return true;
                        }
                    }
                }
                return false;
            }));
        }

        usort($rows, static function (array $left, array $right) use ($entity): int {
            if ($entity === 'projects') {
                $pinned = ((int) ($right['pinned'] ?? false)) <=> ((int) ($left['pinned'] ?? false));
                if ($pinned !== 0) {
                    return $pinned;
                }
            }
            if ($entity === 'tasks') {
                $statusWeight = ['in_progress' => 0, 'todo' => 1, 'done' => 2];
                $status = ($statusWeight[$left['status']] ?? 3) <=> ($statusWeight[$right['status']] ?? 3);
                if ($status !== 0) {
                    return $status;
                }
                $leftDate = $left['due_date'] ?? '9999-12-31';
                $rightDate = $right['due_date'] ?? '9999-12-31';
                return $leftDate <=> $rightDate;
            }
            return strcmp((string) $right['updated_at'], (string) $left['updated_at']);
        });

        $limit = filter_var($filters['limit'] ?? 100, FILTER_VALIDATE_INT);
        $limit = $limit === false ? 100 : max(1, min(self::LIST_LIMIT, (int) $limit));
        $rows = array_slice($rows, 0, $limit);

        return array_map(fn (array $row): array => $this->present($entity, $row), $rows);
    }

    public function find(string $entity, int $id, int $userId): ?array
    {
        EntityCatalog::get($entity);
        foreach ($this->rows($entity) as $row) {
            if ((int) $row['id'] === $id && (int) $row['user_id'] === $userId) {
                return $this->present($entity, $row);
            }
        }
        return null;
    }

    public function projectOverview(int $projectId, int $userId): ?array
    {
        $project = $this->find('projects', $projectId, $userId);
        if ($project === null) {
            return null;
        }

        $attachments = array_values(array_filter(
            $this->rows('attachments'),
            static fn (array $row): bool => (int) ($row['user_id'] ?? 0) === $userId
                && ($row['entity_type'] ?? null) === 'projects'
                && (int) ($row['entity_id'] ?? 0) === $projectId,
        ));
        usort($attachments, static fn (array $left, array $right): int =>
            strcmp((string) ($right['created_at'] ?? ''), (string) ($left['created_at'] ?? ''))
                ?: ((int) ($right['id'] ?? 0) <=> (int) ($left['id'] ?? 0))
        );

        return [
            'project' => $project,
            'tasks' => $this->projectOverviewRows('tasks', $projectId, $userId, self::OVERVIEW_TASK_LIMIT),
            'timeline' => $this->projectOverviewRows('devlogs', $projectId, $userId, self::OVERVIEW_TIMELINE_LIMIT),
            'releases' => $this->projectOverviewRows('releases', $projectId, $userId, self::OVERVIEW_RELEASE_LIMIT),
            'resources' => $this->projectOverviewRows('resources', $projectId, $userId, self::OVERVIEW_RESOURCE_LIMIT),
            'budgets' => $this->projectOverviewRows('budgets', $projectId, $userId, self::OVERVIEW_BUDGET_LIMIT),
            'attachments' => array_map(function (array $row): array {
                $attachment = $this->castAttachment($row);
                unset($attachment['stored_name']);
                return $attachment;
            }, array_slice($attachments, 0, self::OVERVIEW_ATTACHMENT_LIMIT)),
        ];
    }

    public function create(string $entity, int $userId, array $data): array
    {
        EntityCatalog::get($entity);
        $data = $this->normalizeProjectRelations($entity, $data);
        if ($entity === 'payments') {
            $this->assertDemoPaymentFitsBudget($userId, $data);
        }
        if (isset($data['tags']) && is_array($data['tags'])) {
            $data['tags'] = TagNormalizer::names($data['tags']);
            $this->syncTags($userId, $data['tags']);
        }
        $rows =& $this->rowsReference($entity);
        $max = 0;
        foreach ($rows as $row) {
            $max = max($max, (int) $row['id']);
        }
        $now = date('Y-m-d H:i:s');
        $row = array_merge($data, [
            'id' => $max + 1,
            'user_id' => $userId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $rows[] = $row;
        return $this->present($entity, $row);
    }

    public function update(string $entity, int $id, int $userId, array $data): ?array
    {
        EntityCatalog::get($entity);
        $rows =& $this->rowsReference($entity);
        foreach ($rows as $index => $row) {
            if ((int) $row['id'] !== $id || (int) $row['user_id'] !== $userId) {
                continue;
            }
            $data = $this->normalizeProjectRelations($entity, $data, $row);
            if ($entity === 'payments') {
                $this->assertDemoPaymentFitsBudget($userId, $data, $row);
            } elseif ($entity === 'budgets') {
                $this->assertDemoBudgetUpdate($userId, $data, $row);
            }
            if ($entity === 'tags' && isset($data['name']) && (string) $data['name'] !== (string) ($row['name'] ?? '')) {
                $this->replaceTagAssignments($userId, TagNormalizer::slug((string) $row['name']), (string) $data['name']);
            }
            if (isset($data['tags']) && is_array($data['tags'])) {
                $data['tags'] = TagNormalizer::names($data['tags']);
                $this->syncTags($userId, $data['tags']);
            }
            $rows[$index] = array_merge($row, $data, ['updated_at' => date('Y-m-d H:i:s')]);
            return $this->present($entity, $rows[$index]);
        }
        return null;
    }

    public function delete(string $entity, int $id, int $userId): bool
    {
        EntityCatalog::get($entity);
        $rows =& $this->rowsReference($entity);
        foreach ($rows as $index => $row) {
            if ((int) $row['id'] !== $id || (int) $row['user_id'] !== $userId) {
                continue;
            }
            if ($entity === 'tags') {
                $this->replaceTagAssignments($userId, (string) ($row['slug'] ?? ''), null);
            }
            array_splice($rows, $index, 1);
            if ($entity === 'clients') {
                $this->nullForeignKey('projects', 'client_id', $id, $userId);
                $this->nullForeignKey('budgets', 'client_id', $id, $userId);
            } elseif ($entity === 'projects') {
                $this->nullForeignKey('tasks', 'project_id', $id, $userId);
                $this->nullForeignKey('devlogs', 'project_id', $id, $userId);
                $this->nullForeignKey('budgets', 'project_id', $id, $userId);
                $this->nullForeignKey('resources', 'project_id', $id, $userId);
                $this->nullForeignKey('reminders', 'project_id', $id, $userId);
                $this->nullForeignKey('time_entries', 'project_id', $id, $userId);
                $this->deleteByForeignKey('releases', 'project_id', $id, $userId);
            } elseif ($entity === 'tasks') {
                $this->nullForeignKey('time_entries', 'task_id', $id, $userId);
            } elseif ($entity === 'budgets') {
                $this->deleteByForeignKey('payments', 'budget_id', $id, $userId);
            }
            return true;
        }
        return false;
    }

    public function foreignExists(string $entity, int $id, int $userId): bool
    {
        return $this->find($entity, $id, $userId) !== null;
    }

    public function dashboard(int $userId): array
    {
        $projects = $this->list('projects', $userId, ['limit' => 200]);
        $ideas = $this->list('ideas', $userId, ['archived' => false, 'limit' => 200]);
        $clients = $this->list('clients', $userId, ['limit' => 200]);
        $leads = $this->list('leads', $userId, ['limit' => 200]);
        $tasks = $this->list('tasks', $userId, ['limit' => 200]);

        $visibleProjects = array_values(array_filter($projects, static fn (array $row): bool => $row['status'] !== 'archived'));
        $progress = $visibleProjects === []
            ? 0
            : (int) round(array_sum(array_column($visibleProjects, 'progress')) / count($visibleProjects));
        $openLeads = array_values(array_filter($leads, static fn (array $row): bool => !in_array($row['status'], ['won', 'lost'], true)));
        $pendingTasks = array_values(array_filter($tasks, static fn (array $row): bool => $row['status'] !== 'done'));
        $settings = $this->getSettings($userId);
        $today = (new \DateTimeImmutable('now', new \DateTimeZone((string) $settings['timezone'])))->format('Y-m-d');

        $stats = [
            'projects_total' => count($projects),
            'active_projects' => count(array_filter($projects, static fn (array $row): bool => $row['status'] === 'active')),
            'project_progress' => $progress,
            'ideas' => count($ideas),
            'active_clients' => count(array_filter($clients, static fn (array $row): bool => $row['status'] === 'active')),
            'open_leads' => count($openLeads),
            'pipeline_value' => array_sum(array_column($openLeads, 'value')),
            'pending_tasks' => count($pendingTasks),
            'overdue_tasks' => count(array_filter(
                $pendingTasks,
                static fn (array $row): bool => $row['due_date'] !== null && $row['due_date'] < $today,
            )),
        ];

        usort($pendingTasks, static fn (array $a, array $b): int => ($a['due_date'] ?? '9999-12-31') <=> ($b['due_date'] ?? '9999-12-31'));
        $followUps = array_values(array_filter($openLeads, static fn (array $row): bool => $row['next_follow_up'] !== null));
        usort($followUps, static fn (array $a, array $b): int => $a['next_follow_up'] <=> $b['next_follow_up']);

        $activity = [];
        foreach ([['projects', 'project', 'name'], ['ideas', 'idea', 'title'], ['tasks', 'task', 'title']] as [$source, $type, $title]) {
            foreach ($this->list($source, $userId, ['limit' => 8]) as $row) {
                $activity[] = [
                    'type' => $type,
                    'title' => $row[$title],
                    'status' => $row['status'],
                    'created_at' => $row['updated_at'],
                ];
            }
        }
        usort($activity, static fn (array $a, array $b): int => strcmp($b['created_at'], $a['created_at']));

        return [
            'stats' => $stats,
            'projects' => array_slice($projects, 0, 5),
            'upcoming_tasks' => array_slice($pendingTasks, 0, 6),
            'recent_ideas' => array_slice($ideas, 0, 4),
            'follow_ups' => array_slice($followUps, 0, 5),
            'activity' => array_slice($activity, 0, 8),
        ];
    }

    public function getSettings(int $userId): array
    {
        $rows =& $this->rowsReference('user_settings');
        foreach ($rows as $row) {
            if ((int) ($row['user_id'] ?? 0) === $userId) {
                return SettingsCatalog::castRow($row);
            }
        }
        $row = array_merge(SettingsCatalog::defaults(), [
            'user_id' => $userId,
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ]);
        $rows[] = $row;
        return SettingsCatalog::castRow($row);
    }

    public function updateSettings(int $userId, array $data): array
    {
        $this->getSettings($userId);
        $rows =& $this->rowsReference('user_settings');
        foreach ($rows as $index => $row) {
            if ((int) ($row['user_id'] ?? 0) === $userId) {
                $rows[$index] = array_merge($row, $data, ['updated_at' => date('Y-m-d H:i:s')]);
                return SettingsCatalog::castRow($rows[$index]);
            }
        }
        throw new ApiException('No se pudieron guardar tus preferencias.', 500);
    }

    public function runningTimeEntry(int $userId, ?int $excludeId = null): ?array
    {
        foreach ($this->rows('time_entries') as $row) {
            if ((int) ($row['user_id'] ?? 0) === $userId
                && ($excludeId === null || (int) $row['id'] !== $excludeId)
                && ($row['started_at'] ?? null) !== null
                && ($row['ended_at'] ?? null) === null) {
                return $this->present('time_entries', $row);
            }
        }
        return null;
    }

    public function tagSlugExists(string $slug, int $userId, ?int $excludeId = null): bool
    {
        foreach ($this->rows('tags') as $row) {
            if ((int) ($row['user_id'] ?? 0) === $userId
                && ($excludeId === null || (int) $row['id'] !== $excludeId)
                && hash_equals((string) ($row['slug'] ?? ''), $slug)) {
                return true;
            }
        }
        return false;
    }

    public function calendar(int $userId, string $from, string $to): array
    {
        $events = [];
        $sources = [
            ['projects', 'project', 'due_date', 'name'],
            ['tasks', 'task', 'due_date', 'title'],
            ['releases', 'release', 'release_date', 'title'],
            ['resources', 'resource', 'renewal_date', 'name'],
            ['leads', 'lead', 'next_follow_up', 'name'],
            ['budgets', 'budget', 'valid_until', 'title'],
            ['payments', 'payment', 'paid_at', 'reference'],
        ];
        foreach ($sources as [$entity, $type, $dateField, $titleField]) {
            foreach ($this->rows($entity) as $row) {
                $date = $row[$dateField] ?? null;
                if ((int) ($row['user_id'] ?? 0) !== $userId || !is_string($date) || $date < $from || $date > $to) {
                    continue;
                }
                $projectId = $row['project_id'] ?? null;
                if ($entity === 'payments') {
                    $budget = $this->rawRelated('budgets', (int) ($row['budget_id'] ?? 0), $userId);
                    $projectId = $budget['project_id'] ?? null;
                    $row[$titleField] = 'Cobro · ' . ($budget['title'] ?? 'Presupuesto');
                }
                $events[] = [
                    'key' => $type . ':' . (int) $row['id'],
                    'source_type' => $type,
                    'source_id' => (int) $row['id'],
                    'date' => $date,
                    'starts_at' => null,
                    'title' => (string) (($row[$titleField] ?? null) ?: ucfirst($type)),
                    'status' => $entity === 'payments' ? 'paid' : ($row['status'] ?? null),
                    'priority' => $row['priority'] ?? null,
                    'project_id' => $projectId === null ? null : (int) $projectId,
                    'project_name' => $projectId === null ? null : $this->relatedName('projects', (int) $projectId, 'name', $userId),
                ];
            }
        }

        $settings = $this->getSettings($userId);
        $timezone = new \DateTimeZone((string) $settings['timezone']);
        $utc = new \DateTimeZone('UTC');
        foreach ($this->rows('reminders') as $row) {
            if ((int) ($row['user_id'] ?? 0) !== $userId || !is_string($row['due_at'] ?? null)) {
                continue;
            }
            $instant = new \DateTimeImmutable($row['due_at'], $utc);
            $localDate = $instant->setTimezone($timezone)->format('Y-m-d');
            if ($localDate < $from || $localDate > $to) {
                continue;
            }
            $projectId = $row['project_id'] ?? null;
            $events[] = [
                'key' => 'reminder:' . (int) $row['id'],
                'source_type' => 'reminder',
                'source_id' => (int) $row['id'],
                'date' => $localDate,
                'starts_at' => $instant->format('Y-m-d\TH:i:s\Z'),
                'title' => (string) $row['title'],
                'status' => $row['status'],
                'priority' => $row['priority'],
                'project_id' => $projectId === null ? null : (int) $projectId,
                'project_name' => $projectId === null ? null : $this->relatedName('projects', (int) $projectId, 'name', $userId),
            ];
        }
        usort($events, static fn (array $left, array $right): int => [($left['starts_at'] ?: $left['date']), $left['key']] <=> [($right['starts_at'] ?: $right['date']), $right['key']]);
        return $events;
    }

    public function profitability(int $userId): array
    {
        $settings = $this->getSettings($userId);
        $timezone = new \DateTimeZone((string) $settings['timezone']);
        $now = new \DateTimeImmutable('now', $timezone);
        $periodStart = $now->modify('first day of this month')->format('Y-m-d');
        $periodEnd = $now->modify('last day of this month')->format('Y-m-d');
        $projects = [];
        foreach ($this->list('projects', $userId, ['limit' => 200]) as $row) {
            $projects[(int) $row['id']] = $this->emptyProfitabilityProject((int) $row['id'], (string) $row['name']);
        }
        $ensure = function (?int $projectId) use (&$projects): int {
            $key = $projectId ?? 0;
            $projects[$key] ??= $this->emptyProfitabilityProject($projectId, $projectId === null ? 'Sin proyecto' : 'Proyecto eliminado');
            return $key;
        };
        foreach ($this->rows('payments') as $payment) {
            if ((int) ($payment['user_id'] ?? 0) !== $userId
                || (string) ($payment['paid_at'] ?? '') < $periodStart
                || (string) ($payment['paid_at'] ?? '') > $periodEnd) {
                continue;
            }
            $budget = $this->rawRelated('budgets', (int) $payment['budget_id'], $userId);
            if ($budget === null) {
                continue;
            }
            $key = $ensure(isset($budget['project_id']) ? (int) $budget['project_id'] : null);
            $this->addMoneyBucket($projects[$key]['income'], (string) $budget['currency'], (float) $payment['amount']);
        }
        foreach ($this->rows('time_entries') as $entry) {
            if ((int) ($entry['user_id'] ?? 0) !== $userId
                || (string) ($entry['work_date'] ?? '') < $periodStart
                || (string) ($entry['work_date'] ?? '') > $periodEnd
                || (($entry['started_at'] ?? null) !== null && ($entry['ended_at'] ?? null) === null)) {
                continue;
            }
            $key = $ensure(isset($entry['project_id']) ? (int) $entry['project_id'] : null);
            $currency = (string) ($entry['cost_currency'] ?? 'ARS');
            $minutes = (int) ($entry['duration_minutes'] ?? 0);
            $amount = ($minutes / 60) * (float) ($entry['hourly_cost'] ?? 0);
            $this->addLaborBucket($projects[$key]['labor_costs'], $currency, $minutes, $amount);
        }
        foreach ($this->rows('resources') as $resource) {
            $cycle = (string) ($resource['billing_cycle'] ?? 'none');
            $createdDate = substr((string) ($resource['created_at'] ?? ''), 0, 10);
            $inPeriod = ($cycle === 'monthly' || $cycle === 'yearly')
                ? ($resource['status'] ?? null) !== 'inactive'
                : ($cycle === 'one_time' && $createdDate >= $periodStart && $createdDate <= $periodEnd);
            if ((int) ($resource['user_id'] ?? 0) !== $userId || !$inPeriod) {
                continue;
            }
            $key = $ensure(isset($resource['project_id']) ? (int) $resource['project_id'] : null);
            $this->addResourceBucket(
                $projects[$key]['resource_costs'],
                (string) $resource['currency'],
                (string) $resource['billing_cycle'],
                (float) $resource['cost'],
            );
        }
        foreach ($projects as &$project) {
            $this->finishProfitabilityProject($project);
        }
        unset($project);
        usort($projects, static fn (array $left, array $right): int => strcmp($left['project_name'], $right['project_name']));
        return [
            'period' => ['from' => $periodStart, 'to' => $periodEnd, 'timezone' => (string) $settings['timezone']],
            'projects' => array_values($projects),
            'methodology' => [
                'income' => 'Pagos registrados dentro del mes informado.',
                'labor' => 'Tiempo terminado del mes por tarifa histórica de cada entrada.',
                'resources' => 'Recursos recurrentes activos: mensual más anual dividido por 12; costos únicos creados en el mes.',
                'currency' => 'No se convierten ni se suman monedas diferentes.',
            ],
        ];
    }

    public function attention(int $userId): array
    {
        $settings = $this->getSettings($userId);
        $timezone = new \DateTimeZone((string) $settings['timezone']);
        $today = new \DateTimeImmutable('today', $timezone);
        $days = array_map('intval', is_array($settings['reminder_days']) ? $settings['reminder_days'] : []);
        $cutoff = $today->modify('+' . max([0, ...$days]) . ' days')->format('Y-m-d');
        $todayDate = $today->format('Y-m-d');
        $items = [];
        foreach ($this->rows('reminders') as $row) {
            if ((int) ($row['user_id'] ?? 0) === $userId) {
                $item = $this->present('reminders', $row);
                $item['derived'] = false;
                $items[] = $item;
            }
        }

        $definitions = [
            ['tasks', 'task', 'due_date', static fn (array $row): bool => ($row['status'] ?? null) !== 'done', 'title', 'description'],
            ['leads', 'lead', 'next_follow_up', static fn (array $row): bool => !in_array($row['status'] ?? '', ['won', 'lost'], true), 'name', 'company'],
            ['budgets', 'budget', 'valid_until', static fn (array $row): bool => !in_array($row['status'] ?? '', ['rejected', 'expired'], true), 'title', 'notes'],
            ['releases', 'release', 'release_date', static fn (array $row): bool => !in_array($row['status'] ?? '', ['published', 'rolled_back'], true), 'title', 'notes'],
        ];
        foreach ($definitions as [$entity, $sourceType, $dateField, $visible, $titleField, $notesField]) {
            foreach ($this->rows($entity) as $row) {
                $due = $row[$dateField] ?? null;
                if ((int) ($row['user_id'] ?? 0) !== $userId || !$visible($row)
                    || !is_string($due) || $due === '' || $due > $cutoff) {
                    continue;
                }
                $title = (string) ($row[$titleField] ?? ucfirst($sourceType));
                if ($sourceType === 'lead') {
                    $title = 'Seguimiento: ' . $title;
                    $notes = ($row['company'] ?? null) ?: 'Oportunidad';
                } elseif ($sourceType === 'budget') {
                    $title = 'Vence: ' . $title;
                    $notes = isset($row['client_id'])
                        ? $this->relatedName('clients', (int) $row['client_id'], 'name', $userId)
                        : null;
                    $notes = $notes ?: 'Presupuesto';
                } elseif ($sourceType === 'release') {
                    $notes = isset($row['project_id'])
                        ? $this->relatedName('projects', (int) $row['project_id'], 'name', $userId)
                        : null;
                    $notes = $notes ?: 'Entrega';
                } else {
                    $notes = $row[$notesField] ?? null;
                }
                $projectId = $row['project_id'] ?? null;
                $items[] = [
                    'id' => 'derived-' . $sourceType . '-' . (int) $row['id'],
                    'source_type' => $sourceType, 'source_id' => (int) $row['id'],
                    'title' => $title, 'notes' => $notes, 'due_at' => $due,
                    'status' => 'pending', 'source_status' => $row['status'] ?? null,
                    'priority' => $row['priority'] ?? (in_array($sourceType, ['budget', 'release'], true) ? 'high' : 'medium'),
                    'derived' => true, 'project_id' => $projectId === null ? null : (int) $projectId,
                    'project_name' => $projectId === null ? null : $this->relatedName('projects', (int) $projectId, 'name', $userId),
                    'tags' => [],
                ];
            }
        }
        foreach ($this->rows('resources') as $row) {
            $renewal = $row['renewal_date'] ?? null;
            if ((int) ($row['user_id'] ?? 0) !== $userId || ($row['status'] ?? null) === 'inactive'
                || !((is_string($renewal) && $renewal <= $cutoff)
                    || (($row['status'] ?? null) === 'attention' && $renewal === null))) {
                continue;
            }
            $projectId = $row['project_id'] ?? null;
            $items[] = [
                'id' => 'derived-resource-' . (int) $row['id'], 'source_type' => 'resource',
                'source_id' => (int) $row['id'],
                'title' => $renewal ? 'Renovar: ' . $row['name'] : 'Revisar: ' . $row['name'],
                'notes' => ($row['provider'] ?? null) ?: 'Recurso', 'due_at' => $renewal ?: $todayDate,
                'status' => 'pending', 'source_status' => $row['status'],
                'priority' => $row['status'] === 'attention' ? 'high' : 'medium', 'derived' => true,
                'project_id' => $projectId === null ? null : (int) $projectId,
                'project_name' => $projectId === null ? null : $this->relatedName('projects', (int) $projectId, 'name', $userId),
                'tags' => [],
            ];
        }
        usort($items, static fn (array $left, array $right): int => [
            (string) ($left['due_at'] ?? ''), (string) ($left['id'] ?? ''),
        ] <=> [
            (string) ($right['due_at'] ?? ''), (string) ($right['id'] ?? ''),
        ]);
        return $items;
    }

    public function weeklySummary(int $userId, string $from, string $to): array
    {
        $settings = $this->getSettings($userId);
        $timezone = new \DateTimeZone((string) $settings['timezone']);
        $utc = new \DateTimeZone('UTC');
        $fromUtc = (new \DateTimeImmutable($from . ' 00:00:00', $timezone))->setTimezone($utc)->format('Y-m-d H:i:s');
        $afterUtc = (new \DateTimeImmutable($to . ' 23:59:59', $timezone))->setTimezone($utc)->modify('+1 second')->format('Y-m-d H:i:s');
        $tasksCompleted = 0;
        foreach ($this->rows('tasks') as $row) {
            $completed = $row['completed_at'] ?? null;
            if ((int) ($row['user_id'] ?? 0) === $userId && ($row['status'] ?? null) === 'done'
                && is_string($completed) && $completed >= $fromUtc && $completed < $afterUtc) {
                $tasksCompleted++;
            }
        }
        $time = ['minutes' => 0, 'billable_minutes' => 0, 'entries' => 0];
        foreach ($this->rows('time_entries') as $row) {
            if ((int) ($row['user_id'] ?? 0) !== $userId
                || (string) ($row['work_date'] ?? '') < $from || (string) ($row['work_date'] ?? '') > $to
                || (($row['started_at'] ?? null) !== null && ($row['ended_at'] ?? null) === null)) {
                continue;
            }
            $minutes = (int) ($row['duration_minutes'] ?? 0);
            $time['entries']++;
            $time['minutes'] += $minutes;
            if ((bool) ($row['billable'] ?? false)) {
                $time['billable_minutes'] += $minutes;
            }
        }
        $countDated = function (string $entity, string $field) use ($userId, $from, $to): int {
            return count(array_filter($this->rows($entity), static fn (array $row): bool =>
                (int) ($row['user_id'] ?? 0) === $userId
                && (string) ($row[$field] ?? '') >= $from && (string) ($row[$field] ?? '') <= $to
            ));
        };
        $paymentBuckets = [];
        foreach ($this->rows('payments') as $payment) {
            if ((int) ($payment['user_id'] ?? 0) !== $userId
                || (string) ($payment['paid_at'] ?? '') < $from || (string) ($payment['paid_at'] ?? '') > $to) {
                continue;
            }
            $budget = $this->rawRelated('budgets', (int) ($payment['budget_id'] ?? 0), $userId);
            if ($budget === null) {
                continue;
            }
            $currency = (string) ($budget['currency'] ?? 'ARS');
            $paymentBuckets[$currency] ??= ['currency' => $currency, 'amount' => 0.0, 'count' => 0];
            $paymentBuckets[$currency]['amount'] = round($paymentBuckets[$currency]['amount'] + (float) $payment['amount'], 2);
            $paymentBuckets[$currency]['count']++;
        }
        ksort($paymentBuckets);
        return [
            'period' => ['from' => $from, 'to' => $to, 'timezone' => (string) $settings['timezone']],
            'tasks_completed' => $tasksCompleted,
            'time' => $time,
            'devlogs_count' => $countDated('devlogs', 'entry_date'),
            'releases_count' => $countDated('releases', 'release_date'),
            'payments' => array_values($paymentBuckets),
        ];
    }

    public function listAttachments(int $userId, ?string $entityType = null, ?int $entityId = null): array
    {
        $rows = array_values(array_filter($this->rows('attachments'), static function (array $row) use ($userId, $entityType, $entityId): bool {
            return (int) ($row['user_id'] ?? 0) === $userId
                && ($entityType === null || ($row['entity_type'] ?? null) === $entityType)
                && ($entityId === null || (int) ($row['entity_id'] ?? -1) === $entityId);
        }));
        usort($rows, static fn (array $left, array $right): int => strcmp((string) $right['created_at'], (string) $left['created_at']));
        return array_map([$this, 'castAttachment'], array_slice($rows, 0, 200));
    }

    public function findAttachment(int $id, int $userId): ?array
    {
        foreach ($this->rows('attachments') as $row) {
            if ((int) ($row['id'] ?? 0) === $id && (int) ($row['user_id'] ?? 0) === $userId) {
                return $this->castAttachment($row);
            }
        }
        return null;
    }

    public function createAttachment(int $userId, array $data, int $quotaBytes): array
    {
        $usage = array_sum(array_map(
            static fn (array $row): int => (int) ($row['user_id'] ?? 0) === $userId ? (int) ($row['size_bytes'] ?? 0) : 0,
            $this->rows('attachments'),
        ));
        if ($usage + (int) $data['size_bytes'] > $quotaBytes) {
            throw new ApiException('Alcanzaste el límite de almacenamiento de archivos.', 413, [
                'file' => 'Elimina algún archivo antes de volver a intentarlo.',
            ]);
        }
        $rows =& $this->rowsReference('attachments');
        $id = $rows === [] ? 1 : max(array_map(static fn (array $row): int => (int) $row['id'], $rows)) + 1;
        $row = array_merge($data, ['id' => $id, 'user_id' => $userId, 'created_at' => date('Y-m-d H:i:s')]);
        $rows[] = $row;
        return $this->castAttachment($row);
    }

    public function deleteAttachment(int $id, int $userId): ?array
    {
        $rows =& $this->rowsReference('attachments');
        foreach ($rows as $index => $row) {
            if ((int) ($row['id'] ?? 0) === $id && (int) ($row['user_id'] ?? 0) === $userId) {
                array_splice($rows, $index, 1);
                return $this->castAttachment($row);
            }
        }
        return null;
    }

    public function deleteAttachmentsForEntity(string $entityType, int $entityId, int $userId): array
    {
        $deleted = array_map([$this, 'castAttachment'], array_values(array_filter(
            $this->rows('attachments'),
            static fn (array $row): bool => (int) ($row['user_id'] ?? 0) === $userId
                && ($row['entity_type'] ?? null) === $entityType
                && (int) ($row['entity_id'] ?? -1) === $entityId,
        )));
        $rows =& $this->rowsReference('attachments');
        $rows = array_values(array_filter($rows, static fn (array $row): bool =>
            (int) ($row['user_id'] ?? 0) !== $userId
            || ($row['entity_type'] ?? null) !== $entityType
            || (int) ($row['entity_id'] ?? -1) !== $entityId
        ));
        return $deleted;
    }

    public function dependentAttachmentTargets(string $entityType, int $entityId, int $userId): array
    {
        $mapping = $entityType === 'projects'
            ? ['releases', 'project_id']
            : ($entityType === 'budgets' ? ['payments', 'budget_id'] : null);
        if ($mapping === null) {
            return [];
        }
        [$childType, $foreignKey] = $mapping;
        $targets = [];
        foreach ($this->rows($childType) as $row) {
            if ((int) ($row['user_id'] ?? 0) === $userId && (int) ($row[$foreignKey] ?? 0) === $entityId) {
                $targets[] = ['entity_type' => $childType, 'entity_id' => (int) $row['id']];
            }
        }
        return $targets;
    }

    private function initialize(): void
    {
        if (isset($_SESSION[self::SESSION_KEY]) && is_array($_SESSION[self::SESSION_KEY])) {
            return;
        }

        $now = date('Y-m-d H:i:s');
        $yesterday = date('Y-m-d H:i:s', strtotime('-1 day'));
        $_SESSION[self::SESSION_KEY] = [
            'projects' => [
                [
                    'id' => 1, 'user_id' => 1, 'client_id' => 1,
                    'name' => 'Atlas Workspace',
                    'description' => 'Portal colaborativo para organizar entregas y documentación del equipo.',
                    'project_type' => 'commercial',
                    'status' => 'active', 'priority' => 'high', 'progress' => 68,
                    'due_date' => date('Y-m-d', strtotime('+12 days')),
                    'tech_stack' => ['PHP', 'MySQL', 'Alpine.js'],
                    'repository_url' => 'https://github.com/example/atlas-workspace',
                    'live_url' => null, 'color' => '#7867E6', 'pinned' => true,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-35 days')), 'updated_at' => $now,
                ],
                [
                    'id' => 2, 'user_id' => 1, 'client_id' => 2,
                    'name' => 'Marea Studio',
                    'description' => 'Sitio editorial y portfolio para un estudio creativo independiente.',
                    'project_type' => 'commercial',
                    'status' => 'active', 'priority' => 'medium', 'progress' => 42,
                    'due_date' => date('Y-m-d', strtotime('+25 days')),
                    'tech_stack' => ['Laravel', 'Tailwind CSS'],
                    'repository_url' => null, 'live_url' => 'https://example.com', 'color' => '#EF8354', 'pinned' => false,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-20 days')), 'updated_at' => $yesterday,
                ],
                [
                    'id' => 3, 'user_id' => 1, 'client_id' => null,
                    'name' => 'Snippet Garden',
                    'description' => 'Biblioteca personal de patrones y fragmentos reutilizables.',
                    'project_type' => 'personal',
                    'status' => 'planned', 'priority' => 'low', 'progress' => 12,
                    'due_date' => null, 'tech_stack' => ['PHP', 'SQLite'],
                    'repository_url' => null, 'live_url' => null, 'color' => '#35A7A0', 'pinned' => false,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-9 days')), 'updated_at' => date('Y-m-d H:i:s', strtotime('-3 days')),
                ],
            ],
            'ideas' => [
                [
                    'id' => 1, 'user_id' => 1, 'title' => 'Pairing asincrónico',
                    'description' => 'Un espacio para dejar decisiones, contexto y pequeños videos junto a cada bloque de código.',
                    'status' => 'validated', 'category' => 'SaaS', 'effort' => 4, 'impact' => 5,
                    'tags' => ['colaboración', 'developer tools'], 'archived' => false,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-7 days')), 'updated_at' => $now,
                ],
                [
                    'id' => 2, 'user_id' => 1, 'title' => 'Generador de datos de prueba',
                    'description' => 'Fixtures realistas a partir de un esquema SQL.',
                    'status' => 'exploring', 'category' => 'Open source', 'effort' => 2, 'impact' => 3,
                    'tags' => ['testing', 'CLI'], 'archived' => false,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-4 days')), 'updated_at' => $yesterday,
                ],
                [
                    'id' => 3, 'user_id' => 1, 'title' => 'Mapa de aprendizaje',
                    'description' => 'Convertir objetivos técnicos en rutas semanales pequeñas y medibles.',
                    'status' => 'inbox', 'category' => 'Educación', 'effort' => 3, 'impact' => 4,
                    'tags' => ['aprendizaje'], 'archived' => false,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-2 days')), 'updated_at' => date('Y-m-d H:i:s', strtotime('-2 days')),
                ],
            ],
            'clients' => [
                [
                    'id' => 1, 'user_id' => 1, 'name' => 'Lucía Ferrer', 'company' => 'Norte Labs',
                    'email' => 'lucia@example.com', 'phone' => '+54 11 5555 0182', 'website' => 'https://example.com',
                    'status' => 'active', 'source' => 'Recomendación', 'notes' => 'Prefiere actualizaciones breves los viernes.',
                    'last_contact' => date('Y-m-d', strtotime('-3 days')), 'created_at' => date('Y-m-d H:i:s', strtotime('-60 days')), 'updated_at' => $yesterday,
                ],
                [
                    'id' => 2, 'user_id' => 1, 'name' => 'Tomás Vidal', 'company' => 'Marea',
                    'email' => 'tomas@example.com', 'phone' => null, 'website' => null,
                    'status' => 'active', 'source' => 'Portfolio', 'notes' => null,
                    'last_contact' => date('Y-m-d', strtotime('-8 days')), 'created_at' => date('Y-m-d H:i:s', strtotime('-28 days')), 'updated_at' => date('Y-m-d H:i:s', strtotime('-5 days')),
                ],
            ],
            'leads' => [
                [
                    'id' => 1, 'user_id' => 1, 'name' => 'Inés Prado', 'company' => 'Bruma',
                    'email' => 'ines@example.com', 'phone' => null, 'status' => 'qualified', 'value' => 2400.0,
                    'source' => 'LinkedIn', 'next_follow_up' => date('Y-m-d', strtotime('+2 days')),
                    'notes' => 'Necesita una estimación para su MVP.', 'created_at' => date('Y-m-d H:i:s', strtotime('-12 days')), 'updated_at' => $now,
                ],
                [
                    'id' => 2, 'user_id' => 1, 'name' => 'Martín Paz', 'company' => 'Circular',
                    'email' => 'martin@example.com', 'phone' => null, 'status' => 'proposal', 'value' => 3900.0,
                    'source' => 'Evento', 'next_follow_up' => date('Y-m-d', strtotime('+5 days')),
                    'notes' => null, 'created_at' => date('Y-m-d H:i:s', strtotime('-18 days')), 'updated_at' => $yesterday,
                ],
            ],
            'tasks' => [
                [
                    'id' => 1, 'user_id' => 1, 'project_id' => 1, 'title' => 'Cerrar flujo de onboarding',
                    'description' => 'Validar los estados vacíos y el primer acceso.', 'status' => 'in_progress', 'priority' => 'high',
                    'assignee' => null, 'due_date' => date('Y-m-d', strtotime('+1 day')), 'completed_at' => null,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-5 days')), 'updated_at' => $now,
                ],
                [
                    'id' => 2, 'user_id' => 1, 'project_id' => 2, 'title' => 'Optimizar imágenes del portfolio',
                    'description' => null, 'status' => 'todo', 'priority' => 'medium', 'assignee' => null,
                    'due_date' => date('Y-m-d', strtotime('+4 days')), 'completed_at' => null,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-3 days')), 'updated_at' => $yesterday,
                ],
                [
                    'id' => 3, 'user_id' => 1, 'project_id' => 1, 'title' => 'Publicar notas de la versión',
                    'description' => null, 'status' => 'todo', 'priority' => 'low', 'assignee' => null,
                    'due_date' => date('Y-m-d', strtotime('+8 days')), 'completed_at' => null,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-2 days')), 'updated_at' => date('Y-m-d H:i:s', strtotime('-2 days')),
                ],
            ],
            'devlogs' => [
                [
                    'id' => 1, 'user_id' => 1, 'project_id' => 1,
                    'entry_date' => date('Y-m-d'), 'title' => 'Onboarding conectado de punta a punta',
                    'content' => 'Quedaron listos los estados vacíos, la invitación y el primer acceso.',
                    'entry_type' => 'progress', 'minutes_spent' => 95,
                    'tags' => ['onboarding', 'backend'],
                    'created_at' => $now, 'updated_at' => $now,
                ],
                [
                    'id' => 2, 'user_id' => 1, 'project_id' => 2,
                    'entry_date' => date('Y-m-d', strtotime('-1 day')), 'title' => 'Decisión sobre formatos de imagen',
                    'content' => 'WebP será el formato principal y JPEG quedará como fallback.',
                    'entry_type' => 'decision', 'minutes_spent' => 35,
                    'tags' => ['performance', 'frontend'],
                    'created_at' => $yesterday, 'updated_at' => $yesterday,
                ],
            ],
            'budgets' => [
                [
                    'id' => 1, 'user_id' => 1, 'client_id' => 1, 'project_id' => 1,
                    'title' => 'Implementación de Atlas Workspace', 'status' => 'approved',
                    'currency' => 'ARS', 'amount' => 450000.0,
                    'valid_until' => date('Y-m-d', strtotime('+15 days')),
                    'notes' => 'Incluye implementación, QA y puesta en producción.',
                    'created_at' => date('Y-m-d H:i:s', strtotime('-30 days')), 'updated_at' => $now,
                ],
                [
                    'id' => 2, 'user_id' => 1, 'client_id' => 2, 'project_id' => 2,
                    'title' => 'Portfolio Marea Studio', 'status' => 'sent',
                    'currency' => 'USD', 'amount' => 1800.0,
                    'valid_until' => date('Y-m-d', strtotime('+10 days')), 'notes' => null,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-8 days')), 'updated_at' => $yesterday,
                ],
            ],
            'payments' => [
                [
                    'id' => 1, 'user_id' => 1, 'budget_id' => 1, 'amount' => 150000.0,
                    'paid_at' => date('Y-m-d', strtotime('-20 days')), 'method' => 'transfer',
                    'reference' => 'TRX-ATLAS-001', 'notes' => 'Anticipo inicial.',
                    'created_at' => date('Y-m-d H:i:s', strtotime('-20 days')), 'updated_at' => date('Y-m-d H:i:s', strtotime('-20 days')),
                ],
                [
                    'id' => 2, 'user_id' => 1, 'budget_id' => 1, 'amount' => 100000.0,
                    'paid_at' => date('Y-m-d', strtotime('-5 days')), 'method' => 'digital_wallet',
                    'reference' => null, 'notes' => 'Segundo hito aprobado.',
                    'created_at' => date('Y-m-d H:i:s', strtotime('-5 days')), 'updated_at' => date('Y-m-d H:i:s', strtotime('-5 days')),
                ],
            ],
            'releases' => [
                [
                    'id' => 1, 'user_id' => 1, 'project_id' => 1,
                    'title' => 'Beta privada', 'version' => 'v0.8.0', 'kind' => 'version',
                    'environment' => 'staging', 'status' => 'published',
                    'release_date' => date('Y-m-d', strtotime('-2 days')),
                    'url' => 'https://staging.example.com', 'notes' => 'Disponible para revisión del cliente.',
                    'created_at' => date('Y-m-d H:i:s', strtotime('-6 days')), 'updated_at' => date('Y-m-d H:i:s', strtotime('-2 days')),
                ],
                [
                    'id' => 2, 'user_id' => 1, 'project_id' => 2,
                    'title' => 'Entrega del portfolio', 'version' => null, 'kind' => 'delivery',
                    'environment' => 'client', 'status' => 'ready',
                    'release_date' => date('Y-m-d', strtotime('+4 days')),
                    'url' => null, 'notes' => 'Pendiente de aprobación editorial.',
                    'created_at' => date('Y-m-d H:i:s', strtotime('-3 days')), 'updated_at' => $yesterday,
                ],
            ],
            'resources' => [
                [
                    'id' => 1, 'user_id' => 1, 'project_id' => 1, 'name' => 'Servidor de producción',
                    'resource_type' => 'server', 'provider' => 'DigitalOcean',
                    'url' => 'https://cloud.digitalocean.com', 'environment' => 'production',
                    'status' => 'attention', 'renewal_date' => date('Y-m-d', strtotime('+7 days')),
                    'cost' => 12.0, 'currency' => 'USD', 'billing_cycle' => 'monthly',
                    'notes' => 'Revisar uso de disco antes de renovar.',
                    'created_at' => date('Y-m-d H:i:s', strtotime('-25 days')), 'updated_at' => $now,
                ],
                [
                    'id' => 2, 'user_id' => 1, 'project_id' => 2, 'name' => 'marea.studio',
                    'resource_type' => 'domain', 'provider' => 'Namecheap',
                    'url' => 'https://www.namecheap.com', 'environment' => 'production',
                    'status' => 'active', 'renewal_date' => date('Y-m-d', strtotime('+180 days')),
                    'cost' => 18.0, 'currency' => 'USD', 'billing_cycle' => 'yearly',
                    'notes' => null,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-15 days')), 'updated_at' => $yesterday,
                ],
                [
                    'id' => 3, 'user_id' => 1, 'project_id' => null, 'name' => 'Guía de despliegues',
                    'resource_type' => 'documentation', 'provider' => null,
                    'url' => 'https://example.com/docs', 'environment' => 'shared',
                    'status' => 'active', 'renewal_date' => null,
                    'cost' => 0.0, 'currency' => 'ARS', 'billing_cycle' => 'none',
                    'notes' => 'Checklist compartido para todos los proyectos.',
                    'created_at' => date('Y-m-d H:i:s', strtotime('-10 days')), 'updated_at' => date('Y-m-d H:i:s', strtotime('-3 days')),
                ],
            ],
        ];
    }

    /** @return array<int, array<string, mixed>> */
    private function rows(string $entity): array
    {
        $data = $_SESSION[self::SESSION_KEY] ?? [];
        return is_array($data[$entity] ?? null) ? $data[$entity] : [];
    }

    /** @return array<int, array<string, mixed>> */
    private function &rowsReference(string $entity): array
    {
        if (!isset($_SESSION[self::SESSION_KEY][$entity]) || !is_array($_SESSION[self::SESSION_KEY][$entity])) {
            $_SESSION[self::SESSION_KEY][$entity] = [];
        }
        return $_SESSION[self::SESSION_KEY][$entity];
    }

    /** @return array<int, array<string, mixed>> */
    private function projectOverviewRows(string $entity, int $projectId, int $userId, int $limit): array
    {
        $rows = array_values(array_filter(
            $this->rows($entity),
            static fn (array $row): bool => (int) ($row['user_id'] ?? 0) === $userId
                && (int) ($row['project_id'] ?? 0) === $projectId,
        ));
        usort($rows, static function (array $left, array $right) use ($entity): int {
            if ($entity === 'tasks') {
                $statusWeight = ['in_progress' => 0, 'todo' => 1, 'done' => 2];
                $status = ($statusWeight[$left['status'] ?? ''] ?? 3)
                    <=> ($statusWeight[$right['status'] ?? ''] ?? 3);
                if ($status !== 0) {
                    return $status;
                }
                $dueDate = ($left['due_date'] ?? '9999-12-31') <=> ($right['due_date'] ?? '9999-12-31');
                if ($dueDate !== 0) {
                    return $dueDate;
                }
            } elseif ($entity === 'devlogs') {
                $entryDate = strcmp((string) ($right['entry_date'] ?? ''), (string) ($left['entry_date'] ?? ''));
                if ($entryDate !== 0) {
                    return $entryDate;
                }
            } elseif ($entity === 'releases') {
                $leftDate = $left['release_date'] ?? null;
                $rightDate = $right['release_date'] ?? null;
                if (($leftDate === null) !== ($rightDate === null)) {
                    return $leftDate === null ? 1 : -1;
                }
                $releaseDate = strcmp((string) $rightDate, (string) $leftDate);
                if ($releaseDate !== 0) {
                    return $releaseDate;
                }
            }
            return strcmp((string) ($right['updated_at'] ?? ''), (string) ($left['updated_at'] ?? ''));
        });
        return array_map(
            fn (array $row): array => $this->present($entity, $row),
            array_slice($rows, 0, $limit),
        );
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    private function present(string $entity, array $row): array
    {
        $userId = (int) ($row['user_id'] ?? 0);
        if ($entity === 'projects') {
            $row['project_type'] ??= ($row['client_id'] ?? null) !== null || ($row['due_date'] ?? null) !== null
                ? 'commercial'
                : 'personal';
            $clientId = $row['client_id'] ?? null;
            $row['client_name'] = $clientId === null ? null : $this->relatedName('clients', (int) $clientId, 'name', $userId);
        } elseif (in_array($entity, ['tasks', 'devlogs', 'releases', 'resources', 'reminders'], true)) {
            $projectId = $row['project_id'] ?? null;
            $row['project_name'] = $projectId === null ? null : $this->relatedName('projects', (int) $projectId, 'name', $userId);
        } elseif ($entity === 'budgets') {
            $clientId = $row['client_id'] ?? null;
            $projectId = $row['project_id'] ?? null;
            $row['client_name'] = $clientId === null ? null : $this->relatedName('clients', (int) $clientId, 'name', $userId);
            $row['project_name'] = $projectId === null ? null : $this->relatedName('projects', (int) $projectId, 'name', $userId);
            $paidAmount = 0.0;
            foreach ($this->rows('payments') as $payment) {
                if ((int) ($payment['user_id'] ?? 0) === $userId
                    && (int) ($payment['budget_id'] ?? 0) === (int) $row['id']) {
                    $paidAmount += (float) ($payment['amount'] ?? 0);
                }
            }
            $row['paid_amount'] = round($paidAmount, 2);
            $row['balance'] = round((float) ($row['amount'] ?? 0) - $paidAmount, 2);
        } elseif ($entity === 'payments') {
            $row['budget_title'] = $this->relatedName('budgets', (int) $row['budget_id'], 'title', $userId);
        } elseif ($entity === 'time_entries') {
            $projectId = $row['project_id'] ?? null;
            $taskId = $row['task_id'] ?? null;
            $row['project_name'] = $projectId === null ? null : $this->relatedName('projects', (int) $projectId, 'name', $userId);
            $row['task_title'] = $taskId === null ? null : $this->relatedName('tasks', (int) $taskId, 'title', $userId);
            $row['is_running'] = ($row['started_at'] ?? null) !== null && ($row['ended_at'] ?? null) === null;
        } elseif ($entity === 'tags') {
            $usage = 0;
            $slug = (string) ($row['slug'] ?? '');
            foreach (['projects', 'tasks', 'clients', 'leads', 'ideas', 'devlogs', 'budgets', 'releases', 'resources', 'reminders', 'time_entries', 'weekly_reviews'] as $taggedEntity) {
                foreach ($this->rows($taggedEntity) as $taggedRow) {
                    if ((int) ($taggedRow['user_id'] ?? 0) !== $userId) {
                        continue;
                    }
                    foreach (($taggedRow['tags'] ?? []) as $name) {
                        if (TagNormalizer::slug((string) $name) === $slug) {
                            $usage++;
                            break;
                        }
                    }
                }
            }
            $row['usage_count'] = $usage;
        }
        return EntityCatalog::castRow($entity, $row);
    }

    /** Brings sessions created before project_type existed forward without discarding demo data. */
    private function migrateProjectTypes(): void
    {
        $projects =& $this->rowsReference('projects');
        foreach ($projects as $index => $project) {
            $projectType = $project['project_type'] ?? (
                ($project['client_id'] ?? null) !== null || ($project['due_date'] ?? null) !== null
                    ? 'commercial'
                    : 'personal'
            );
            $projects[$index]['project_type'] = $projectType;
            if ($projectType === 'personal') {
                $projects[$index]['client_id'] = null;
                $projects[$index]['due_date'] = null;
            }
        }
    }

    /** Brings sessions created before project pinning existed forward in place. */
    private function migrateProjectEnhancements(): void
    {
        $projects =& $this->rowsReference('projects');
        foreach ($projects as $index => $project) {
            $projects[$index]['pinned'] = (bool) ($project['pinned'] ?? false);
        }
    }

    /** Adds new demo collections without replacing data created in older sessions. */
    private function migrateProductivityData(): void
    {
        foreach (['projects', 'tasks', 'clients', 'leads', 'budgets', 'releases', 'resources', 'ideas', 'devlogs'] as $entity) {
            $rows =& $this->rowsReference($entity);
            foreach ($rows as $index => $row) {
                if (!isset($row['tags']) || !is_array($row['tags'])) {
                    $rows[$index]['tags'] = [];
                }
            }
            unset($rows);
        }

        if (!isset($_SESSION[self::SESSION_KEY]['reminders'])) {
            $now = gmdate('Y-m-d H:i:s');
            $_SESSION[self::SESSION_KEY]['reminders'] = [
                [
                    'id' => 1, 'user_id' => 1, 'project_id' => 1,
                    'title' => 'Revisar devolución de la beta',
                    'due_at' => gmdate('Y-m-d H:i:s', strtotime('+2 days 15:00 UTC')),
                    'status' => 'pending', 'priority' => 'high',
                    'notes' => 'Preparar una lista breve de ajustes antes de la llamada.',
                    'tags' => ['cliente', 'beta'], 'created_at' => $now, 'updated_at' => $now,
                ],
                [
                    'id' => 2, 'user_id' => 1, 'project_id' => null,
                    'title' => 'Revisión semanal',
                    'due_at' => gmdate('Y-m-d H:i:s', strtotime('next friday 18:00 UTC')),
                    'status' => 'pending', 'priority' => 'medium', 'notes' => null,
                    'tags' => ['organización'], 'created_at' => $now, 'updated_at' => $now,
                ],
            ];
        }
        if (!isset($_SESSION[self::SESSION_KEY]['time_entries'])) {
            $now = date('Y-m-d H:i:s');
            $_SESSION[self::SESSION_KEY]['time_entries'] = [
                [
                    'id' => 1, 'user_id' => 1, 'project_id' => 1, 'task_id' => 1,
                    'work_date' => date('Y-m-d'), 'description' => 'Ajustes del onboarding',
                    'duration_minutes' => 95, 'started_at' => null, 'ended_at' => null,
                    'billable' => true, 'hourly_cost' => 8000.0, 'cost_currency' => 'ARS',
                    'tags' => ['backend'], 'created_at' => $now, 'updated_at' => $now,
                ],
                [
                    'id' => 2, 'user_id' => 1, 'project_id' => 2, 'task_id' => 2,
                    'work_date' => date('Y-m-d', strtotime('-1 day')), 'description' => 'Optimización de imágenes',
                    'duration_minutes' => 70, 'started_at' => null, 'ended_at' => null,
                    'billable' => true, 'hourly_cost' => 35.0, 'cost_currency' => 'USD',
                    'tags' => ['frontend'], 'created_at' => $now, 'updated_at' => $now,
                ],
            ];
        }
        if (!isset($_SESSION[self::SESSION_KEY]['weekly_reviews'])) {
            $weekStart = date('Y-m-d', strtotime('monday this week'));
            $now = date('Y-m-d H:i:s');
            $_SESSION[self::SESSION_KEY]['weekly_reviews'] = [[
                'id' => 1, 'user_id' => 1, 'week_start' => $weekStart,
                'wins' => 'La beta privada quedó disponible para revisión.',
                'blockers' => 'Falta validar el flujo de recuperación de acceso.',
                'next_focus' => 'Cerrar onboarding y preparar la próxima entrega.',
                'rating' => 4, 'tags' => ['revisión'], 'created_at' => $now, 'updated_at' => $now,
            ]];
        }
        $_SESSION[self::SESSION_KEY]['attachments'] ??= [];
        $_SESSION[self::SESSION_KEY]['tags'] ??= [];
        $_SESSION[self::SESSION_KEY]['user_settings'] ??= [[
            'user_id' => 1,
            ...SettingsCatalog::defaults(),
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ]];

        foreach (['projects', 'tasks', 'clients', 'leads', 'ideas', 'devlogs', 'budgets', 'releases', 'resources', 'reminders', 'time_entries', 'weekly_reviews'] as $entity) {
            foreach ($this->rows($entity) as $row) {
                if (isset($row['tags']) && is_array($row['tags'])) {
                    $this->syncTags((int) ($row['user_id'] ?? 1), $row['tags']);
                }
            }
        }
    }

    /** @param array<int, mixed> $tags */
    private function syncTags(int $userId, array $tags): void
    {
        $rows =& $this->rowsReference('tags');
        foreach (TagNormalizer::names($tags) as $name) {
            $slug = TagNormalizer::slug($name);
            if ($slug === '' || $this->tagSlugExists($slug, $userId)) {
                continue;
            }
            $max = $rows === [] ? 0 : max(array_map(static fn (array $row): int => (int) $row['id'], $rows));
            $now = date('Y-m-d H:i:s');
            $rows[] = [
                'id' => $max + 1, 'user_id' => $userId, 'name' => $name,
                'slug' => $slug, 'color' => '#7867E6', 'created_at' => $now, 'updated_at' => $now,
            ];
        }
    }

    private function replaceTagAssignments(int $userId, string $oldSlug, ?string $newName): void
    {
        if ($oldSlug === '') {
            return;
        }
        foreach (['projects', 'tasks', 'clients', 'leads', 'ideas', 'devlogs', 'budgets', 'releases', 'resources', 'reminders', 'time_entries', 'weekly_reviews'] as $entity) {
            $rows =& $this->rowsReference($entity);
            foreach ($rows as $index => $row) {
                if ((int) ($row['user_id'] ?? 0) !== $userId || !is_array($row['tags'] ?? null)) {
                    continue;
                }
                $changed = false;
                $next = [];
                foreach ($row['tags'] as $name) {
                    if (TagNormalizer::slug((string) $name) === $oldSlug) {
                        $changed = true;
                        if ($newName !== null) {
                            $next[] = $newName;
                        }
                    } else {
                        $next[] = $name;
                    }
                }
                if ($changed) {
                    $rows[$index]['tags'] = TagNormalizer::names($next);
                    $rows[$index]['updated_at'] = date('Y-m-d H:i:s');
                }
            }
            unset($rows);
        }
    }

    /** @return array<string, mixed>|null */
    private function rawRelated(string $entity, int $id, int $userId): ?array
    {
        foreach ($this->rows($entity) as $row) {
            if ((int) ($row['id'] ?? 0) === $id && (int) ($row['user_id'] ?? 0) === $userId) {
                return $row;
            }
        }
        return null;
    }

    /** @return array<string, mixed> */
    private function emptyProfitabilityProject(?int $projectId, string $projectName): array
    {
        return [
            'project_id' => $projectId, 'project_name' => $projectName,
            'income' => [], 'labor_costs' => [], 'resource_costs' => [],
            'mixed_currencies' => false, 'net' => null,
        ];
    }

    /** @param array<int, array<string, mixed>> $buckets */
    private function addMoneyBucket(array &$buckets, string $currency, float $amount): void
    {
        foreach ($buckets as $index => $bucket) {
            if ($bucket['currency'] === $currency) {
                $buckets[$index]['amount'] = round((float) $bucket['amount'] + $amount, 2);
                return;
            }
        }
        $buckets[] = ['currency' => $currency, 'amount' => round($amount, 2)];
    }

    /** @param array<int, array<string, mixed>> $buckets */
    private function addLaborBucket(array &$buckets, string $currency, int $minutes, float $amount): void
    {
        foreach ($buckets as $index => $bucket) {
            if ($bucket['currency'] === $currency) {
                $buckets[$index]['minutes'] += $minutes;
                $buckets[$index]['amount'] = round((float) $bucket['amount'] + $amount, 2);
                return;
            }
        }
        $buckets[] = ['currency' => $currency, 'minutes' => $minutes, 'amount' => round($amount, 2)];
    }

    /** @param array<int, array<string, mixed>> $buckets */
    private function addResourceBucket(array &$buckets, string $currency, string $cycle, float $amount): void
    {
        foreach ($buckets as $index => $bucket) {
            if ($bucket['currency'] !== $currency) {
                continue;
            }
            $buckets[$index][$cycle] = round((float) $buckets[$index][$cycle] + $amount, 2);
            $buckets[$index]['monthly_equivalent'] = round(
                (float) $buckets[$index]['monthly'] + ((float) $buckets[$index]['yearly'] / 12),
                2,
            );
            return;
        }
        $bucket = ['currency' => $currency, 'monthly' => 0.0, 'yearly' => 0.0, 'monthly_equivalent' => 0.0, 'one_time' => 0.0];
        $bucket[$cycle] = round($amount, 2);
        $bucket['monthly_equivalent'] = round((float) $bucket['monthly'] + ((float) $bucket['yearly'] / 12), 2);
        $buckets[] = $bucket;
    }

    /** @param array<string, mixed> $project */
    private function finishProfitabilityProject(array &$project): void
    {
        $currencies = [];
        foreach (['income', 'labor_costs', 'resource_costs'] as $bucket) {
            foreach ($project[$bucket] as $row) {
                $currencies[(string) $row['currency']] = true;
            }
        }
        $project['mixed_currencies'] = count($currencies) > 1;
        if (count($currencies) !== 1) {
            $project['net'] = null;
            return;
        }
        $currency = (string) array_key_first($currencies);
        $income = array_sum(array_column($project['income'], 'amount'));
        $labor = array_sum(array_column($project['labor_costs'], 'amount'));
        $monthly = array_sum(array_column($project['resource_costs'], 'monthly_equivalent'));
        $oneTime = array_sum(array_column($project['resource_costs'], 'one_time'));
        $project['net'] = [
            'currency' => $currency, 'income' => round($income, 2), 'labor_cost' => round($labor, 2),
            'monthly_resource_cost' => round($monthly, 2), 'one_time_resource_cost' => round($oneTime, 2),
            'estimated_monthly_net' => round($income - $labor - $monthly, 2),
            'estimated_net_after_one_time' => round($income - $labor - $monthly - $oneTime, 2),
            'estimated' => true,
        ];
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    private function castAttachment(array $row): array
    {
        $row['id'] = (int) ($row['id'] ?? 0);
        $row['entity_id'] = (int) ($row['entity_id'] ?? 0);
        $row['size_bytes'] = (int) ($row['size_bytes'] ?? 0);
        unset($row['user_id']);
        return $row;
    }

    /**
     * @param array<string, mixed> $data
     * @param array<string, mixed>|null $current
     * @return array<string, mixed>
     */
    private function normalizeProjectRelations(string $entity, array $data, ?array $current = null): array
    {
        if ($entity !== 'projects') {
            return $data;
        }

        $projectType = $data['project_type'] ?? ($current['project_type'] ?? 'personal');
        $data['project_type'] = $projectType;
        if ($projectType === 'personal') {
            $data['client_id'] = null;
            $data['due_date'] = null;
        }
        return $data;
    }

    /**
     * @param array<string, mixed> $data
     * @param array<string, mixed>|null $current
     */
    private function assertDemoPaymentFitsBudget(int $userId, array $data, ?array $current = null): void
    {
        $budgetId = (int) ($data['budget_id'] ?? $current['budget_id'] ?? 0);
        $amount = (float) ($data['amount'] ?? $current['amount'] ?? 0);
        $budget = $this->rawRelated('budgets', $budgetId, $userId);
        if ($budget === null) {
            throw new ApiException('El presupuesto indicado no está disponible.', 422, [
                'budget_id' => 'El presupuesto no existe o no te pertenece.',
            ]);
        }
        $paidAmount = 0.0;
        foreach ($this->rows('payments') as $payment) {
            if ((int) ($payment['user_id'] ?? 0) !== $userId
                || (int) ($payment['budget_id'] ?? 0) !== $budgetId
                || ($current !== null && (int) ($payment['id'] ?? 0) === (int) $current['id'])) {
                continue;
            }
            $paidAmount += (float) ($payment['amount'] ?? 0);
        }
        if ($paidAmount + $amount > (float) ($budget['amount'] ?? 0) + 0.00001) {
            throw new ApiException('El pago supera el saldo disponible del presupuesto.', 422, [
                'amount' => 'El pago supera el saldo disponible del presupuesto.',
            ]);
        }
    }

    /** @param array<string, mixed> $data @param array<string, mixed> $current */
    private function assertDemoBudgetUpdate(int $userId, array $data, array $current): void
    {
        $paidAmount = 0.0;
        foreach ($this->rows('payments') as $payment) {
            if ((int) ($payment['user_id'] ?? 0) === $userId
                && (int) ($payment['budget_id'] ?? 0) === (int) $current['id']) {
                $paidAmount += (float) ($payment['amount'] ?? 0);
            }
        }
        if ((float) ($data['amount'] ?? $current['amount']) + 0.00001 < $paidAmount) {
            throw new ApiException('El monto no puede ser menor que el total ya pagado.', 422, [
                'amount' => 'El monto no puede ser menor que el total ya pagado.',
            ]);
        }
        if ($paidAmount > 0.00001
            && (string) ($data['currency'] ?? $current['currency']) !== (string) $current['currency']) {
            throw new ApiException('No puedes cambiar la moneda de un presupuesto que ya tiene pagos.', 422, [
                'currency' => 'No puedes cambiar la moneda de un presupuesto que ya tiene pagos.',
            ]);
        }
    }

    private function relatedName(string $entity, int $id, string $field, int $userId): ?string
    {
        foreach ($this->rows($entity) as $row) {
            if ((int) $row['id'] === $id && (int) ($row['user_id'] ?? 0) === $userId) {
                return isset($row[$field]) ? (string) $row[$field] : null;
            }
        }
        return null;
    }

    private function nullForeignKey(string $entity, string $field, int $id, int $userId): void
    {
        $rows =& $this->rowsReference($entity);
        foreach ($rows as $index => $row) {
            if ((int) $row['user_id'] === $userId && (int) ($row[$field] ?? 0) === $id) {
                $rows[$index][$field] = null;
                $rows[$index]['updated_at'] = date('Y-m-d H:i:s');
            }
        }
    }

    private function deleteByForeignKey(string $entity, string $field, int $id, int $userId): void
    {
        $rows =& $this->rowsReference($entity);
        $rows = array_values(array_filter(
            $rows,
            static fn (array $row): bool => (int) ($row['user_id'] ?? 0) !== $userId
                || (int) ($row[$field] ?? 0) !== $id,
        ));
    }
}

/** @internal Keeps demo comparisons stable across booleans/numbers. */
function intOrString(mixed $value): int|string
{
    return is_bool($value) ? (int) $value : (is_scalar($value) ? (string) $value : '');
}
