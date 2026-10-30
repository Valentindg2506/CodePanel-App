<?php

declare(strict_types=1);

namespace CodePanel;

use PDO;
use PDOException;
use Throwable;

final class Database
{
    private static ?string $lastError = null;

    public static function connect(): ?PDO
    {
        $host = Env::get('DB_HOST', '127.0.0.1');
        $port = Env::int('DB_PORT', 3306);
        $name = Env::get('DB_NAME', 'codepanel');
        $charset = Env::get('DB_CHARSET', 'utf8mb4');

        try {
            $pdo = new PDO(
                "mysql:host={$host};port={$port};dbname={$name};charset={$charset}",
                Env::get('DB_USER', 'root'),
                Env::get('DB_PASS', ''),
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false,
                    PDO::ATTR_STRINGIFY_FETCHES => false,
                    PDO::ATTR_TIMEOUT => 2,
                ],
            );

            // A successful socket connection is not enough: an uninstalled schema
            // should also enter demo mode instead of breaking every dashboard call.
            $pdo->query('SELECT 1 FROM users LIMIT 1');
            self::$lastError = null;
            return $pdo;
        } catch (PDOException $exception) {
            self::$lastError = $exception->getMessage();
            return null;
        } catch (Throwable $exception) {
            self::$lastError = $exception->getMessage();
            return null;
        }
    }

    public static function lastError(): ?string
    {
        return self::$lastError;
    }
}
