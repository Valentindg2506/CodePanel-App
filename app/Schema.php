<?php

declare(strict_types=1);

namespace CodePanel;

use PDO;
use Throwable;

/**
 * Conoce las tablas y columnas reales de la base de datos.
 *
 * El código se despliega desde GitHub y las migraciones se aplican a mano. Mientras una migración
 * no esté aplicada, las funciones que la necesitan se desactivan solas y el resto de la aplicación
 * sigue funcionando igual: nunca se escribe en columnas o tablas que todavía no existen.
 */
final class Schema
{
    /** @var array<string, array<int, string>> */
    private static array $columns = [];

    /** @var array<string, bool> */
    private static array $tables = [];

    public static function hasTable(?PDO $pdo, string $table): bool
    {
        if ($pdo === null) {
            return false;
        }
        if (!array_key_exists($table, self::$tables)) {
            try {
                $statement = $pdo->prepare(
                    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :table LIMIT 1',
                );
                $statement->execute([':table' => $table]);
                self::$tables[$table] = $statement->fetchColumn() !== false;
            } catch (Throwable) {
                self::$tables[$table] = false;
            }
        }
        return self::$tables[$table];
    }

    /** @return array<int, string> */
    public static function columns(?PDO $pdo, string $table): array
    {
        if ($pdo === null) {
            return [];
        }
        if (!array_key_exists($table, self::$columns)) {
            try {
                $statement = $pdo->prepare(
                    'SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :table',
                );
                $statement->execute([':table' => $table]);
                self::$columns[$table] = array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN));
            } catch (Throwable) {
                self::$columns[$table] = [];
            }
        }
        return self::$columns[$table];
    }

    public static function hasColumn(?PDO $pdo, string $table, string $column): bool
    {
        return in_array($column, self::columns($pdo, $table), true);
    }

    /** Olvida lo aprendido (para pruebas que cambian el esquema en el mismo proceso). */
    public static function reset(): void
    {
        self::$columns = [];
        self::$tables = [];
    }
}
