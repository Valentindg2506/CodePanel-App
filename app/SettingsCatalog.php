<?php

declare(strict_types=1);

namespace CodePanel;

use DateTimeZone;

final class SettingsCatalog
{
    /** @return array<string, mixed> */
    public static function defaults(): array
    {
        return [
            'default_currency' => 'ARS',
            'date_format' => 'd/m/Y',
            'timezone' => Env::get('APP_TIMEZONE', 'America/Argentina/Buenos_Aires') ?? 'America/Argentina/Buenos_Aires',
            'theme' => 'system',
            'week_start' => 'monday',
            'default_hourly_cost' => 0.0,
            'dashboard_widgets' => [
                'overview', 'projects', 'tasks', 'reminders', 'time_tracking',
                'profitability', 'calendar', 'weekly_review', 'budgets', 'resources',
            ],
            'reminder_days' => [1, 3, 7],
        ];
    }

    /** @return array<int, string> */
    public static function widgetAllowlist(): array
    {
        return [
            'overview', 'projects', 'tasks', 'reminders', 'time_tracking',
            'profitability', 'calendar', 'weekly_review', 'budgets', 'resources',
        ];
    }

    /**
     * @param array<string, mixed> $input
     * @return array{data: array<string, mixed>, errors: array<string, string>}
     */
    public static function validate(array $input, bool $partial = true): array
    {
        unset($input['_csrf']);
        $data = [];
        $errors = [];

        if (!$partial) {
            $input = array_merge(self::defaults(), $input);
        }

        $enums = [
            'default_currency' => ['ARS', 'USD', 'EUR'],
            'date_format' => ['d/m/Y', 'm/d/Y', 'Y-m-d'],
            'theme' => ['system', 'light', 'night'],
            'week_start' => ['monday', 'sunday'],
        ];
        foreach ($enums as $field => $allowed) {
            if (!array_key_exists($field, $input)) {
                continue;
            }
            $value = is_scalar($input[$field]) ? trim((string) $input[$field]) : '';
            if (!in_array($value, $allowed, true)) {
                $errors[$field] = 'El valor elegido no es válido.';
            } else {
                $data[$field] = $value;
            }
        }

        if (array_key_exists('timezone', $input)) {
            $timezone = is_scalar($input['timezone']) ? trim((string) $input['timezone']) : '';
            if ($timezone === '' || !in_array($timezone, DateTimeZone::listIdentifiers(), true)) {
                $errors['timezone'] = 'Elige una zona horaria IANA válida.';
            } else {
                $data['timezone'] = $timezone;
            }
        }

        if (array_key_exists('default_hourly_cost', $input)) {
            $value = $input['default_hourly_cost'];
            if (!is_numeric($value) || (float) $value < 0 || (float) $value > 999999999.99) {
                $errors['default_hourly_cost'] = 'Ingresa un costo por hora válido.';
            } else {
                $data['default_hourly_cost'] = round((float) $value, 2);
            }
        }

        if (array_key_exists('dashboard_widgets', $input)) {
            $widgets = self::arrayInput($input['dashboard_widgets']);
            if ($widgets === null) {
                $errors['dashboard_widgets'] = 'Debe ser una lista de widgets.';
            } else {
                $normalized = [];
                foreach ($widgets as $widget) {
                    if (!is_scalar($widget) || !in_array((string) $widget, self::widgetAllowlist(), true)) {
                        $errors['dashboard_widgets'] = 'La lista contiene un widget no permitido.';
                        break;
                    }
                    if (!in_array((string) $widget, $normalized, true)) {
                        $normalized[] = (string) $widget;
                    }
                }
                if (!isset($errors['dashboard_widgets'])) {
                    $data['dashboard_widgets'] = $normalized;
                }
            }
        }

        if (array_key_exists('reminder_days', $input)) {
            $days = self::arrayInput($input['reminder_days']);
            if ($days === null || count($days) > 20) {
                $errors['reminder_days'] = 'Debe ser una lista de hasta 20 anticipaciones.';
            } else {
                $normalized = [];
                foreach ($days as $day) {
                    $valid = filter_var($day, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 365]]);
                    if ($valid === false) {
                        $errors['reminder_days'] = 'Cada anticipación debe estar entre 0 y 365 días.';
                        break;
                    }
                    $normalized[] = (int) $valid;
                }
                if (!isset($errors['reminder_days'])) {
                    $normalized = array_values(array_unique($normalized));
                    sort($normalized, SORT_NUMERIC);
                    $data['reminder_days'] = $normalized;
                }
            }
        }

        if ($partial && $data === [] && $errors === []) {
            $errors['body'] = 'No se recibió ningún ajuste editable.';
        }

        return ['data' => $data, 'errors' => $errors];
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    public static function castRow(array $row): array
    {
        unset($row['user_id']);
        foreach (['dashboard_widgets', 'reminder_days'] as $field) {
            if (is_string($row[$field] ?? null)) {
                $decoded = json_decode($row[$field], true);
                $row[$field] = is_array($decoded) ? array_values($decoded) : [];
            } elseif (!is_array($row[$field] ?? null)) {
                $row[$field] = [];
            }
        }
        $row['default_hourly_cost'] = (float) ($row['default_hourly_cost'] ?? 0);
        return array_merge(self::defaults(), $row);
    }

    /** @return array<int, mixed>|null */
    private static function arrayInput(mixed $value): ?array
    {
        if (is_string($value)) {
            try {
                $value = json_decode($value, true, 32, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                return null;
            }
        }
        return is_array($value) && array_is_list($value) ? $value : null;
    }
}
