<?php

declare(strict_types=1);

use CodePanel\ApiException;
use CodePanel\Env;
use CodePanel\Http;
use CodePanel\Kernel;

require dirname(__DIR__) . '/app/bootstrap.php';

Http::sendHeaders();

try {
    (new Kernel())->run();
} catch (ApiException $exception) {
    Http::error($exception->getMessage(), $exception->status, $exception->errors);
} catch (Throwable $exception) {
    error_log('[CodePanel] ' . $exception::class . ': ' . $exception->getMessage());
    $errors = Env::bool('APP_DEBUG')
        ? ['exception' => $exception->getMessage()]
        : [];
    Http::error('Ocurrió un error inesperado.', 500, $errors);
}
