<?php

declare(strict_types=1);

namespace CodePanel;

use JsonException;

final class Http
{
    /** @var array<string, mixed>|null */
    private static ?array $body = null;

    public static function sendHeaders(): void
    {
        header_remove('X-Powered-By');
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, private');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        header('X-Frame-Options: SAMEORIGIN');
        header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    }

    public static function method(): string
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        if ($method === 'POST') {
            $override = $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? null;
            if (is_string($override) && in_array(strtoupper($override), ['PUT', 'PATCH', 'DELETE'], true)) {
                return strtoupper($override);
            }
        }

        return $method;
    }

    /** @return array<string, mixed> */
    public static function body(): array
    {
        if (self::$body !== null) {
            return self::$body;
        }

        $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($contentLength > 1_048_576) {
            throw new ApiException('El cuerpo de la petición es demasiado grande.', 413);
        }

        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            /** @var array<string, mixed> $post */
            $post = $_POST;
            return self::$body = $post;
        }

        try {
            $decoded = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new ApiException('El JSON enviado no es válido.', 400, ['body' => 'Revisa la sintaxis JSON.']);
        }

        if (!is_array($decoded) || array_is_list($decoded)) {
            throw new ApiException('El cuerpo debe ser un objeto JSON.', 400, ['body' => 'Se esperaba un objeto.']);
        }

        /** @var array<string, mixed> $decoded */
        return self::$body = $decoded;
    }

    /**
     * @param mixed $data
     * @param array<string, mixed> $meta
     */
    public static function success(
        mixed $data = null,
        string $message = 'OK',
        int $status = 200,
        array $meta = [],
    ): never {
        self::respond([
            'success' => true,
            'data' => $data,
            'message' => $message,
            'errors' => (object) [],
            'meta' => (object) $meta,
        ], $status);
    }

    /** @param array<string, string|array<int, string>> $errors */
    public static function error(
        string $message,
        int $status = 400,
        array $errors = [],
        array $meta = [],
    ): never {
        self::respond([
            'success' => false,
            'data' => null,
            'message' => $message,
            'errors' => $errors === [] ? (object) [] : $errors,
            'meta' => $meta === [] ? (object) [] : $meta,
        ], $status);
    }

    /** @param array<string, mixed> $payload */
    private static function respond(array $payload, int $status): never
    {
        http_response_code($status);
        echo json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE,
        );
        exit;
    }
}
