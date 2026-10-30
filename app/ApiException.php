<?php

declare(strict_types=1);

namespace CodePanel;

use RuntimeException;

final class ApiException extends RuntimeException
{
    /** @param array<string, string|array<int, string>> $errors */
    public function __construct(
        string $message,
        public readonly int $status = 400,
        public readonly array $errors = [],
    ) {
        parent::__construct($message);
    }
}
