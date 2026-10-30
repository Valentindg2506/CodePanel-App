<?php

declare(strict_types=1);

namespace CodePanel;

use PDO;
use PDOException;

final class Auth
{
    private const USER_KEY = 'codepanel_user_id';
    private const DEMO_USER_KEY = 'codepanel_demo_user';
    private const CSRF_KEY = 'codepanel_csrf_token';
    private const ATTEMPTS_KEY = 'codepanel_login_attempts';
    // Fallos permitidos dentro de la ventana antes de pausar el acceso.
    private const ATTEMPT_WINDOW_SECONDS = 900;
    private const MAX_FAILURES_PER_EMAIL = 5;
    private const MAX_FAILURES_PER_IP = 20;

    public function __construct(
        private readonly ?PDO $pdo,
        private readonly bool $demoMode,
    ) {
    }

    /** @return array<string, mixed>|null */
    public function user(bool $autoDemo = true): ?array
    {
        if ($this->demoMode) {
            if (!isset($_SESSION[self::DEMO_USER_KEY]) && $autoDemo) {
                $_SESSION[self::DEMO_USER_KEY] = [
                    'id' => 1,
                    'name' => 'Alex Rivera',
                    'email' => 'demo@codepanel.local',
                    'avatar_url' => null,
                    'created_at' => date('Y-m-d H:i:s', strtotime('-90 days')),
                    '_password_hash' => password_hash('Demo1234!', PASSWORD_DEFAULT),
                ];
                $this->rotateSession();
            }
            $user = $_SESSION[self::DEMO_USER_KEY] ?? null;
            return is_array($user) ? $this->publicUser($user) : null;
        }

        $userId = filter_var($_SESSION[self::USER_KEY] ?? null, FILTER_VALIDATE_INT);
        if ($userId === false || $userId === null || $this->pdo === null) {
            return null;
        }

        $statement = $this->pdo->prepare(
            'SELECT id, name, email, avatar_url, created_at FROM users WHERE id = :id LIMIT 1',
        );
        $statement->execute([':id' => (int) $userId]);
        $user = $statement->fetch();
        if (!is_array($user)) {
            unset($_SESSION[self::USER_KEY]);
            return null;
        }
        return $this->publicUser($user);
    }

    /** @return array<string, mixed> */
    public function requireUser(): array
    {
        $user = $this->user();
        if ($user === null) {
            throw new ApiException('Inicia sesión para continuar.', 401);
        }
        return $user;
    }

    /** @param array<string, mixed> $input @return array<string, mixed> */
    public function login(array $input): array
    {
        $email = mb_strtolower(trim((string) ($input['email'] ?? '')));
        $this->guardLoginRate($email);
        $password = (string) ($input['password'] ?? '');
        $errors = [];
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'Ingresa un email válido.';
        }
        if ($password === '') {
            $errors['password'] = 'Ingresa tu contraseña.';
        }
        if ($errors !== []) {
            throw new ApiException('Revisa los datos enviados.', 422, $errors);
        }

        if ($this->demoMode) {
            $stored = $_SESSION[self::DEMO_USER_KEY] ?? null;
            $valid = is_array($stored)
                && hash_equals(mb_strtolower((string) ($stored['email'] ?? '')), $email)
                && password_verify($password, (string) ($stored['_password_hash'] ?? ''));
            if (!$valid && $email === 'demo@codepanel.local' && hash_equals('Demo1234!', $password)) {
                unset($_SESSION[self::DEMO_USER_KEY]);
                $this->user(true);
                $valid = true;
            }
            if (!$valid) {
                $this->recordFailedLogin($email);
                throw new ApiException('Email o contraseña incorrectos.', 401);
            }
            $this->clearLoginAttempts($email);
            $this->rotateSession();
            return $this->authPayload($this->requireUser());
        }

        if ($this->pdo === null) {
            throw new ApiException('La base de datos no está disponible.', 503);
        }
        $statement = $this->pdo->prepare(
            'SELECT id, name, email, avatar_url, password_hash, created_at FROM users WHERE email = :email LIMIT 1',
        );
        $statement->execute([':email' => $email]);
        $user = $statement->fetch();
        if (!is_array($user) || !password_verify($password, (string) $user['password_hash'])) {
            $this->recordFailedLogin($email);
            throw new ApiException('Email o contraseña incorrectos.', 401);
        }

        if (password_needs_rehash((string) $user['password_hash'], PASSWORD_DEFAULT)) {
            $rehash = $this->pdo->prepare('UPDATE users SET password_hash = :hash WHERE id = :id');
            $rehash->execute([':hash' => password_hash($password, PASSWORD_DEFAULT), ':id' => $user['id']]);
        }

        $this->clearLoginAttempts($email);
        $this->rotateSession();
        $_SESSION[self::USER_KEY] = (int) $user['id'];
        unset($user['password_hash']);
        return $this->authPayload($this->publicUser($user));
    }

    /** @param array<string, mixed> $input @return array<string, mixed> */
    public function register(array $input): array
    {
        if (!$this->registrationEnabled()) {
            throw new ApiException('El registro público está desactivado.', 403, [
                'registration' => 'Pide al administrador que cree o habilite tu cuenta.',
            ]);
        }

        $name = trim((string) ($input['name'] ?? ''));
        $email = mb_strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $errors = [];

        if (mb_strlen($name) < 2 || mb_strlen($name) > 80) {
            $errors['name'] = 'El nombre debe tener entre 2 y 80 caracteres.';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 190) {
            $errors['email'] = 'Ingresa un email válido.';
        }
        if (strlen($password) < 8 || strlen($password) > 200) {
            $errors['password'] = 'La contraseña debe tener entre 8 y 200 caracteres.';
        } elseif (!preg_match('/[A-Za-z]/', $password) || !preg_match('/\d/', $password)) {
            $errors['password'] = 'Incluye al menos una letra y un número.';
        }
        if ($errors !== []) {
            throw new ApiException('Revisa los datos enviados.', 422, $errors);
        }

        if ($this->demoMode) {
            $this->rotateSession();
            $_SESSION[self::DEMO_USER_KEY] = [
                'id' => 1,
                'name' => $name,
                'email' => $email,
                'avatar_url' => null,
                'created_at' => date('Y-m-d H:i:s'),
                '_password_hash' => password_hash($password, PASSWORD_DEFAULT),
            ];
            return $this->authPayload($this->requireUser());
        }

        if ($this->pdo === null) {
            throw new ApiException('La base de datos no está disponible.', 503);
        }

        try {
            $statement = $this->pdo->prepare(
                'INSERT INTO users (name, email, password_hash) VALUES (:name, :email, :password_hash)',
            );
            $statement->execute([
                ':name' => $name,
                ':email' => $email,
                ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
            ]);
        } catch (PDOException $exception) {
            if ((string) $exception->getCode() === '23000') {
                throw new ApiException('Ya existe una cuenta con ese email.', 409, ['email' => 'El email ya está registrado.']);
            }
            throw $exception;
        }

        $this->rotateSession();
        $_SESSION[self::USER_KEY] = (int) $this->pdo->lastInsertId();
        return $this->authPayload($this->requireUser());
    }

    public function logout(): void
    {
        unset($_SESSION[self::USER_KEY], $_SESSION[self::DEMO_USER_KEY], $_SESSION[self::CSRF_KEY]);
        $this->rotateSession();
    }

    public function csrfToken(): string
    {
        if (!isset($_SESSION[self::CSRF_KEY]) || !is_string($_SESSION[self::CSRF_KEY])) {
            $_SESSION[self::CSRF_KEY] = bin2hex(random_bytes(32));
        }
        return $_SESSION[self::CSRF_KEY];
    }

    public function assertCsrf(): void
    {
        // Demo data exists only inside this same session and has no durable impact.
        // Keeping its writes frictionless also lets the static UI work out of the box.
        if ($this->demoMode) {
            return;
        }

        $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
        if (!is_string($provided) || $provided === '') {
            $contentType = mb_strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
            if (str_starts_with($contentType, 'multipart/form-data')) {
                $provided = is_string($_POST['_csrf'] ?? null) ? $_POST['_csrf'] : '';
            } else {
                $body = Http::body();
                $provided = is_string($body['_csrf'] ?? null) ? $body['_csrf'] : '';
            }
        }
        if ($provided === '' || !hash_equals($this->csrfToken(), $provided)) {
            // 419 no forma parte del estándar HTTP y algunos servidores Apache
            // lo transforman en 500. Un 403 con una clave estable conserva la
            // semántica y permite al cliente renovar el token de forma segura.
            throw new ApiException('El token de seguridad venció. Recarga la página e inténtalo nuevamente.', 403, [
                'csrf' => 'Actualiza el token de seguridad antes de reintentar.',
            ]);
        }
    }

    public function demoMode(): bool
    {
        return $this->demoMode;
    }

    /** Cerrado por defecto: sólo se abre con ALLOW_REGISTRATION=true o para crear la primera cuenta. */
    public function registrationEnabled(): bool
    {
        if (Env::bool('ALLOW_REGISTRATION', false)) {
            return true;
        }
        return $this->pdo !== null
            && (int) $this->pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0;
    }

    /** @param array<string, mixed> $user @return array<string, mixed> */
    private function authPayload(array $user): array
    {
        return [
            'user' => $user,
            'csrf_token' => $this->csrfToken(),
            'demo_mode' => $this->demoMode,
            'registration_enabled' => $this->registrationEnabled(),
        ];
    }

    /** @param array<string, mixed> $user @return array<string, mixed> */
    private function publicUser(array $user): array
    {
        unset($user['password_hash'], $user['_password_hash']);
        $user['id'] = (int) ($user['id'] ?? 0);
        return $user;
    }

    private function rotateSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
        }
    }

    /**
     * Con base de datos, los fallos se cuentan por email y por IP en login_attempts, así que
     * cambiar de cookie no reinicia el contador. Sin base (modo demo) se cuentan en la sesión.
     */
    private function guardLoginRate(string $email): void
    {
        if ($this->pdo === null) {
            $attempts = $_SESSION[self::ATTEMPTS_KEY] ?? [];
            $cutoff = time() - 60;
            $attempts = is_array($attempts)
                ? array_values(array_filter($attempts, static fn (mixed $timestamp): bool => is_int($timestamp) && $timestamp >= $cutoff))
                : [];
            $_SESSION[self::ATTEMPTS_KEY] = $attempts;
            if (count($attempts) >= self::MAX_FAILURES_PER_EMAIL) {
                throw new ApiException('Demasiados intentos. Espera un minuto antes de volver a probar.', 429);
            }
            return;
        }

        $statement = $this->pdo->prepare(
            'SELECT
                SUM(email = :email) AS by_email,
                SUM(ip_address = :ip) AS by_ip
             FROM login_attempts
             WHERE attempted_at >= UTC_TIMESTAMP() - INTERVAL :window SECOND
               AND (email = :email_match OR ip_address = :ip_match)',
        );
        $statement->execute([
            ':email' => $email, ':email_match' => $email,
            ':ip' => $this->clientIp(), ':ip_match' => $this->clientIp(),
            ':window' => self::ATTEMPT_WINDOW_SECONDS,
        ]);
        $counts = $statement->fetch() ?: [];
        if ((int) ($counts['by_email'] ?? 0) >= self::MAX_FAILURES_PER_EMAIL
            || (int) ($counts['by_ip'] ?? 0) >= self::MAX_FAILURES_PER_IP) {
            throw new ApiException('Demasiados intentos. Espera unos minutos antes de volver a probar.', 429);
        }
    }

    private function recordFailedLogin(string $email): void
    {
        if ($this->pdo === null) {
            $_SESSION[self::ATTEMPTS_KEY][] = time();
            return;
        }
        $this->pdo->prepare('DELETE FROM login_attempts WHERE attempted_at < UTC_TIMESTAMP() - INTERVAL 1 DAY')->execute();
        $this->pdo->prepare(
            'INSERT INTO login_attempts (email, ip_address, attempted_at) VALUES (:email, :ip, UTC_TIMESTAMP())',
        )->execute([':email' => mb_substr($email, 0, 190), ':ip' => $this->clientIp()]);
    }

    private function clearLoginAttempts(string $email): void
    {
        unset($_SESSION[self::ATTEMPTS_KEY]);
        $this->pdo?->prepare('DELETE FROM login_attempts WHERE email = :email')->execute([':email' => $email]);
    }

    /** REMOTE_ADDR y no X-Forwarded-For: esa cabecera la puede inventar cualquiera. */
    private function clientIp(): string
    {
        return mb_substr((string) ($_SERVER['REMOTE_ADDR'] ?? 'cli'), 0, 45);
    }
}
