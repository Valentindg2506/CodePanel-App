<?php

declare(strict_types=1);

namespace CodePanel;

use DateTimeImmutable;

final class EntityCatalog
{
    /**
     * @return array<string, array<string, mixed>>
     */
    public static function all(): array
    {
        return [
            'projects' => [
                'table' => 'projects',
                'singular' => 'proyecto',
                'order' => 't.pinned DESC, t.updated_at DESC',
                'search' => ['name', 'description'],
                'json' => ['tech_stack', 'tags'],
                'ints' => ['id', 'client_id', 'progress'],
                'bools' => ['pinned'],
                'fields' => [
                    'name' => ['type' => 'string', 'required' => true, 'max' => 140],
                    'description' => ['type' => 'string', 'nullable' => true, 'max' => 5000],
                    'project_type' => ['type' => 'enum', 'values' => ['personal', 'commercial'], 'default' => 'personal'],
                    'status' => ['type' => 'enum', 'values' => ['planned', 'active', 'on_hold', 'completed', 'archived'], 'default' => 'planned'],
                    'priority' => ['type' => 'enum', 'values' => ['low', 'medium', 'high', 'urgent'], 'default' => 'medium'],
                    'progress' => ['type' => 'int', 'min' => 0, 'max_value' => 100, 'default' => 0],
                    'due_date' => ['type' => 'date', 'nullable' => true],
                    'client_id' => ['type' => 'int', 'min' => 1, 'nullable' => true, 'foreign' => 'clients'],
                    'tech_stack' => ['type' => 'array', 'default' => []],
                    'tags' => ['type' => 'array', 'default' => []],
                    'repository_url' => ['type' => 'url', 'nullable' => true, 'max' => 500],
                    'live_url' => ['type' => 'url', 'nullable' => true, 'max' => 500],
                    'color' => ['type' => 'color', 'default' => '#7867E6'],
                    'pinned' => ['type' => 'bool', 'default' => false],
                ],
            ],
            'ideas' => [
                'table' => 'ideas',
                'singular' => 'idea',
                'order' => 'updated_at DESC',
                'search' => ['title', 'description', 'category'],
                'json' => ['tags'],
                'ints' => ['id', 'effort', 'impact'],
                'bools' => ['archived'],
                'fields' => [
                    'title' => ['type' => 'string', 'required' => true, 'max' => 180],
                    'description' => ['type' => 'string', 'nullable' => true, 'max' => 5000],
                    'status' => ['type' => 'enum', 'values' => ['inbox', 'exploring', 'validated', 'building', 'parked'], 'default' => 'inbox'],
                    'category' => ['type' => 'string', 'nullable' => true, 'max' => 80],
                    'effort' => ['type' => 'int', 'min' => 1, 'max_value' => 5, 'default' => 3],
                    'impact' => ['type' => 'int', 'min' => 1, 'max_value' => 5, 'default' => 3],
                    'tags' => ['type' => 'array', 'default' => []],
                    'archived' => ['type' => 'bool', 'default' => false],
                ],
            ],
            'clients' => [
                'table' => 'clients',
                'singular' => 'cliente',
                'order' => 'updated_at DESC',
                'search' => ['name', 'company', 'email'],
                'json' => ['tags'],
                'ints' => ['id'],
                'fields' => [
                    'name' => ['type' => 'string', 'required' => true, 'max' => 140],
                    'company' => ['type' => 'string', 'nullable' => true, 'max' => 140],
                    'email' => ['type' => 'email', 'nullable' => true, 'max' => 190],
                    'phone' => ['type' => 'string', 'nullable' => true, 'max' => 50],
                    'website' => ['type' => 'url', 'nullable' => true, 'max' => 500],
                    'status' => ['type' => 'enum', 'values' => ['lead', 'active', 'inactive'], 'default' => 'active'],
                    'source' => ['type' => 'string', 'nullable' => true, 'max' => 100],
                    'notes' => ['type' => 'string', 'nullable' => true, 'max' => 5000],
                    'last_contact' => ['type' => 'date', 'nullable' => true],
                    'tags' => ['type' => 'array', 'default' => []],
                ],
            ],
            'leads' => [
                'table' => 'leads',
                'singular' => 'contacto',
                'order' => 'updated_at DESC',
                'search' => ['name', 'company', 'email'],
                'json' => ['tags'],
                'ints' => ['id'],
                'floats' => ['value'],
                'fields' => [
                    'name' => ['type' => 'string', 'required' => true, 'max' => 140],
                    'company' => ['type' => 'string', 'nullable' => true, 'max' => 140],
                    'email' => ['type' => 'email', 'nullable' => true, 'max' => 190],
                    'phone' => ['type' => 'string', 'nullable' => true, 'max' => 50],
                    'status' => ['type' => 'enum', 'values' => ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'], 'default' => 'new'],
                    'value' => ['type' => 'float', 'min' => 0, 'max_value' => 999999999.99, 'default' => 0],
                    'source' => ['type' => 'string', 'nullable' => true, 'max' => 100],
                    'next_follow_up' => ['type' => 'date', 'nullable' => true],
                    'notes' => ['type' => 'string', 'nullable' => true, 'max' => 5000],
                    'tags' => ['type' => 'array', 'default' => []],
                ],
            ],
            'tasks' => [
                'table' => 'tasks',
                'singular' => 'tarea',
                'order' => "FIELD(t.status, 'in_progress', 'todo', 'done'), t.due_date IS NULL, t.due_date ASC, t.updated_at DESC",
                'search' => ['title', 'description', 'assignee'],
                'json' => ['tags'],
                'ints' => ['id', 'project_id'],
                'fields' => [
                    'title' => ['type' => 'string', 'required' => true, 'max' => 180],
                    'description' => ['type' => 'string', 'nullable' => true, 'max' => 5000],
                    'status' => ['type' => 'enum', 'values' => ['todo', 'in_progress', 'done'], 'default' => 'todo'],
                    'priority' => ['type' => 'enum', 'values' => ['low', 'medium', 'high', 'urgent'], 'default' => 'medium'],
                    'project_id' => ['type' => 'int', 'min' => 1, 'nullable' => true, 'foreign' => 'projects'],
                    'assignee' => ['type' => 'string', 'nullable' => true, 'max' => 140],
                    'due_date' => ['type' => 'date', 'nullable' => true],
                    'completed_at' => ['type' => 'datetime', 'nullable' => true],
                    'tags' => ['type' => 'array', 'default' => []],
                ],
            ],
            'devlogs' => [
                'table' => 'dev_logs',
                'singular' => 'entrada',
                'order' => 't.entry_date DESC, t.updated_at DESC',
                'search' => ['title', 'content'],
                'json' => ['tags'],
                'ints' => ['id', 'project_id', 'minutes_spent'],
                'fields' => [
                    'project_id' => ['type' => 'int', 'min' => 1, 'nullable' => true, 'foreign' => 'projects'],
                    'entry_date' => ['type' => 'date', 'required' => true],
                    'title' => ['type' => 'string', 'required' => true, 'max' => 180],
                    'content' => ['type' => 'string', 'nullable' => true, 'max' => 10000],
                    'entry_type' => ['type' => 'enum', 'values' => ['progress', 'decision', 'blocker', 'learning', 'note'], 'default' => 'progress'],
                    'minutes_spent' => ['type' => 'int', 'min' => 0, 'max_value' => 1440, 'default' => 0],
                    'tags' => ['type' => 'array', 'default' => []],
                ],
            ],
            'budgets' => [
                'table' => 'budgets',
                'singular' => 'presupuesto',
                'order' => 't.updated_at DESC',
                'search' => ['title', 'notes'],
                'json' => ['tags'],
                'ints' => ['id', 'client_id', 'project_id'],
                'floats' => ['amount', 'paid_amount', 'balance'],
                'fields' => [
                    'client_id' => ['type' => 'int', 'min' => 1, 'nullable' => true, 'foreign' => 'clients'],
                    'project_id' => ['type' => 'int', 'min' => 1, 'nullable' => true, 'foreign' => 'projects'],
                    'title' => ['type' => 'string', 'required' => true, 'max' => 180],
                    'status' => ['type' => 'enum', 'values' => ['draft', 'sent', 'approved', 'rejected', 'expired'], 'default' => 'draft'],
                    'currency' => ['type' => 'enum', 'values' => ['ARS', 'USD', 'EUR'], 'default' => 'ARS'],
                    'amount' => ['type' => 'float', 'min' => 0, 'max_value' => 999999999.99, 'default' => 0],
                    'valid_until' => ['type' => 'date', 'nullable' => true],
                    'notes' => ['type' => 'string', 'nullable' => true, 'max' => 5000],
                    'tags' => ['type' => 'array', 'default' => []],
                ],
            ],
            'payments' => [
                'table' => 'payments',
                'singular' => 'pago',
                'order' => 't.paid_at DESC, t.updated_at DESC',
                'search' => ['reference', 'notes'],
                'json' => [],
                'ints' => ['id', 'budget_id'],
                'floats' => ['amount'],
                'fields' => [
                    'budget_id' => ['type' => 'int', 'min' => 1, 'required' => true, 'foreign' => 'budgets'],
                    'amount' => ['type' => 'float', 'min' => 0.01, 'max_value' => 999999999.99, 'required' => true],
                    'paid_at' => ['type' => 'date', 'required' => true],
                    'method' => ['type' => 'enum', 'values' => ['transfer', 'cash', 'card', 'digital_wallet', 'other'], 'default' => 'transfer'],
                    'reference' => ['type' => 'string', 'nullable' => true, 'max' => 180],
                    'notes' => ['type' => 'string', 'nullable' => true, 'max' => 5000],
                ],
            ],
            'releases' => [
                'table' => 'releases',
                'singular' => 'entrega',
                'order' => 't.release_date IS NULL, t.release_date DESC, t.updated_at DESC',
                'search' => ['title', 'version', 'notes'],
                'json' => ['tags'],
                'ints' => ['id', 'project_id'],
                'fields' => [
                    'project_id' => ['type' => 'int', 'min' => 1, 'required' => true, 'foreign' => 'projects'],
                    'title' => ['type' => 'string', 'required' => true, 'max' => 180],
                    'version' => ['type' => 'string', 'nullable' => true, 'max' => 80],
                    'kind' => ['type' => 'enum', 'values' => ['version', 'delivery'], 'default' => 'version'],
                    'environment' => ['type' => 'enum', 'values' => ['development', 'staging', 'production', 'client'], 'default' => 'production'],
                    'status' => ['type' => 'enum', 'values' => ['planned', 'ready', 'published', 'rolled_back'], 'default' => 'planned'],
                    'release_date' => ['type' => 'date', 'nullable' => true],
                    'url' => ['type' => 'url', 'nullable' => true, 'max' => 500],
                    'notes' => ['type' => 'string', 'nullable' => true, 'max' => 5000],
                    'tags' => ['type' => 'array', 'default' => []],
                ],
            ],
            'resources' => [
                'table' => 'resources',
                'singular' => 'recurso',
                'order' => 't.updated_at DESC',
                'search' => ['name', 'provider', 'notes'],
                'json' => ['tags'],
                'ints' => ['id', 'project_id'],
                'floats' => ['cost'],
                'fields' => [
                    'project_id' => ['type' => 'int', 'min' => 1, 'nullable' => true, 'foreign' => 'projects'],
                    'name' => ['type' => 'string', 'required' => true, 'max' => 180],
                    'resource_type' => ['type' => 'enum', 'values' => ['domain', 'hosting', 'server', 'database', 'repository', 'service', 'documentation', 'other'], 'default' => 'service'],
                    'provider' => ['type' => 'string', 'nullable' => true, 'max' => 140],
                    'url' => ['type' => 'url', 'nullable' => true, 'max' => 500],
                    'environment' => ['type' => 'enum', 'values' => ['development', 'staging', 'production', 'shared'], 'default' => 'production'],
                    'status' => ['type' => 'enum', 'values' => ['active', 'attention', 'inactive'], 'default' => 'active'],
                    'renewal_date' => ['type' => 'date', 'nullable' => true],
                    'cost' => ['type' => 'float', 'min' => 0, 'max_value' => 999999999.99, 'default' => 0],
                    'currency' => ['type' => 'enum', 'values' => ['ARS', 'USD', 'EUR'], 'default' => 'ARS'],
                    'billing_cycle' => ['type' => 'enum', 'values' => ['none', 'monthly', 'yearly', 'one_time'], 'default' => 'none'],
                    'notes' => ['type' => 'string', 'nullable' => true, 'max' => 5000],
                    'tags' => ['type' => 'array', 'default' => []],
                ],
            ],
            'reminders' => [
                'table' => 'reminders',
                'singular' => 'recordatorio',
                'order' => "FIELD(t.status, 'pending', 'done', 'dismissed'), t.due_at ASC, t.updated_at DESC",
                'search' => ['title', 'notes'],
                'json' => ['tags'],
                'ints' => ['id', 'project_id'],
                'fields' => [
                    'project_id' => ['type' => 'int', 'min' => 1, 'nullable' => true, 'foreign' => 'projects'],
                    'title' => ['type' => 'string', 'required' => true, 'max' => 180],
                    'due_at' => ['type' => 'datetime', 'required' => true],
                    'status' => ['type' => 'enum', 'values' => ['pending', 'done', 'dismissed'], 'default' => 'pending'],
                    'priority' => ['type' => 'enum', 'values' => ['low', 'medium', 'high'], 'default' => 'medium'],
                    'notes' => ['type' => 'string', 'nullable' => true, 'max' => 5000],
                    'tags' => ['type' => 'array', 'default' => []],
                ],
            ],
            'time_entries' => [
                'table' => 'time_entries',
                'singular' => 'registro de tiempo',
                'order' => 't.work_date DESC, t.started_at IS NULL, t.started_at DESC, t.updated_at DESC',
                'search' => ['description'],
                'json' => ['tags'],
                'ints' => ['id', 'project_id', 'task_id', 'duration_minutes'],
                'floats' => ['hourly_cost'],
                'bools' => ['billable', 'is_running'],
                'fields' => [
                    'project_id' => ['type' => 'int', 'min' => 1, 'nullable' => true, 'foreign' => 'projects'],
                    'task_id' => ['type' => 'int', 'min' => 1, 'nullable' => true, 'foreign' => 'tasks'],
                    'work_date' => ['type' => 'date', 'required' => true],
                    'description' => ['type' => 'string', 'required' => true, 'max' => 500],
                    'duration_minutes' => ['type' => 'int', 'min' => 0, 'max_value' => 1440, 'default' => 0],
                    'started_at' => ['type' => 'datetime', 'nullable' => true],
                    'ended_at' => ['type' => 'datetime', 'nullable' => true],
                    'billable' => ['type' => 'bool', 'default' => false],
                    'tags' => ['type' => 'array', 'default' => []],
                ],
            ],
            'weekly_reviews' => [
                'table' => 'weekly_reviews',
                'singular' => 'revisión semanal',
                'order' => 't.week_start DESC, t.updated_at DESC',
                'search' => ['wins', 'blockers', 'next_focus'],
                'json' => ['tags'],
                'ints' => ['id', 'rating'],
                'fields' => [
                    'week_start' => ['type' => 'date', 'required' => true],
                    'wins' => ['type' => 'string', 'nullable' => true, 'max' => 10000],
                    'blockers' => ['type' => 'string', 'nullable' => true, 'max' => 10000],
                    'next_focus' => ['type' => 'string', 'nullable' => true, 'max' => 10000],
                    'rating' => ['type' => 'int', 'min' => 1, 'max_value' => 5, 'default' => 3],
                    'tags' => ['type' => 'array', 'default' => []],
                ],
            ],
            'tags' => [
                'table' => 'tags',
                'singular' => 'etiqueta',
                'order' => 't.name ASC',
                'search' => ['name'],
                'json' => [],
                'ints' => ['id', 'usage_count'],
                'fields' => [
                    'name' => ['type' => 'string', 'required' => true, 'max' => 50],
                    'color' => ['type' => 'color', 'default' => '#7867E6'],
                ],
            ],
        ];
    }

    /** @return array<string, mixed> */
    public static function get(string $entity): array
    {
        $all = self::all();
        if (!isset($all[$entity])) {
            throw new ApiException('Recurso no encontrado.', 404);
        }
        return $all[$entity];
    }

    /**
     * @param array<string, mixed> $input
     * @return array{data: array<string, mixed>, errors: array<string, string>}
     */
    public static function validate(string $entity, array $input, bool $creating): array
    {
        $spec = self::get($entity);
        /** @var array<string, array<string, mixed>> $fields */
        $fields = $spec['fields'];
        $data = [];
        $errors = [];

        // Small compatibility aliases make simple clients easier to migrate.
        if ($entity === 'ideas' && array_key_exists('potential', $input) && !array_key_exists('impact', $input)) {
            $input['impact'] = $input['potential'];
        }
        if ($entity === 'projects') {
            if (array_key_exists('repository', $input) && !array_key_exists('repository_url', $input)) {
                $input['repository_url'] = $input['repository'];
            }

            $requestedType = $input['project_type'] ?? ($creating ? 'personal' : null);
            if (is_scalar($requestedType) && trim((string) $requestedType) === 'personal') {
                // Personal projects never retain commercial scheduling or ownership data.
                if ($creating || array_key_exists('client_id', $input)) {
                    $input['client_id'] = null;
                }
                if ($creating || array_key_exists('due_date', $input)) {
                    $input['due_date'] = null;
                }
            }
        }

        foreach ($fields as $name => $rules) {
            if (!array_key_exists($name, $input)) {
                if ($creating && array_key_exists('default', $rules)) {
                    $data[$name] = $rules['default'];
                } elseif ($creating && ($rules['required'] ?? false)) {
                    $errors[$name] = 'Este campo es obligatorio.';
                } elseif ($creating && ($rules['nullable'] ?? false)) {
                    $data[$name] = null;
                }
                continue;
            }

            $value = $input[$name];
            $nullable = (bool) ($rules['nullable'] ?? false);
            if ($value === null || (is_string($value) && trim($value) === '')) {
                if ($nullable) {
                    $data[$name] = null;
                } else {
                    $errors[$name] = 'Este campo no puede estar vacío.';
                }
                continue;
            }

            $result = self::normalize($value, $rules);
            if (isset($result['error'])) {
                $errors[$name] = $result['error'];
            } else {
                $data[$name] = $result['value'];
            }
        }

        if (isset($data['tags']) && is_array($data['tags'])) {
            $data['tags'] = TagNormalizer::names($data['tags']);
        }

        if ($entity === 'projects' && ($data['project_type'] ?? null) === 'personal') {
            // This also clears both fields when a PATCH changes a commercial project to personal.
            $data['client_id'] = null;
            $data['due_date'] = null;
        }
        if ($entity === 'resources' && isset($data['url']) && !self::resourceUrlIsSafe((string) $data['url'])) {
            $errors['url'] = 'La URL no puede incluir credenciales ni parámetros sensibles.';
            unset($data['url']);
        }

        if (!$creating && $data === [] && $errors === []) {
            $errors['body'] = 'No se recibió ningún campo editable.';
        }

        return ['data' => $data, 'errors' => $errors];
    }

    /**
     * @param mixed $value
     * @param array<string, mixed> $rules
     * @return array{value?: mixed, error?: string}
     */
    private static function normalize(mixed $value, array $rules): array
    {
        $type = (string) $rules['type'];

        if (in_array($type, ['string', 'email', 'url', 'enum', 'date', 'datetime', 'color'], true)) {
            if (!is_scalar($value)) {
                return ['error' => 'Debe ser texto.'];
            }
            $value = trim((string) $value);
        }

        if (in_array($type, ['string', 'email', 'url'], true)) {
            $max = (int) ($rules['max'] ?? 5000);
            if (mb_strlen((string) $value) > $max) {
                return ['error' => "No puede superar {$max} caracteres."];
            }
        }

        return match ($type) {
            'string' => ['value' => $value],
            'email' => filter_var($value, FILTER_VALIDATE_EMAIL)
                ? ['value' => mb_strtolower((string) $value)]
                : ['error' => 'Ingresa un email válido.'],
            'url' => self::url((string) $value),
            'enum' => in_array($value, $rules['values'], true)
                ? ['value' => $value]
                : ['error' => 'El valor elegido no es válido.'],
            'int' => self::number($value, $rules, true),
            'float' => self::number($value, $rules, false),
            'bool' => self::boolean($value),
            'date' => self::date($value, false),
            'datetime' => self::date($value, true),
            'color' => preg_match('/^#[0-9A-Fa-f]{6}$/', (string) $value) === 1
                ? ['value' => strtoupper((string) $value)]
                : ['error' => 'Usa un color hexadecimal como #7867E6.'],
            'array' => self::stringArray($value),
            default => ['error' => 'Tipo de campo no soportado.'],
        };
    }

    /** @param array<string, mixed> $rules */
    private static function number(mixed $value, array $rules, bool $integer): array
    {
        if ($integer) {
            $filtered = filter_var($value, FILTER_VALIDATE_INT);
            if ($filtered === false) {
                return ['error' => 'Debe ser un número entero.'];
            }
            $number = (int) $filtered;
        } else {
            if (!is_numeric($value)) {
                return ['error' => 'Debe ser un número.'];
            }
            $number = round((float) $value, 2);
        }

        if (isset($rules['min']) && $number < $rules['min']) {
            return ['error' => 'El valor es menor al permitido.'];
        }
        if (isset($rules['max_value']) && $number > $rules['max_value']) {
            return ['error' => 'El valor supera el máximo permitido.'];
        }
        return ['value' => $number];
    }

    /** @return array{value?: bool, error?: string} */
    private static function boolean(mixed $value): array
    {
        if (is_bool($value)) {
            return ['value' => $value];
        }
        if ($value === 0 || $value === 1 || $value === '0' || $value === '1') {
            return ['value' => (bool) $value];
        }
        if (is_string($value)) {
            $filtered = filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
            if ($filtered !== null) {
                return ['value' => $filtered];
            }
        }
        return ['error' => 'Debe ser verdadero o falso.'];
    }

    /** @return array{value?: string, error?: string} */
    private static function url(string $value): array
    {
        $scheme = mb_strtolower((string) parse_url($value, PHP_URL_SCHEME));
        if (filter_var($value, FILTER_VALIDATE_URL) === false || !in_array($scheme, ['http', 'https'], true)) {
            return ['error' => 'Ingresa una URL completa que empiece con http:// o https://.'];
        }
        return ['value' => $value];
    }

    private static function resourceUrlIsSafe(string $url): bool
    {
        $parts = parse_url($url);
        if (!is_array($parts) || array_key_exists('user', $parts) || array_key_exists('pass', $parts)) {
            return false;
        }

        $sensitiveKeys = ['token', 'api_key', 'secret', 'password', 'access_token'];
        $parameters = preg_split('/[&;]/', (string) ($parts['query'] ?? '')) ?: [];
        foreach ($parameters as $parameter) {
            $key = mb_strtolower(trim(rawurldecode(explode('=', $parameter, 2)[0])));
            $key = preg_replace('/\[\]$/', '', $key) ?? $key;
            if (in_array($key, $sensitiveKeys, true)) {
                return false;
            }
        }
        return true;
    }

    /** @return array{value?: string, error?: string} */
    private static function date(mixed $value, bool $withTime): array
    {
        $format = $withTime ? 'Y-m-d H:i:s' : 'Y-m-d';
        $input = (string) $value;
        if ($withTime) {
            $input = str_replace('T', ' ', $input);
            if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $input) === 1) {
                $input .= ':00';
            }
        }
        $date = DateTimeImmutable::createFromFormat('!' . $format, $input);
        $errors = DateTimeImmutable::getLastErrors();
        if ($date === false || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))) {
            return ['error' => $withTime ? 'Usa una fecha y hora válidas.' : 'Usa una fecha válida (AAAA-MM-DD).'];
        }
        return ['value' => $date->format($format)];
    }

    /** @return array{value?: array<int, string>, error?: string} */
    private static function stringArray(mixed $value): array
    {
        if (is_string($value)) {
            $trimmed = trim($value);
            if ($trimmed === '') {
                return ['value' => []];
            }
            $decoded = json_decode($trimmed, true);
            $value = is_array($decoded) ? $decoded : explode(',', $trimmed);
        }
        if (!is_array($value)) {
            return ['error' => 'Debe ser una lista.'];
        }

        $items = [];
        foreach ($value as $item) {
            if (!is_scalar($item)) {
                return ['error' => 'Cada elemento debe ser texto.'];
            }
            $item = trim((string) $item);
            if ($item !== '' && !in_array($item, $items, true)) {
                if (mb_strlen($item) > 50) {
                    return ['error' => 'Cada elemento puede tener hasta 50 caracteres.'];
                }
                $items[] = $item;
            }
        }
        if (count($items) > 30) {
            return ['error' => 'La lista puede tener hasta 30 elementos.'];
        }
        return ['value' => $items];
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    public static function castRow(string $entity, array $row): array
    {
        $spec = self::get($entity);
        unset($row['user_id']);
        if ($entity === 'time_entries') {
            unset($row['running_slot']);
        }

        foreach ($spec['json'] as $field) {
            if (!isset($row[$field])) {
                $row[$field] = [];
                continue;
            }
            if (is_string($row[$field])) {
                $decoded = json_decode($row[$field], true);
                $row[$field] = is_array($decoded) ? array_values($decoded) : [];
            }
        }
        foreach ($spec['ints'] as $field) {
            if (array_key_exists($field, $row)) {
                $row[$field] = $row[$field] === null ? null : (int) $row[$field];
            }
        }
        foreach ($spec['floats'] ?? [] as $field) {
            if (array_key_exists($field, $row)) {
                $row[$field] = $row[$field] === null ? null : (float) $row[$field];
            }
        }
        foreach ($spec['bools'] ?? [] as $field) {
            if (array_key_exists($field, $row)) {
                $row[$field] = (bool) $row[$field];
            }
        }

        return $row;
    }
}
