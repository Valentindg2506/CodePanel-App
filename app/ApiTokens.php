<?php

declare(strict_types=1);

namespace CodePanel;

use PDO;

/**
 * Tokens personales para usar la API desde la terminal, scripts o el editor.
 *
 * - El token completo solo se muestra una vez, al crearlo. En la base se guarda su SHA-256.
 * - «read» solo permite consultar; «write» permite además crear, editar y borrar.
 * - Nunca sirven para gestionar tokens, cambiar la configuración, compartir proyectos ni subir archivos:
 *   eso exige la sesión del navegador.
 */
final class ApiTokens
{
    public const TABLE = 'api_tokens';
    private const MAX_ACTIVE = 20;
    private const PREFIX = 'cp_';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function available(): bool
    {
        return Schema::hasTable($this->pdo, self::TABLE);
    }

    /** @return array<int, array<string, mixed>> */
    public function list(int $userId): array
    {
        $this->assertAvailable();
        $statement = $this->pdo->prepare(
            'SELECT id, name, token_prefix, scope, last_used_at, expires_at, revoked_at, created_at
             FROM api_tokens WHERE user_id = :user_id AND revoked_at IS NULL
             ORDER BY created_at DESC, id DESC',
        );
        $statement->execute([':user_id' => $userId]);
        return array_map(static function (array $row): array {
            $row['id'] = (int) $row['id'];
            $row['expired'] = $row['expires_at'] !== null && strtotime((string) $row['expires_at'] . ' UTC') < time();
            return $row;
        }, $statement->fetchAll());
    }

    /**
     * @param array<string, mixed> $input
     * @return array{token: string, record: array<string, mixed>}
     */
    public function create(int $userId, array $input): array
    {
        $this->assertAvailable();
        $name = trim((string) ($input['name'] ?? ''));
        $scope = (string) ($input['scope'] ?? 'read');
        $days = $input['expires_in_days'] ?? null;
        $errors = [];
        if ($name === '' || mb_strlen($name) > 80) {
            $errors['name'] = 'Ponle un nombre de hasta 80 caracteres, por ejemplo «Terminal del portátil».';
        }
        if (!in_array($scope, ['read', 'write'], true)) {
            $errors['scope'] = 'Elige solo lectura o lectura y escritura.';
        }
        $expiresAt = null;
        if ($days !== null && $days !== '' && $days !== 0 && $days !== '0') {
            $days = filter_var($days, FILTER_VALIDATE_INT);
            if (!in_array($days, [30, 90, 365], true)) {
                $errors['expires_in_days'] = 'La caducidad puede ser de 30, 90 o 365 días, o sin caducidad.';
            } else {
                $expiresAt = gmdate('Y-m-d H:i:s', time() + $days * 86400);
            }
        }
        if ($errors !== []) {
            throw new ApiException('Revisa los datos del token.', 422, $errors);
        }

        $count = $this->pdo->prepare('SELECT COUNT(*) FROM api_tokens WHERE user_id = :user_id AND revoked_at IS NULL');
        $count->execute([':user_id' => $userId]);
        if ((int) $count->fetchColumn() >= self::MAX_ACTIVE) {
            throw new ApiException('Ya tienes ' . self::MAX_ACTIVE . ' tokens activos. Revoca alguno antes de crear otro.', 422);
        }

        $token = self::PREFIX . bin2hex(random_bytes(24));
        $statement = $this->pdo->prepare(
            'INSERT INTO api_tokens (user_id, name, token_prefix, token_hash, scope, expires_at)
             VALUES (:user_id, :name, :prefix, :hash, :scope, :expires_at)',
        );
        $statement->execute([
            ':user_id' => $userId,
            ':name' => $name,
            ':prefix' => substr($token, 0, 11),
            ':hash' => hash('sha256', $token),
            ':scope' => $scope,
            ':expires_at' => $expiresAt,
        ]);
        $id = (int) $this->pdo->lastInsertId();
        $record = array_values(array_filter($this->list($userId), static fn (array $row): bool => $row['id'] === $id))[0] ?? [];
        return ['token' => $token, 'record' => $record];
    }

    public function revoke(int $userId, int $id): bool
    {
        $this->assertAvailable();
        $statement = $this->pdo->prepare(
            'UPDATE api_tokens SET revoked_at = UTC_TIMESTAMP() WHERE id = :id AND user_id = :user_id AND revoked_at IS NULL',
        );
        $statement->execute([':id' => $id, ':user_id' => $userId]);
        return $statement->rowCount() > 0;
    }

    /**
     * Devuelve el usuario y el alcance de un token válido, o null.
     *
     * @return array{user_id: int, scope: string, token_id: int}|null
     */
    public function authenticate(string $token): ?array
    {
        if (!$this->available() || preg_match('/^cp_[0-9a-f]{48}$/', $token) !== 1) {
            return null;
        }
        $statement = $this->pdo->prepare(
            'SELECT id, user_id, scope, expires_at FROM api_tokens
             WHERE token_hash = :hash AND revoked_at IS NULL LIMIT 1',
        );
        $statement->execute([':hash' => hash('sha256', $token)]);
        $row = $statement->fetch();
        if (!is_array($row)) {
            return null;
        }
        if ($row['expires_at'] !== null && strtotime((string) $row['expires_at'] . ' UTC') < time()) {
            return null;
        }
        // Se anota el último uso como mucho una vez por minuto para no escribir en cada petición.
        $this->pdo->prepare(
            'UPDATE api_tokens SET last_used_at = UTC_TIMESTAMP()
             WHERE id = :id AND (last_used_at IS NULL OR last_used_at < UTC_TIMESTAMP() - INTERVAL 1 MINUTE)',
        )->execute([':id' => (int) $row['id']]);
        return ['user_id' => (int) $row['user_id'], 'scope' => (string) $row['scope'], 'token_id' => (int) $row['id']];
    }

    /** Token enviado en «Authorization: Bearer …» o en «X-CodePanel-Token». */
    public static function fromRequest(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null;
        if (!is_string($header) && function_exists('getallheaders')) {
            foreach (getallheaders() ?: [] as $name => $value) {
                if (strtolower((string) $name) === 'authorization') {
                    $header = (string) $value;
                }
            }
        }
        if (is_string($header) && preg_match('/^\s*Bearer\s+(\S+)\s*$/i', $header, $match) === 1) {
            return $match[1];
        }
        $custom = $_SERVER['HTTP_X_CODEPANEL_TOKEN'] ?? null;
        return is_string($custom) && trim($custom) !== '' ? trim($custom) : null;
    }

    private function assertAvailable(): void
    {
        if (!$this->available()) {
            throw new ApiException('Los tokens de API estarán disponibles cuando se aplique la última migración de la base de datos.', 503);
        }
    }
}
