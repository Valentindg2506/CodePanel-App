<?php

declare(strict_types=1);

namespace CodePanel;

use JsonException;
use PDO;
use PDOException;

final class DatabaseStore implements DataStore
{
    private const OVERVIEW_TASK_LIMIT = 2000;
    private const OVERVIEW_TIMELINE_LIMIT = 2000;
    private const OVERVIEW_RELEASE_LIMIT = 1000;
    private const OVERVIEW_RESOURCE_LIMIT = 1000;
    private const OVERVIEW_BUDGET_LIMIT = 1000;
    private const OVERVIEW_ATTACHMENT_LIMIT = 500;

    /** @var array<int, bool> */
    private array $tagsSynchronized = [];
    /** @var array<int, array<string, int>> */
    private array $tagUsageCounts = [];

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function list(string $entity, int $userId, array $filters = []): array
    {
        if ($entity === 'tags') {
            $this->syncExistingTags($userId);
        }
        $spec = EntityCatalog::get($entity);
        $table = $spec['table'];
        [$select, $join] = $this->selectParts($entity);
        $where = ['t.user_id = :user_id'];
        $params = [':user_id' => $userId];

        /** @var array<string, array<string, mixed>> $fields */
        $fields = $spec['fields'];
        foreach ([
            'status', 'priority', 'project_type', 'client_id', 'project_id', 'budget_id',
            'task_id', 'entry_type', 'kind', 'environment', 'resource_type', 'archived',
            'billable', 'pinned', 'work_date', 'week_start',
        ] as $field) {
            if (!array_key_exists($field, $filters) || !array_key_exists($field, $fields)) {
                continue;
            }
            $value = $filters[$field];
            if (!is_scalar($value) || (is_string($value) && trim($value) === '')) {
                continue;
            }
            if ($fields[$field]['type'] === 'enum' && !in_array((string) $value, $fields[$field]['values'], true)) {
                continue;
            }
            if ($fields[$field]['type'] === 'int' && filter_var($value, FILTER_VALIDATE_INT) === false) {
                continue;
            }
            if ($fields[$field]['type'] === 'bool') {
                $normalized = filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
                if ($normalized === null) {
                    continue;
                }
                $value = $normalized ? 1 : 0;
            }
            $where[] = "t.{$field} = :{$field}";
            $params[":{$field}"] = $value;
        }

        if ($entity === 'projects' && is_scalar($filters['tech'] ?? null)) {
            $technology = trim(mb_substr((string) $filters['tech'], 0, 50));
            if ($technology !== '') {
                // JSON values are compared as full array elements, not as substrings.
                $where[] = 'JSON_CONTAINS(LOWER(CAST(t.tech_stack AS CHAR)), JSON_QUOTE(LOWER(:tech))) = 1';
                $params[':tech'] = $technology;
            }
        }

        $search = trim((string) ($filters['search'] ?? $filters['q'] ?? ''));
        if ($search !== '') {
            $search = mb_substr($search, 0, 100);
            $parts = [];
            foreach ($spec['search'] as $index => $field) {
                $parameter = ':search_' . $index;
                $parts[] = "t.{$field} LIKE {$parameter}";
                $params[$parameter] = '%' . $search . '%';
            }
            if ($entity === 'projects') {
                foreach (['tech_stack', 'tags'] as $field) {
                    $parameter = ':search_' . count($parts);
                    $parts[] = "CAST(t.{$field} AS CHAR) LIKE {$parameter}";
                    $params[$parameter] = '%' . $search . '%';
                }
            }
            $where[] = '(' . implode(' OR ', $parts) . ')';
        }

        $limit = filter_var($filters['limit'] ?? 100, FILTER_VALIDATE_INT);
        $limit = $limit === false ? 100 : max(1, min(self::LIST_LIMIT, (int) $limit));

        $sql = "SELECT {$select} FROM {$table} t {$join} WHERE " . implode(' AND ', $where)
            . " ORDER BY {$spec['order']} LIMIT :limit";
        $statement = $this->pdo->prepare($sql);
        foreach ($params as $name => $value) {
            $statement->bindValue($name, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->execute();

        $rows = $statement->fetchAll();
        if ($entity === 'tags') {
            $counts = $this->tagUsageCounts[$userId] ?? [];
            foreach ($rows as $index => $row) {
                $rows[$index]['usage_count'] = $counts[(string) ($row['slug'] ?? '')] ?? 0;
            }
        }
        return array_map(
            static fn (array $row): array => EntityCatalog::castRow($entity, $row),
            $rows,
        );
    }

    public function find(string $entity, int $id, int $userId): ?array
    {
        $spec = EntityCatalog::get($entity);
        [$select, $join] = $this->selectParts($entity);
        $statement = $this->pdo->prepare(
            "SELECT {$select} FROM {$spec['table']} t {$join} WHERE t.id = :id AND t.user_id = :user_id LIMIT 1",
        );
        $statement->execute([':id' => $id, ':user_id' => $userId]);
        $row = $statement->fetch();
        return is_array($row) ? EntityCatalog::castRow($entity, $row) : null;
    }

    public function projectOverview(int $projectId, int $userId): ?array
    {
        $project = $this->find('projects', $projectId, $userId);
        if ($project === null) {
            return null;
        }

        $attachments = $this->pdo->prepare(
            'SELECT * FROM attachments
             WHERE user_id = :user_id AND entity_type = \'projects\' AND entity_id = :project_id
             ORDER BY created_at DESC, id DESC
             LIMIT ' . self::OVERVIEW_ATTACHMENT_LIMIT,
        );
        $attachments->execute([':user_id' => $userId, ':project_id' => $projectId]);

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
            }, $attachments->fetchAll()),
        ];
    }

    public function create(string $entity, int $userId, array $data): array
    {
        if ($entity === 'payments') {
            return $this->createPayment($userId, $data);
        }

        $spec = EntityCatalog::get($entity);
        $data = $this->normalizeProjectRelations($entity, $data);
        if (isset($data['tags']) && is_array($data['tags'])) {
            $this->syncTags($userId, $data['tags']);
        }
        $prepared = $this->prepareForDatabase($entity, $data);
        $columns = array_merge(['user_id'], array_keys($prepared));
        $placeholders = array_map(static fn (string $column): string => ':' . $column, $columns);
        $sql = "INSERT INTO {$spec['table']} (" . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')';
        $statement = $this->pdo->prepare($sql);
        try {
            $statement->execute(array_merge([':user_id' => $userId], $this->prefixKeys($prepared)));
        } catch (PDOException $exception) {
            $this->translateConstraintError($entity, $exception);
            throw $exception;
        }

        $created = $this->find($entity, (int) $this->pdo->lastInsertId(), $userId);
        if ($created === null) {
            throw new ApiException('No se pudo recuperar el registro creado.', 500);
        }
        return $created;
    }

    public function update(string $entity, int $id, int $userId, array $data): ?array
    {
        if ($entity === 'payments') {
            return $this->updatePayment($id, $userId, $data);
        }
        if ($entity === 'budgets') {
            return $this->updateBudget($id, $userId, $data);
        }

        $spec = EntityCatalog::get($entity);
        $current = $this->find($entity, $id, $userId);
        if ($current === null) {
            return null;
        }

        $data = $this->normalizeProjectRelations($entity, $data, $current);
        if ($entity === 'tags' && isset($data['name']) && (string) $data['name'] !== (string) ($current['name'] ?? '')) {
            $this->replaceTagAssignments($userId, TagNormalizer::slug((string) $current['name']), (string) $data['name']);
        }
        if (isset($data['tags']) && is_array($data['tags'])) {
            $this->syncTags($userId, $data['tags']);
        }
        $prepared = $this->prepareForDatabase($entity, $data);
        if ($prepared !== []) {
            $assignments = array_map(static fn (string $column): string => "{$column} = :{$column}", array_keys($prepared));
            $sql = "UPDATE {$spec['table']} SET " . implode(', ', $assignments) . ' WHERE id = :_id AND user_id = :_user_id';
            $statement = $this->pdo->prepare($sql);
            $params = $this->prefixKeys($prepared);
            $params[':_id'] = $id;
            $params[':_user_id'] = $userId;
            try {
                $statement->execute($params);
            } catch (PDOException $exception) {
                $this->translateConstraintError($entity, $exception);
                throw $exception;
            }
        }

        return $this->find($entity, $id, $userId);
    }

    public function delete(string $entity, int $id, int $userId): bool
    {
        if ($entity === 'payments') {
            return $this->deletePayment($id, $userId);
        }
        if ($entity === 'budgets') {
            return $this->deleteBudget($id, $userId);
        }

        $spec = EntityCatalog::get($entity);
        if ($entity === 'tags') {
            $current = $this->find('tags', $id, $userId);
            if ($current === null) {
                return false;
            }
            $this->replaceTagAssignments($userId, (string) $current['slug'], null);
        }
        $statement = $this->pdo->prepare("DELETE FROM {$spec['table']} WHERE id = :id AND user_id = :user_id");
        $statement->execute([':id' => $id, ':user_id' => $userId]);
        return $statement->rowCount() > 0;
    }

    public function foreignExists(string $entity, int $id, int $userId): bool
    {
        $spec = EntityCatalog::get($entity);
        $statement = $this->pdo->prepare("SELECT 1 FROM {$spec['table']} WHERE id = :id AND user_id = :user_id");
        $statement->execute([':id' => $id, ':user_id' => $userId]);
        return $statement->fetchColumn() !== false;
    }

    public function dashboard(int $userId): array
    {
        $settings = $this->getSettings($userId);
        $today = (new \DateTimeImmutable('now', new \DateTimeZone((string) $settings['timezone'])))->format('Y-m-d');
        $counts = $this->pdo->prepare(
            "SELECT
                (SELECT COUNT(*) FROM projects WHERE user_id = :u1) AS projects_total,
                (SELECT COUNT(*) FROM projects WHERE user_id = :u2 AND status = 'active') AS active_projects,
                (SELECT COALESCE(ROUND(AVG(progress)), 0) FROM projects WHERE user_id = :u3 AND status <> 'archived') AS project_progress,
                (SELECT COUNT(*) FROM ideas WHERE user_id = :u4 AND archived = 0) AS ideas,
                (SELECT COUNT(*) FROM clients WHERE user_id = :u5 AND status = 'active') AS active_clients,
                (SELECT COUNT(*) FROM leads WHERE user_id = :u6 AND status NOT IN ('won', 'lost')) AS open_leads,
                (SELECT COALESCE(SUM(value), 0) FROM leads WHERE user_id = :u7 AND status NOT IN ('won', 'lost')) AS pipeline_value,
                (SELECT COUNT(*) FROM tasks WHERE user_id = :u8 AND status <> 'done') AS pending_tasks,
                (SELECT COUNT(*) FROM tasks WHERE user_id = :u9 AND status <> 'done' AND due_date < :today) AS overdue_tasks",
        );
        $counts->execute([
            ':u1' => $userId, ':u2' => $userId, ':u3' => $userId,
            ':u4' => $userId, ':u5' => $userId, ':u6' => $userId,
            ':u7' => $userId, ':u8' => $userId, ':u9' => $userId,
            ':today' => $today,
        ]);
        $stats = $counts->fetch() ?: [];
        foreach (['projects_total', 'active_projects', 'project_progress', 'ideas', 'active_clients', 'open_leads', 'pending_tasks', 'overdue_tasks'] as $field) {
            $stats[$field] = (int) ($stats[$field] ?? 0);
        }
        $stats['pipeline_value'] = (float) ($stats['pipeline_value'] ?? 0);

        $projects = $this->list('projects', $userId, ['limit' => 5]);
        $ideas = $this->list('ideas', $userId, ['archived' => false, 'limit' => 4]);

        $tasksStatement = $this->pdo->prepare(
            "SELECT t.*, p.name AS project_name FROM tasks t
             LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id
             WHERE t.user_id = :user_id AND t.status <> 'done'
             ORDER BY t.due_date IS NULL, t.due_date ASC, FIELD(t.priority, 'urgent', 'high', 'medium', 'low') LIMIT 6",
        );
        $tasksStatement->execute([':user_id' => $userId]);
        $tasks = array_map(
            static fn (array $row): array => EntityCatalog::castRow('tasks', $row),
            $tasksStatement->fetchAll(),
        );

        $followStatement = $this->pdo->prepare(
            "SELECT * FROM leads WHERE user_id = :user_id AND status NOT IN ('won', 'lost')
             ORDER BY next_follow_up IS NULL, next_follow_up ASC, updated_at DESC LIMIT 5",
        );
        $followStatement->execute([':user_id' => $userId]);
        $followUps = array_map(
            static fn (array $row): array => EntityCatalog::castRow('leads', $row),
            $followStatement->fetchAll(),
        );

        $activityStatement = $this->pdo->prepare(
            "(SELECT 'project' AS type, name AS title, status, updated_at AS created_at FROM projects WHERE user_id = :u1)
             UNION ALL
             (SELECT 'idea' AS type, title, status, updated_at AS created_at FROM ideas WHERE user_id = :u2)
             UNION ALL
             (SELECT 'task' AS type, title, status, updated_at AS created_at FROM tasks WHERE user_id = :u3)
             ORDER BY created_at DESC LIMIT 8",
        );
        $activityStatement->execute([':u1' => $userId, ':u2' => $userId, ':u3' => $userId]);

        return [
            'stats' => $stats,
            'projects' => $projects,
            'upcoming_tasks' => $tasks,
            'recent_ideas' => $ideas,
            'follow_ups' => $followUps,
            'activity' => $activityStatement->fetchAll(),
        ];
    }

    public function getSettings(int $userId): array
    {
        $defaults = SettingsCatalog::defaults();
        $statement = $this->pdo->prepare(
            'INSERT INTO user_settings (
                user_id, default_currency, date_format, timezone, theme, week_start,
                default_hourly_cost, dashboard_widgets, reminder_days
             ) VALUES (
                :user_id, :default_currency, :date_format, :timezone, :theme, :week_start,
                :default_hourly_cost, :dashboard_widgets, :reminder_days
             ) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)',
        );
        $statement->execute([
            ':user_id' => $userId,
            ':default_currency' => $defaults['default_currency'],
            ':date_format' => $defaults['date_format'],
            ':timezone' => $defaults['timezone'],
            ':theme' => $defaults['theme'],
            ':week_start' => $defaults['week_start'],
            ':default_hourly_cost' => $defaults['default_hourly_cost'],
            ':dashboard_widgets' => json_encode($defaults['dashboard_widgets'], JSON_UNESCAPED_UNICODE),
            ':reminder_days' => json_encode($defaults['reminder_days'], JSON_UNESCAPED_UNICODE),
        ]);

        $select = $this->pdo->prepare('SELECT * FROM user_settings WHERE user_id = :user_id LIMIT 1');
        $select->execute([':user_id' => $userId]);
        $row = $select->fetch();
        if (!is_array($row)) {
            throw new ApiException('No se pudieron recuperar tus preferencias.', 500);
        }
        return SettingsCatalog::castRow($row);
    }

    public function updateSettings(int $userId, array $data): array
    {
        $this->getSettings($userId);
        foreach (['dashboard_widgets', 'reminder_days'] as $field) {
            if (array_key_exists($field, $data)) {
                $data[$field] = json_encode($data[$field], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            }
        }
        if ($data !== []) {
            $assignments = array_map(
                static fn (string $field): string => "{$field} = :{$field}",
                array_keys($data),
            );
            $statement = $this->pdo->prepare(
                'UPDATE user_settings SET ' . implode(', ', $assignments) . ' WHERE user_id = :_user_id',
            );
            $params = $this->prefixKeys($data);
            $params[':_user_id'] = $userId;
            $statement->execute($params);
        }
        return $this->getSettings($userId);
    }

    public function runningTimeEntry(int $userId, ?int $excludeId = null): ?array
    {
        [$select, $join] = $this->selectParts('time_entries');
        $sql = "SELECT {$select} FROM time_entries t {$join}
                WHERE t.user_id = :user_id
                  AND t.started_at IS NOT NULL AND t.ended_at IS NULL";
        $params = [':user_id' => $userId];
        if ($excludeId !== null) {
            $sql .= ' AND t.id <> :exclude_id';
            $params[':exclude_id'] = $excludeId;
        }
        $sql .= ' ORDER BY t.started_at DESC LIMIT 1';
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);
        $row = $statement->fetch();
        return is_array($row) ? EntityCatalog::castRow('time_entries', $row) : null;
    }

    public function tagSlugExists(string $slug, int $userId, ?int $excludeId = null): bool
    {
        $sql = 'SELECT 1 FROM tags WHERE user_id = :user_id AND slug = :slug';
        $params = [':user_id' => $userId, ':slug' => $slug];
        if ($excludeId !== null) {
            $sql .= ' AND id <> :exclude_id';
            $params[':exclude_id'] = $excludeId;
        }
        $sql .= ' LIMIT 1';
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);
        return $statement->fetchColumn() !== false;
    }

    public function calendar(int $userId, string $from, string $to): array
    {
        $events = [];
        $append = static function (
            array &$target,
            string $type,
            array $row,
            string $date,
            ?string $startsAt = null,
        ): void {
            $sourceId = (int) $row['source_id'];
            $target[] = [
                'key' => $type . ':' . $sourceId,
                'source_type' => $type,
                'source_id' => $sourceId,
                'date' => $date,
                'starts_at' => $startsAt,
                'title' => (string) $row['title'],
                'status' => $row['status'] ?? null,
                'priority' => $row['priority'] ?? null,
                'project_id' => isset($row['project_id']) ? (int) $row['project_id'] : null,
                'project_name' => $row['project_name'] ?? null,
            ];
        };

        $dateSources = [
            'project' => [
                'SELECT p.id AS source_id, p.due_date AS event_date, p.name AS title, p.status, p.priority,
                        p.id AS project_id, p.name AS project_name
                 FROM projects p WHERE p.user_id = :user_id AND p.due_date BETWEEN :from_date AND :to_date',
            ],
            'task' => [
                'SELECT t.id AS source_id, t.due_date AS event_date, t.title, t.status, t.priority,
                        t.project_id, p.name AS project_name
                 FROM tasks t LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id
                 WHERE t.user_id = :user_id AND t.due_date BETWEEN :from_date AND :to_date',
            ],
            'release' => [
                'SELECT r.id AS source_id, r.release_date AS event_date, r.title, r.status, NULL AS priority,
                        r.project_id, p.name AS project_name
                 FROM releases r JOIN projects p ON p.id = r.project_id AND p.user_id = r.user_id
                 WHERE r.user_id = :user_id AND r.release_date BETWEEN :from_date AND :to_date',
            ],
            'resource' => [
                'SELECT r.id AS source_id, r.renewal_date AS event_date, r.name AS title, r.status, NULL AS priority,
                        r.project_id, p.name AS project_name
                 FROM resources r LEFT JOIN projects p ON p.id = r.project_id AND p.user_id = r.user_id
                 WHERE r.user_id = :user_id AND r.renewal_date BETWEEN :from_date AND :to_date',
            ],
            'lead' => [
                'SELECT l.id AS source_id, l.next_follow_up AS event_date, l.name AS title, l.status, NULL AS priority,
                        NULL AS project_id, NULL AS project_name
                 FROM leads l WHERE l.user_id = :user_id AND l.next_follow_up BETWEEN :from_date AND :to_date',
            ],
            'budget' => [
                'SELECT b.id AS source_id, b.valid_until AS event_date, b.title, b.status, NULL AS priority,
                        b.project_id, p.name AS project_name
                 FROM budgets b LEFT JOIN projects p ON p.id = b.project_id AND p.user_id = b.user_id
                 WHERE b.user_id = :user_id AND b.valid_until BETWEEN :from_date AND :to_date',
            ],
            'payment' => [
                "SELECT pay.id AS source_id, pay.paid_at AS event_date,
                        CONCAT('Cobro · ', b.title) AS title, 'paid' AS status, NULL AS priority,
                        b.project_id, p.name AS project_name
                 FROM payments pay
                 JOIN budgets b ON b.id = pay.budget_id AND b.user_id = pay.user_id
                 LEFT JOIN projects p ON p.id = b.project_id AND p.user_id = b.user_id
                 WHERE pay.user_id = :user_id AND pay.paid_at BETWEEN :from_date AND :to_date",
            ],
        ];
        foreach ($dateSources as $type => [$sql]) {
            $statement = $this->pdo->prepare($sql);
            $statement->execute([':user_id' => $userId, ':from_date' => $from, ':to_date' => $to]);
            foreach ($statement->fetchAll() as $row) {
                $append($events, $type, $row, (string) $row['event_date']);
            }
        }

        $settings = $this->getSettings($userId);
        $timezone = new \DateTimeZone((string) $settings['timezone']);
        $utc = new \DateTimeZone('UTC');
        $fromUtc = (new \DateTimeImmutable($from . ' 00:00:00', $timezone))->setTimezone($utc)->format('Y-m-d H:i:s');
        $toUtc = (new \DateTimeImmutable($to . ' 23:59:59', $timezone))->setTimezone($utc)->format('Y-m-d H:i:s');
        $reminders = $this->pdo->prepare(
            'SELECT r.id AS source_id, r.due_at, r.title, r.status, r.priority,
                    r.project_id, p.name AS project_name
             FROM reminders r LEFT JOIN projects p ON p.id = r.project_id AND p.user_id = r.user_id
             WHERE r.user_id = :user_id AND r.due_at BETWEEN :from_utc AND :to_utc',
        );
        $reminders->execute([':user_id' => $userId, ':from_utc' => $fromUtc, ':to_utc' => $toUtc]);
        foreach ($reminders->fetchAll() as $row) {
            $instant = new \DateTimeImmutable((string) $row['due_at'], $utc);
            $local = $instant->setTimezone($timezone);
            $append($events, 'reminder', $row, $local->format('Y-m-d'), $instant->format('Y-m-d\TH:i:s\Z'));
        }

        usort($events, static function (array $left, array $right): int {
            $leftKey = ($left['starts_at'] ?? null) ?: $left['date'] . 'T12:00:00';
            $rightKey = ($right['starts_at'] ?? null) ?: $right['date'] . 'T12:00:00';
            return [$leftKey, $left['key']] <=> [$rightKey, $right['key']];
        });
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
        foreach ($this->list('projects', $userId, ['limit' => 200]) as $project) {
            $id = (int) $project['id'];
            $projects[$id] = $this->emptyProfitabilityProject($id, (string) $project['name']);
        }

        $ensure = function (?int $projectId) use (&$projects): int {
            $key = $projectId ?? 0;
            if (!isset($projects[$key])) {
                $projects[$key] = $this->emptyProfitabilityProject(
                    $projectId,
                    $projectId === null ? 'Sin proyecto' : 'Proyecto eliminado',
                );
            }
            return $key;
        };

        $incomeStatement = $this->pdo->prepare(
            'SELECT b.project_id, b.currency, SUM(pay.amount) AS amount
             FROM payments pay
             JOIN budgets b ON b.id = pay.budget_id AND b.user_id = pay.user_id
             WHERE pay.user_id = :user_id AND pay.paid_at BETWEEN :period_start AND :period_end
             GROUP BY b.project_id, b.currency',
        );
        $incomeStatement->execute([
            ':user_id' => $userId, ':period_start' => $periodStart, ':period_end' => $periodEnd,
        ]);
        foreach ($incomeStatement->fetchAll() as $row) {
            $key = $ensure($row['project_id'] === null ? null : (int) $row['project_id']);
            $projects[$key]['income'][] = [
                'currency' => (string) $row['currency'],
                'amount' => round((float) $row['amount'], 2),
            ];
        }

        $laborStatement = $this->pdo->prepare(
            'SELECT project_id, cost_currency, SUM(duration_minutes) AS minutes,
                    SUM((duration_minutes / 60) * hourly_cost) AS amount
             FROM time_entries
             WHERE user_id = :user_id
               AND work_date BETWEEN :period_start AND :period_end
               AND NOT (started_at IS NOT NULL AND ended_at IS NULL)
             GROUP BY project_id, cost_currency',
        );
        $laborStatement->execute([
            ':user_id' => $userId, ':period_start' => $periodStart, ':period_end' => $periodEnd,
        ]);
        foreach ($laborStatement->fetchAll() as $row) {
            $key = $ensure($row['project_id'] === null ? null : (int) $row['project_id']);
            $projects[$key]['labor_costs'][] = [
                'currency' => (string) $row['cost_currency'],
                'minutes' => (int) $row['minutes'],
                'amount' => round((float) $row['amount'], 2),
            ];
        }

        $resourceStatement = $this->pdo->prepare(
            "SELECT project_id, currency, billing_cycle, SUM(cost) AS amount
             FROM resources
             WHERE user_id = :user_id
               AND (
                    (billing_cycle IN ('monthly', 'yearly') AND status <> 'inactive')
                    OR (billing_cycle = 'one_time' AND DATE(created_at) BETWEEN :period_start AND :period_end)
               )
             GROUP BY project_id, currency, billing_cycle",
        );
        $resourceStatement->execute([
            ':user_id' => $userId, ':period_start' => $periodStart, ':period_end' => $periodEnd,
        ]);
        foreach ($resourceStatement->fetchAll() as $row) {
            $key = $ensure($row['project_id'] === null ? null : (int) $row['project_id']);
            $currency = (string) $row['currency'];
            $index = null;
            foreach ($projects[$key]['resource_costs'] as $candidate => $cost) {
                if ($cost['currency'] === $currency) {
                    $index = $candidate;
                    break;
                }
            }
            if ($index === null) {
                $projects[$key]['resource_costs'][] = [
                    'currency' => $currency,
                    'monthly' => 0.0,
                    'yearly' => 0.0,
                    'monthly_equivalent' => 0.0,
                    'one_time' => 0.0,
                ];
                $index = array_key_last($projects[$key]['resource_costs']);
            }
            $cycle = (string) $row['billing_cycle'];
            $amount = round((float) $row['amount'], 2);
            $projects[$key]['resource_costs'][$index][$cycle] = $amount;
            $projects[$key]['resource_costs'][$index]['monthly_equivalent'] = round(
                (float) $projects[$key]['resource_costs'][$index]['monthly']
                + ((float) $projects[$key]['resource_costs'][$index]['yearly'] / 12),
                2,
            );
        }

        foreach ($projects as &$project) {
            $currencySet = [];
            foreach (['income', 'labor_costs', 'resource_costs'] as $bucket) {
                foreach ($project[$bucket] as $row) {
                    $currencySet[(string) $row['currency']] = true;
                }
            }
            $project['mixed_currencies'] = count($currencySet) > 1;
            $project['net'] = null;
            if (count($currencySet) === 1) {
                $currency = (string) array_key_first($currencySet);
                $income = array_sum(array_column($project['income'], 'amount'));
                $labor = array_sum(array_column($project['labor_costs'], 'amount'));
                $monthlyResources = array_sum(array_column($project['resource_costs'], 'monthly_equivalent'));
                $oneTimeResources = array_sum(array_column($project['resource_costs'], 'one_time'));
                $project['net'] = [
                    'currency' => $currency,
                    'income' => round($income, 2),
                    'labor_cost' => round($labor, 2),
                    'monthly_resource_cost' => round($monthlyResources, 2),
                    'one_time_resource_cost' => round($oneTimeResources, 2),
                    'estimated_monthly_net' => round($income - $labor - $monthlyResources, 2),
                    'estimated_net_after_one_time' => round($income - $labor - $monthlyResources - $oneTimeResources, 2),
                    'estimated' => true,
                ];
            }
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

        $manual = $this->pdo->prepare(
            'SELECT r.*, p.name AS project_name
             FROM reminders r LEFT JOIN projects p ON p.id = r.project_id AND p.user_id = r.user_id
             WHERE r.user_id = :user_id ORDER BY r.due_at ASC, r.id ASC',
        );
        $manual->execute([':user_id' => $userId]);
        foreach ($manual->fetchAll() as $row) {
            $item = EntityCatalog::castRow('reminders', $row);
            $item['derived'] = false;
            $items[] = $item;
        }

        $sources = [
            'task' => [
                "SELECT t.id AS source_id, t.due_date AS due_at, t.title, t.description AS notes,
                        t.status, t.priority, t.project_id, p.name AS project_name
                 FROM tasks t LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id
                 WHERE t.user_id = :user_id AND t.status <> 'done'
                   AND t.due_date IS NOT NULL AND t.due_date <= :cutoff",
            ],
            'lead' => [
                "SELECT l.id AS source_id, l.next_follow_up AS due_at,
                        CONCAT('Seguimiento: ', l.name) AS title, COALESCE(l.company, 'Oportunidad') AS notes,
                        l.status, 'medium' AS priority, NULL AS project_id, NULL AS project_name
                 FROM leads l WHERE l.user_id = :user_id AND l.status NOT IN ('won', 'lost')
                   AND l.next_follow_up IS NOT NULL AND l.next_follow_up <= :cutoff",
            ],
            'budget' => [
                "SELECT b.id AS source_id, b.valid_until AS due_at, CONCAT('Vence: ', b.title) AS title,
                        COALESCE(c.name, 'Presupuesto') AS notes, b.status, 'high' AS priority,
                        b.project_id, p.name AS project_name
                 FROM budgets b
                 LEFT JOIN clients c ON c.id = b.client_id AND c.user_id = b.user_id
                 LEFT JOIN projects p ON p.id = b.project_id AND p.user_id = b.user_id
                 WHERE b.user_id = :user_id AND b.status NOT IN ('rejected', 'expired')
                   AND b.valid_until IS NOT NULL AND b.valid_until <= :cutoff",
            ],
            'release' => [
                "SELECT r.id AS source_id, r.release_date AS due_at, r.title, COALESCE(p.name, 'Entrega') AS notes,
                        r.status, 'high' AS priority, r.project_id, p.name AS project_name
                 FROM releases r JOIN projects p ON p.id = r.project_id AND p.user_id = r.user_id
                 WHERE r.user_id = :user_id AND r.status NOT IN ('published', 'rolled_back')
                   AND r.release_date IS NOT NULL AND r.release_date <= :cutoff",
            ],
            'resource' => [
                "SELECT r.id AS source_id,
                        CASE WHEN r.renewal_date IS NULL THEN :today_date ELSE r.renewal_date END AS due_at,
                        CASE WHEN r.renewal_date IS NULL THEN CONCAT('Revisar: ', r.name) ELSE CONCAT('Renovar: ', r.name) END AS title,
                        COALESCE(r.provider, 'Recurso') AS notes, r.status,
                        CASE WHEN r.status = 'attention' THEN 'high' ELSE 'medium' END AS priority,
                        r.project_id, p.name AS project_name
                 FROM resources r LEFT JOIN projects p ON p.id = r.project_id AND p.user_id = r.user_id
                 WHERE r.user_id = :user_id AND r.status <> 'inactive'
                   AND ((r.renewal_date IS NOT NULL AND r.renewal_date <= :cutoff)
                        OR (r.status = 'attention' AND r.renewal_date IS NULL))",
            ],
        ];
        foreach ($sources as $sourceType => [$sql]) {
            $statement = $this->pdo->prepare($sql);
            $params = [':user_id' => $userId, ':cutoff' => $cutoff];
            if ($sourceType === 'resource') {
                $params[':today_date'] = $todayDate;
            }
            $statement->execute($params);
            foreach ($statement->fetchAll() as $row) {
                $items[] = [
                    'id' => 'derived-' . $sourceType . '-' . (int) $row['source_id'],
                    'source_type' => $sourceType,
                    'source_id' => (int) $row['source_id'],
                    'title' => (string) $row['title'],
                    'notes' => $row['notes'] ?? null,
                    'due_at' => (string) $row['due_at'],
                    'status' => 'pending',
                    'source_status' => $row['status'] ?? null,
                    'priority' => (string) $row['priority'],
                    'derived' => true,
                    'project_id' => $row['project_id'] === null ? null : (int) $row['project_id'],
                    'project_name' => $row['project_name'] ?? null,
                    'tags' => [],
                ];
            }
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

        $tasks = $this->pdo->prepare(
            "SELECT COUNT(*) FROM tasks
             WHERE user_id = :user_id AND status = 'done' AND completed_at >= :from_utc AND completed_at < :after_utc",
        );
        $tasks->execute([':user_id' => $userId, ':from_utc' => $fromUtc, ':after_utc' => $afterUtc]);
        $tasksCompleted = (int) $tasks->fetchColumn();

        $time = $this->pdo->prepare(
            'SELECT COUNT(*) AS entries, COALESCE(SUM(duration_minutes), 0) AS minutes,
                    COALESCE(SUM(CASE WHEN billable = 1 THEN duration_minutes ELSE 0 END), 0) AS billable_minutes
             FROM time_entries
             WHERE user_id = :user_id AND work_date BETWEEN :from_date AND :to_date
               AND NOT (started_at IS NOT NULL AND ended_at IS NULL)',
        );
        $time->execute([':user_id' => $userId, ':from_date' => $from, ':to_date' => $to]);
        $timeRow = $time->fetch() ?: [];

        $devlogs = $this->pdo->prepare(
            'SELECT COUNT(*) FROM dev_logs WHERE user_id = :user_id AND entry_date BETWEEN :from_date AND :to_date',
        );
        $devlogs->execute([':user_id' => $userId, ':from_date' => $from, ':to_date' => $to]);
        $releases = $this->pdo->prepare(
            'SELECT COUNT(*) FROM releases WHERE user_id = :user_id AND release_date BETWEEN :from_date AND :to_date',
        );
        $releases->execute([':user_id' => $userId, ':from_date' => $from, ':to_date' => $to]);

        $payments = $this->pdo->prepare(
            'SELECT b.currency, COUNT(*) AS count, SUM(pay.amount) AS amount
             FROM payments pay JOIN budgets b ON b.id = pay.budget_id AND b.user_id = pay.user_id
             WHERE pay.user_id = :user_id AND pay.paid_at BETWEEN :from_date AND :to_date
             GROUP BY b.currency ORDER BY b.currency ASC',
        );
        $payments->execute([':user_id' => $userId, ':from_date' => $from, ':to_date' => $to]);
        $paymentRows = array_map(static fn (array $row): array => [
            'currency' => (string) $row['currency'],
            'amount' => round((float) $row['amount'], 2),
            'count' => (int) $row['count'],
        ], $payments->fetchAll());

        return [
            'period' => ['from' => $from, 'to' => $to, 'timezone' => (string) $settings['timezone']],
            'tasks_completed' => $tasksCompleted,
            'time' => [
                'minutes' => (int) ($timeRow['minutes'] ?? 0),
                'billable_minutes' => (int) ($timeRow['billable_minutes'] ?? 0),
                'entries' => (int) ($timeRow['entries'] ?? 0),
            ],
            'devlogs_count' => (int) $devlogs->fetchColumn(),
            'releases_count' => (int) $releases->fetchColumn(),
            'payments' => $paymentRows,
        ];
    }

    public function listAttachments(int $userId, ?string $entityType = null, ?int $entityId = null): array
    {
        $where = ['user_id = :user_id'];
        $params = [':user_id' => $userId];
        if ($entityType !== null) {
            $where[] = 'entity_type = :entity_type';
            $params[':entity_type'] = $entityType;
        }
        if ($entityId !== null) {
            $where[] = 'entity_id = :entity_id';
            $params[':entity_id'] = $entityId;
        }
        $statement = $this->pdo->prepare(
            'SELECT * FROM attachments WHERE ' . implode(' AND ', $where) . ' ORDER BY created_at DESC, id DESC LIMIT ' . self::LIST_LIMIT,
        );
        $statement->execute($params);
        return array_map([$this, 'castAttachment'], $statement->fetchAll());
    }

    public function findAttachment(int $id, int $userId): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT * FROM attachments WHERE id = :id AND user_id = :user_id LIMIT 1',
        );
        $statement->execute([':id' => $id, ':user_id' => $userId]);
        $row = $statement->fetch();
        return is_array($row) ? $this->castAttachment($row) : null;
    }

    public function createAttachment(int $userId, array $data, int $quotaBytes): array
    {
        $this->pdo->beginTransaction();
        try {
            $lock = $this->pdo->prepare('SELECT id FROM users WHERE id = :user_id FOR UPDATE');
            $lock->execute([':user_id' => $userId]);
            if ($lock->fetchColumn() === false) {
                throw new ApiException('La cuenta ya no existe.', 404);
            }
            $entityType = (string) ($data['entity_type'] ?? '');
            $entityId = (int) ($data['entity_id'] ?? 0);
            if ($entityType !== 'general') {
                $targetSpec = EntityCatalog::get($entityType);
                $target = $this->pdo->prepare(
                    "SELECT id FROM {$targetSpec['table']}
                     WHERE id = :entity_id AND user_id = :user_id LIMIT 1 LOCK IN SHARE MODE",
                );
                $target->execute([':entity_id' => $entityId, ':user_id' => $userId]);
                if ($target->fetchColumn() === false) {
                    throw new ApiException('No encontramos ese registro.', 404);
                }
            }
            $usage = $this->pdo->prepare(
                'SELECT COALESCE(SUM(size_bytes), 0) FROM attachments WHERE user_id = :user_id',
            );
            $usage->execute([':user_id' => $userId]);
            if ((int) $usage->fetchColumn() + (int) $data['size_bytes'] > $quotaBytes) {
                throw new ApiException('Alcanzaste el límite de almacenamiento de archivos.', 413, [
                    'file' => 'Elimina algún archivo antes de volver a intentarlo.',
                ]);
            }

            $columns = array_merge(['user_id'], array_keys($data));
            $placeholders = array_map(static fn (string $column): string => ':' . $column, $columns);
            $statement = $this->pdo->prepare(
                'INSERT INTO attachments (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')',
            );
            $statement->execute(array_merge([':user_id' => $userId], $this->prefixKeys($data)));
            $id = (int) $this->pdo->lastInsertId();
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
        $created = $this->findAttachment($id, $userId);
        if ($created === null) {
            throw new ApiException('No se pudo recuperar el archivo guardado.', 500);
        }
        return $created;
    }

    public function deleteAttachment(int $id, int $userId): ?array
    {
        $current = $this->findAttachment($id, $userId);
        if ($current === null) {
            return null;
        }
        $statement = $this->pdo->prepare('DELETE FROM attachments WHERE id = :id AND user_id = :user_id');
        $statement->execute([':id' => $id, ':user_id' => $userId]);
        return $statement->rowCount() > 0 ? $current : null;
    }

    public function deleteAttachmentsForEntity(string $entityType, int $entityId, int $userId): array
    {
        $this->pdo->beginTransaction();
        try {
            $lock = $this->pdo->prepare('SELECT id FROM users WHERE id = :user_id FOR UPDATE');
            $lock->execute([':user_id' => $userId]);
            $select = $this->pdo->prepare(
                'SELECT * FROM attachments
                 WHERE user_id = :user_id AND entity_type = :entity_type AND entity_id = :entity_id
                 ORDER BY id ASC',
            );
            $select->execute([':user_id' => $userId, ':entity_type' => $entityType, ':entity_id' => $entityId]);
            $rows = array_map([$this, 'castAttachment'], $select->fetchAll());
            if ($rows !== []) {
                $statement = $this->pdo->prepare(
                    'DELETE FROM attachments WHERE user_id = :user_id AND entity_type = :entity_type AND entity_id = :entity_id',
                );
                $statement->execute([':user_id' => $userId, ':entity_type' => $entityType, ':entity_id' => $entityId]);
            }
            $this->pdo->commit();
            return $rows;
        } catch (\Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function dependentAttachmentTargets(string $entityType, int $entityId, int $userId): array
    {
        $targets = [];
        if ($entityType === 'projects') {
            $statement = $this->pdo->prepare('SELECT id FROM releases WHERE project_id = :id AND user_id = :user_id');
            $childType = 'releases';
        } elseif ($entityType === 'budgets') {
            $statement = $this->pdo->prepare('SELECT id FROM payments WHERE budget_id = :id AND user_id = :user_id');
            $childType = 'payments';
        } else {
            return [];
        }
        $statement->execute([':id' => $entityId, ':user_id' => $userId]);
        foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $childId) {
            $targets[] = ['entity_type' => $childType, 'entity_id' => (int) $childId];
        }
        return $targets;
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    private function createPayment(int $userId, array $data): array
    {
        $prepared = $this->prepareForDatabase('payments', $data);
        $this->pdo->beginTransaction();
        try {
            $this->lockFinancialUser($userId);
            $budgetId = (int) ($prepared['budget_id'] ?? 0);
            $budgets = $this->lockBudgets([$budgetId], $userId);
            $this->assertPaymentFitsBudget(
                $budgetId,
                (float) ($prepared['amount'] ?? 0),
                $userId,
                $budgets,
            );

            $columns = array_merge(['user_id'], array_keys($prepared));
            $placeholders = array_map(static fn (string $column): string => ':' . $column, $columns);
            $statement = $this->pdo->prepare(
                'INSERT INTO payments (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')',
            );
            $statement->execute(array_merge([':user_id' => $userId], $this->prefixKeys($prepared)));
            $created = $this->find('payments', (int) $this->pdo->lastInsertId(), $userId);
            if ($created === null) {
                throw new ApiException('No se pudo recuperar el registro creado.', 500);
            }
            $this->pdo->commit();
            return $created;
        } catch (\Throwable $exception) {
            $this->rollbackFinancialMutation($exception, 'payments');
        }
    }

    /** @param array<string, mixed> $data @return array<string, mixed>|null */
    private function updatePayment(int $id, int $userId, array $data): ?array
    {
        $this->pdo->beginTransaction();
        try {
            $this->lockFinancialUser($userId);
            $current = $this->lockPayment($id, $userId);
            if ($current === null) {
                $this->pdo->commit();
                return null;
            }

            $budgetId = (int) ($data['budget_id'] ?? $current['budget_id']);
            $amount = (float) ($data['amount'] ?? $current['amount']);
            $budgets = $this->lockBudgets([(int) $current['budget_id'], $budgetId], $userId);
            $this->assertPaymentFitsBudget(
                $budgetId,
                $amount,
                $userId,
                $budgets,
                (int) $current['id'],
            );

            $prepared = $this->prepareForDatabase('payments', $data);
            if ($prepared !== []) {
                $assignments = array_map(
                    static fn (string $column): string => "{$column} = :{$column}",
                    array_keys($prepared),
                );
                $statement = $this->pdo->prepare(
                    'UPDATE payments SET ' . implode(', ', $assignments)
                        . ' WHERE id = :_id AND user_id = :_user_id',
                );
                $params = $this->prefixKeys($prepared);
                $params[':_id'] = $id;
                $params[':_user_id'] = $userId;
                $statement->execute($params);
            }

            $updated = $this->find('payments', $id, $userId);
            if ($updated === null) {
                throw new ApiException('No se pudo recuperar el pago actualizado.', 500);
            }
            $this->pdo->commit();
            return $updated;
        } catch (\Throwable $exception) {
            $this->rollbackFinancialMutation($exception, 'payments');
        }
    }

    private function deletePayment(int $id, int $userId): bool
    {
        $this->pdo->beginTransaction();
        try {
            $this->lockFinancialUser($userId);
            $current = $this->lockPayment($id, $userId);
            if ($current === null) {
                $this->pdo->commit();
                return false;
            }
            $this->lockBudgets([(int) $current['budget_id']], $userId);

            $statement = $this->pdo->prepare('DELETE FROM payments WHERE id = :id AND user_id = :user_id');
            $statement->execute([':id' => $id, ':user_id' => $userId]);
            if ($statement->rowCount() !== 1) {
                throw new ApiException('No se pudo eliminar el pago.', 409);
            }
            $this->pdo->commit();
            return true;
        } catch (\Throwable $exception) {
            $this->rollbackFinancialMutation($exception, 'payments');
        }
    }

    /** @param array<string, mixed> $data @return array<string, mixed>|null */
    private function updateBudget(int $id, int $userId, array $data): ?array
    {
        $this->pdo->beginTransaction();
        try {
            $this->lockFinancialUser($userId);
            $budgets = $this->lockBudgets([$id], $userId, false);
            if (!isset($budgets[$id])) {
                $this->pdo->commit();
                return null;
            }
            $current = $budgets[$id];
            $paidAmount = $this->paymentTotalForBudget($id, $userId);
            $nextAmount = (float) ($data['amount'] ?? $current['amount']);
            $nextCurrency = (string) ($data['currency'] ?? $current['currency']);
            if ($nextAmount + 0.00001 < $paidAmount) {
                throw new ApiException('El monto no puede ser menor que el total ya pagado.', 422, [
                    'amount' => 'El monto no puede ser menor que el total ya pagado.',
                ]);
            }
            if ($paidAmount > 0.00001 && $nextCurrency !== (string) $current['currency']) {
                throw new ApiException('No puedes cambiar la moneda de un presupuesto que ya tiene pagos.', 422, [
                    'currency' => 'No puedes cambiar la moneda de un presupuesto que ya tiene pagos.',
                ]);
            }

            if (isset($data['tags']) && is_array($data['tags'])) {
                $this->syncTags($userId, $data['tags']);
            }
            $prepared = $this->prepareForDatabase('budgets', $data);
            if ($prepared !== []) {
                $assignments = array_map(
                    static fn (string $column): string => "{$column} = :{$column}",
                    array_keys($prepared),
                );
                $statement = $this->pdo->prepare(
                    'UPDATE budgets SET ' . implode(', ', $assignments)
                        . ' WHERE id = :_id AND user_id = :_user_id',
                );
                $params = $this->prefixKeys($prepared);
                $params[':_id'] = $id;
                $params[':_user_id'] = $userId;
                $statement->execute($params);
            }

            $updated = $this->find('budgets', $id, $userId);
            if ($updated === null) {
                throw new ApiException('No se pudo recuperar el presupuesto actualizado.', 500);
            }
            $this->pdo->commit();
            return $updated;
        } catch (\Throwable $exception) {
            $this->rollbackFinancialMutation($exception, 'budgets');
        }
    }

    private function deleteBudget(int $id, int $userId): bool
    {
        $this->pdo->beginTransaction();
        try {
            $this->lockFinancialUser($userId);
            $budgets = $this->lockBudgets([$id], $userId, false);
            if (!isset($budgets[$id])) {
                $this->pdo->commit();
                return false;
            }
            $payments = $this->pdo->prepare(
                'SELECT id FROM payments WHERE budget_id = :budget_id AND user_id = :user_id FOR UPDATE',
            );
            $payments->execute([':budget_id' => $id, ':user_id' => $userId]);
            $payments->fetchAll();

            $statement = $this->pdo->prepare('DELETE FROM budgets WHERE id = :id AND user_id = :user_id');
            $statement->execute([':id' => $id, ':user_id' => $userId]);
            if ($statement->rowCount() !== 1) {
                throw new ApiException('No se pudo eliminar el presupuesto.', 409);
            }
            $this->pdo->commit();
            return true;
        } catch (\Throwable $exception) {
            $this->rollbackFinancialMutation($exception, 'budgets');
        }
    }

    private function lockFinancialUser(int $userId): void
    {
        $statement = $this->pdo->prepare('SELECT id FROM users WHERE id = :user_id FOR UPDATE');
        $statement->execute([':user_id' => $userId]);
        if ($statement->fetchColumn() === false) {
            throw new ApiException('La cuenta ya no existe.', 404);
        }
    }

    /** @return array<string, mixed>|null */
    private function lockPayment(int $id, int $userId): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT * FROM payments WHERE id = :id AND user_id = :user_id LIMIT 1 FOR UPDATE',
        );
        $statement->execute([':id' => $id, ':user_id' => $userId]);
        $row = $statement->fetch();
        return is_array($row) ? $row : null;
    }

    /**
     * @param array<int, int> $ids
     * @return array<int, array<string, mixed>>
     */
    private function lockBudgets(array $ids, int $userId, bool $requireAll = true): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn (int $id): bool => $id > 0)));
        sort($ids, SORT_NUMERIC);
        if ($ids === []) {
            throw new ApiException('El presupuesto indicado no está disponible.', 422, [
                'budget_id' => 'Selecciona un presupuesto válido.',
            ]);
        }

        $placeholders = [];
        $params = [':user_id' => $userId];
        foreach ($ids as $index => $id) {
            $placeholder = ':budget_' . $index;
            $placeholders[] = $placeholder;
            $params[$placeholder] = $id;
        }
        $statement = $this->pdo->prepare(
            'SELECT * FROM budgets WHERE user_id = :user_id AND id IN (' . implode(', ', $placeholders)
                . ') ORDER BY id ASC FOR UPDATE',
        );
        $statement->execute($params);
        $budgets = [];
        foreach ($statement->fetchAll() as $row) {
            $budgets[(int) $row['id']] = $row;
        }
        if ($requireAll && count($budgets) !== count($ids)) {
            throw new ApiException('El presupuesto indicado no está disponible.', 422, [
                'budget_id' => 'El presupuesto no existe o no te pertenece.',
            ]);
        }
        return $budgets;
    }

    /** @param array<int, array<string, mixed>> $budgets */
    private function assertPaymentFitsBudget(
        int $budgetId,
        float $amount,
        int $userId,
        array $budgets,
        ?int $excludePaymentId = null,
    ): void {
        if (!isset($budgets[$budgetId])) {
            throw new ApiException('El presupuesto indicado no está disponible.', 422, [
                'budget_id' => 'El presupuesto no existe o no te pertenece.',
            ]);
        }
        $paidAmount = $this->paymentTotalForBudget($budgetId, $userId, $excludePaymentId);
        if ($paidAmount + $amount > (float) $budgets[$budgetId]['amount'] + 0.00001) {
            throw new ApiException('El pago supera el saldo disponible del presupuesto.', 422, [
                'amount' => 'El pago supera el saldo disponible del presupuesto.',
            ]);
        }
    }

    private function paymentTotalForBudget(int $budgetId, int $userId, ?int $excludePaymentId = null): float
    {
        $sql = 'SELECT COALESCE(SUM(amount), 0) FROM payments WHERE budget_id = :budget_id AND user_id = :user_id';
        $params = [':budget_id' => $budgetId, ':user_id' => $userId];
        if ($excludePaymentId !== null) {
            $sql .= ' AND id <> :exclude_id';
            $params[':exclude_id'] = $excludePaymentId;
        }
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);
        return round((float) $statement->fetchColumn(), 2);
    }

    private function rollbackFinancialMutation(\Throwable $exception, string $entity): never
    {
        if ($this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
        if ($exception instanceof PDOException) {
            $this->translateConstraintError($entity, $exception);
        }
        throw $exception;
    }

    /** @return array<int, array<string, mixed>> */
    private function projectOverviewRows(
        string $entity,
        int $projectId,
        int $userId,
        int $limit,
    ): array {
        $spec = EntityCatalog::get($entity);
        [$select, $join] = $this->selectParts($entity);
        $statement = $this->pdo->prepare(
            "SELECT {$select} FROM {$spec['table']} t {$join}
             WHERE t.user_id = :user_id AND t.project_id = :project_id
             ORDER BY {$spec['order']} LIMIT {$limit}",
        );
        $statement->execute([':user_id' => $userId, ':project_id' => $projectId]);
        return array_map(
            static fn (array $row): array => EntityCatalog::castRow($entity, $row),
            $statement->fetchAll(),
        );
    }

    /** @return array{0: string, 1: string} */
    private function selectParts(string $entity): array
    {
        return match ($entity) {
            'projects' => ['t.*, c.name AS client_name', 'LEFT JOIN clients c ON c.id = t.client_id AND c.user_id = t.user_id'],
            'tasks' => ['t.*, p.name AS project_name', 'LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id'],
            'devlogs' => ['t.*, p.name AS project_name', 'LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id'],
            'budgets' => [
                't.*, c.name AS client_name, p.name AS project_name, '
                    . 'COALESCE(pay.paid_amount, 0) AS paid_amount, '
                    . '(t.amount - COALESCE(pay.paid_amount, 0)) AS balance',
                'LEFT JOIN clients c ON c.id = t.client_id AND c.user_id = t.user_id '
                    . 'LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id '
                    . 'LEFT JOIN ('
                    . 'SELECT budget_id, user_id, SUM(amount) AS paid_amount '
                    . 'FROM payments GROUP BY budget_id, user_id'
                    . ') pay ON pay.budget_id = t.id AND pay.user_id = t.user_id',
            ],
            'payments' => ['t.*, b.title AS budget_title', 'LEFT JOIN budgets b ON b.id = t.budget_id AND b.user_id = t.user_id'],
            'releases' => ['t.*, p.name AS project_name', 'LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id'],
            'resources' => ['t.*, p.name AS project_name', 'LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id'],
            'reminders' => ['t.*, p.name AS project_name', 'LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id'],
            'time_entries' => [
                't.*, p.name AS project_name, task.title AS task_title, '
                    . '(t.started_at IS NOT NULL AND t.ended_at IS NULL) AS is_running',
                'LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id '
                    . 'LEFT JOIN tasks task ON task.id = t.task_id AND task.user_id = t.user_id',
            ],
            default => ['t.*', ''],
        };
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    private function prepareForDatabase(string $entity, array $data): array
    {
        $spec = EntityCatalog::get($entity);
        foreach ($spec['json'] as $field) {
            if (array_key_exists($field, $data)) {
                try {
                    $data[$field] = json_encode($data[$field], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
                } catch (JsonException) {
                    throw new ApiException('No se pudo serializar una lista.', 422, [$field => 'Contenido no válido.']);
                }
            }
        }
        foreach ($spec['bools'] ?? [] as $field) {
            if (array_key_exists($field, $data)) {
                $data[$field] = $data[$field] ? 1 : 0;
            }
        }
        return $data;
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

    /** @param array<int, mixed> $tags */
    private function syncTags(int $userId, array $tags): void
    {
        $statement = $this->pdo->prepare(
            "INSERT INTO tags (user_id, name, slug, color)
             VALUES (:user_id, :name, :slug, '#7867E6')
             ON DUPLICATE KEY UPDATE name = VALUES(name)",
        );
        foreach (TagNormalizer::names($tags) as $name) {
            $slug = TagNormalizer::slug($name);
            if ($slug === '') {
                continue;
            }
            $statement->execute([':user_id' => $userId, ':name' => $name, ':slug' => $slug]);
        }
    }

    private function syncExistingTags(int $userId): void
    {
        if (isset($this->tagsSynchronized[$userId])) {
            return;
        }
        $this->tagsSynchronized[$userId] = true;
        $allTags = [];
        $usageCounts = [];
        foreach (['projects', 'tasks', 'clients', 'leads', 'ideas', 'dev_logs', 'budgets', 'releases', 'resources', 'reminders', 'time_entries', 'weekly_reviews'] as $table) {
            $statement = $this->pdo->prepare("SELECT tags FROM {$table} WHERE user_id = :user_id");
            $statement->execute([':user_id' => $userId]);
            foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $encoded) {
                if (!is_string($encoded)) {
                    continue;
                }
                $decoded = json_decode($encoded, true);
                if (is_array($decoded)) {
                    $allTags = array_merge($allTags, $decoded);
                    $seen = [];
                    foreach (TagNormalizer::names($decoded) as $name) {
                        $slug = TagNormalizer::slug($name);
                        if ($slug !== '' && !isset($seen[$slug])) {
                            $usageCounts[$slug] = ($usageCounts[$slug] ?? 0) + 1;
                            $seen[$slug] = true;
                        }
                    }
                }
            }
        }
        $this->tagUsageCounts[$userId] = $usageCounts;
        $this->syncTags($userId, TagNormalizer::names($allTags));
    }

    private function replaceTagAssignments(int $userId, string $oldSlug, ?string $newName): void
    {
        if ($oldSlug === '') {
            return;
        }
        foreach (['projects', 'tasks', 'clients', 'leads', 'ideas', 'dev_logs', 'budgets', 'releases', 'resources', 'reminders', 'time_entries', 'weekly_reviews'] as $table) {
            $select = $this->pdo->prepare("SELECT id, tags FROM {$table} WHERE user_id = :user_id");
            $select->execute([':user_id' => $userId]);
            $update = $this->pdo->prepare("UPDATE {$table} SET tags = :tags WHERE id = :id AND user_id = :user_id");
            foreach ($select->fetchAll() as $row) {
                $decoded = is_string($row['tags'] ?? null) ? json_decode($row['tags'], true) : null;
                if (!is_array($decoded)) {
                    continue;
                }
                $changed = false;
                $next = [];
                foreach ($decoded as $name) {
                    if (TagNormalizer::slug((string) $name) === $oldSlug) {
                        $changed = true;
                        if ($newName !== null) {
                            $next[] = $newName;
                        }
                    } else {
                        $next[] = $name;
                    }
                }
                if (!$changed) {
                    continue;
                }
                $update->execute([
                    ':tags' => json_encode(TagNormalizer::names($next), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    ':id' => (int) $row['id'],
                    ':user_id' => $userId,
                ]);
            }
        }
        unset($this->tagsSynchronized[$userId], $this->tagUsageCounts[$userId]);
    }

    private function translateConstraintError(string $entity, PDOException $exception): void
    {
        if ((string) $exception->getCode() !== '23000') {
            return;
        }
        $details = (string) ($exception->errorInfo[2] ?? $exception->getMessage());
        if ($entity === 'time_entries' && str_contains($details, 'uq_time_entries_one_running')) {
            throw new ApiException('Ya tienes un temporizador en curso.', 409, [
                'timer' => 'Detén el temporizador actual antes de iniciar otro.',
            ]);
        }
        if ($entity === 'weekly_reviews' && str_contains($details, 'uq_weekly_reviews_user_week')) {
            throw new ApiException('Ya existe una revisión para esa semana.', 409, [
                'week_start' => 'Edita la revisión existente.',
            ]);
        }
        if ($entity === 'tags' && str_contains($details, 'uq_tags_user_slug')) {
            throw new ApiException('Ya existe una etiqueta con ese nombre.', 409, [
                'name' => 'Usa un nombre diferente.',
            ]);
        }
    }

    /** @return array<string, mixed> */
    private function emptyProfitabilityProject(?int $projectId, string $projectName): array
    {
        return [
            'project_id' => $projectId,
            'project_name' => $projectName,
            'income' => [],
            'labor_costs' => [],
            'resource_costs' => [],
            'mixed_currencies' => false,
            'net' => null,
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

    /** @param array<string, mixed> $data @return array<string, mixed> */
    private function prefixKeys(array $data): array
    {
        $result = [];
        foreach ($data as $key => $value) {
            $result[':' . $key] = $value;
        }
        return $result;
    }
}
