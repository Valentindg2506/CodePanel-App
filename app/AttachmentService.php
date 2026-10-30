<?php

declare(strict_types=1);

namespace CodePanel;

use finfo;

final class AttachmentService
{
    private const HARD_FILE_LIMIT = 10_485_760;
    private const HARD_USER_QUOTA = 104_857_600;

    /** @return array<int, string> */
    public static function entityTypes(): array
    {
        return [
            'general', 'projects', 'tasks', 'clients', 'leads', 'ideas', 'devlogs',
            'budgets', 'payments', 'releases', 'resources', 'reminders',
            'time_entries', 'weekly_reviews',
        ];
    }

    /** @return array<string, mixed> */
    public function upload(DataStore $store, int $userId): array
    {
        $entityType = is_string($_POST['entity_type'] ?? null) ? trim($_POST['entity_type']) : '';
        $rawEntityId = $_POST['entity_id'] ?? null;
        $entityId = filter_var($rawEntityId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        $errors = [];
        if (!in_array($entityType, self::entityTypes(), true)) {
            $errors['entity_type'] = 'El tipo de registro no admite archivos.';
        }
        if ($entityId === false || ($entityType === 'general' && (int) $entityId !== 0)
            || ($entityType !== 'general' && (int) $entityId < 1)) {
            $errors['entity_id'] = $entityType === 'general'
                ? 'La documentación general usa entity_id 0.'
                : 'Indica un registro válido.';
        }
        if ($errors === [] && $entityType !== 'general'
            && !$store->foreignExists($entityType, (int) $entityId, $userId)) {
            // A direct ID belonging to somebody else must not reveal its existence.
            throw new ApiException('No encontramos ese registro.', 404);
        }

        $file = $_FILES['file'] ?? null;
        if (!is_array($file)) {
            $errors['file'] = 'Selecciona un archivo.';
        } elseif ((int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            $errors['file'] = $this->uploadError((int) ($file['error'] ?? UPLOAD_ERR_NO_FILE));
        }
        if ($errors !== []) {
            throw new ApiException('Revisa los campos marcados.', 422, $errors);
        }

        $temporaryPath = (string) ($file['tmp_name'] ?? '');
        if ($temporaryPath === '' || !is_uploaded_file($temporaryPath)) {
            throw new ApiException('No se pudo verificar el archivo recibido.', 422, [
                'file' => 'Vuelve a seleccionar el archivo.',
            ]);
        }
        $actualSize = filesize($temporaryPath);
        $actualSize = $actualSize === false ? 0 : (int) $actualSize;
        $fileLimit = min(self::HARD_FILE_LIMIT, max(1, Env::int('UPLOAD_MAX_BYTES', self::HARD_FILE_LIMIT)));
        if ($actualSize < 1 || $actualSize > $fileLimit) {
            throw new ApiException('El archivo no cumple el límite de tamaño.', 413, [
                'file' => 'Debe pesar más de 0 bytes y como máximo 10 MiB.',
            ]);
        }

        $originalName = $this->safeOriginalName((string) ($file['name'] ?? 'archivo'));
        $extension = mb_strtolower((string) pathinfo($originalName, PATHINFO_EXTENSION));
        $this->assertExtensionSafe($originalName, $extension);
        $detector = new finfo(FILEINFO_MIME_TYPE);
        $mime = $detector->file($temporaryPath);
        $mime = is_string($mime) ? mb_strtolower(trim($mime)) : '';
        if (!$this->mimeMatchesExtension($mime, $extension)) {
            throw new ApiException('El formato del archivo no está permitido.', 422, [
                'file' => 'La extensión no coincide con un formato seguro admitido.',
            ]);
        }

        $directory = $this->uploadDirectory();
        $storedName = bin2hex(random_bytes(32));
        $destination = $directory . DIRECTORY_SEPARATOR . $storedName;
        if (!move_uploaded_file($temporaryPath, $destination)) {
            throw new ApiException('No se pudo guardar el archivo.', 500);
        }
        @chmod($destination, 0640);

        try {
            $quota = min(self::HARD_USER_QUOTA, max(1, Env::int('UPLOAD_USER_QUOTA_BYTES', self::HARD_USER_QUOTA)));
            $record = $store->createAttachment($userId, [
                'entity_type' => $entityType,
                'entity_id' => (int) $entityId,
                'original_name' => $originalName,
                'stored_name' => $storedName,
                'mime_type' => $mime,
                'extension' => $extension,
                'size_bytes' => $actualSize,
            ], $quota);
        } catch (\Throwable $exception) {
            @unlink($destination);
            throw $exception;
        }
        return $this->present($record);
    }

    /** @return array<int, array<string, mixed>> */
    public function list(DataStore $store, int $userId, ?string $entityType, ?int $entityId): array
    {
        if ($entityType !== null && !in_array($entityType, self::entityTypes(), true)) {
            throw new ApiException('El tipo de registro no admite archivos.', 422, [
                'entity_type' => 'Elige un tipo permitido.',
            ]);
        }
        if ($entityId !== null && $entityId < 0) {
            throw new ApiException('El ID indicado no es válido.', 400);
        }
        return array_map(fn (array $row): array => $this->present($row), $store->listAttachments($userId, $entityType, $entityId));
    }

    /** @return array<string, mixed> */
    public function delete(DataStore $store, int $id, int $userId): array
    {
        $record = $store->deleteAttachment($id, $userId);
        if ($record === null) {
            throw new ApiException('No encontramos ese archivo.', 404);
        }
        $this->removePhysical($record);
        return $this->present($record);
    }

    public function purgeEntity(DataStore $store, string $entityType, int $entityId, int $userId): void
    {
        foreach ($store->deleteAttachmentsForEntity($entityType, $entityId, $userId) as $record) {
            $this->removePhysical($record);
        }
    }

    public function download(DataStore $store, int $id, int $userId): never
    {
        $record = $store->findAttachment($id, $userId);
        if ($record === null) {
            throw new ApiException('No encontramos ese archivo.', 404);
        }
        $path = $this->uploadDirectory() . DIRECTORY_SEPARATOR . (string) $record['stored_name'];
        if (!is_file($path) || !is_readable($path)) {
            throw new ApiException('El archivo ya no está disponible.', 404);
        }
        $name = $this->safeOriginalName((string) $record['original_name']);
        $fallback = preg_replace('/[^A-Za-z0-9._-]/', '_', $name) ?: 'archivo.' . (string) $record['extension'];
        header_remove('Content-Type');
        header('Content-Type: ' . (string) $record['mime_type']);
        header('Content-Disposition: attachment; filename="' . $fallback . '"; filename*=UTF-8\'\'' . rawurlencode($name));
        header('Content-Length: ' . (string) filesize($path));
        header('Cache-Control: private, no-store, max-age=0');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    public function preview(DataStore $store, int $id, int $userId): never
    {
        $record = $store->findAttachment($id, $userId);
        if ($record === null || !$this->isPreviewableImage((string) ($record['mime_type'] ?? ''))) {
            // Keep ownership and file-type failures indistinguishable.
            throw new ApiException('No encontramos esa imagen.', 404);
        }
        $path = $this->uploadDirectory() . DIRECTORY_SEPARATOR . (string) $record['stored_name'];
        if (!is_file($path) || !is_readable($path)) {
            throw new ApiException('La imagen ya no está disponible.', 404);
        }
        $name = $this->safeOriginalName((string) $record['original_name']);
        $fallback = preg_replace('/[^A-Za-z0-9._-]/', '_', $name) ?: 'imagen.' . (string) $record['extension'];
        header_remove('Content-Type');
        header('Content-Type: ' . (string) $record['mime_type']);
        header('Content-Disposition: inline; filename="' . $fallback . '"; filename*=UTF-8\'\'' . rawurlencode($name));
        header('Content-Length: ' . (string) filesize($path));
        header('Cache-Control: private, no-store, max-age=0');
        header('Content-Security-Policy: default-src \'none\'; sandbox');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    private function uploadDirectory(): string
    {
        $directory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'uploads';
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            throw new ApiException('El almacenamiento de archivos no está disponible.', 503);
        }
        if (!is_writable($directory)) {
            throw new ApiException('El almacenamiento de archivos no tiene permisos de escritura.', 503);
        }
        return $directory;
    }

    private function safeOriginalName(string $name): string
    {
        if (preg_match('/[\r\n\0]/', $name) === 1) {
            throw new ApiException('El nombre del archivo no es válido.', 422, ['file' => 'Cambia el nombre del archivo.']);
        }
        $name = basename(str_replace('\\', '/', trim($name)));
        if ($name === '' || $name === '.' || $name === '..' || mb_strlen($name) > 255) {
            throw new ApiException('El nombre del archivo no es válido.', 422, ['file' => 'Cambia el nombre del archivo.']);
        }
        return $name;
    }

    private function assertExtensionSafe(string $name, string $extension): void
    {
        $blocked = [
            'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar', 'cgi', 'pl', 'py',
            'sh', 'bash', 'exe', 'dll', 'com', 'bat', 'cmd', 'js', 'mjs', 'html', 'htm', 'svg',
            'shtml', 'xhtml', 'htaccess', 'ini',
        ];
        $segments = array_map('mb_strtolower', explode('.', $name));
        if ($extension === '' || in_array($extension, $blocked, true)
            || array_intersect(array_slice($segments, 0, -1), $blocked) !== []) {
            throw new ApiException('La extensión del archivo no está permitida.', 422, [
                'file' => 'No se admiten archivos ejecutables, HTML, SVG ni dobles extensiones peligrosas.',
            ]);
        }
    }

    private function mimeMatchesExtension(string $mime, string $extension): bool
    {
        $allowed = [
            'pdf' => ['application/pdf'],
            'jpg' => ['image/jpeg'], 'jpeg' => ['image/jpeg'],
            'png' => ['image/png'], 'webp' => ['image/webp'], 'gif' => ['image/gif'],
            'txt' => ['text/plain'], 'md' => ['text/plain'],
            'csv' => ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel'],
            'json' => ['application/json', 'text/plain'],
            'zip' => ['application/zip', 'application/x-zip-compressed'],
            'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
            'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
            'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip'],
        ];
        return isset($allowed[$extension]) && in_array($mime, $allowed[$extension], true);
    }

    private function uploadError(int $code): string
    {
        return match ($code) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'El archivo supera el tamaño permitido.',
            UPLOAD_ERR_PARTIAL => 'El archivo llegó incompleto. Inténtalo nuevamente.',
            UPLOAD_ERR_NO_FILE => 'Selecciona un archivo.',
            default => 'No se pudo recibir el archivo.',
        };
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    public function present(array $row): array
    {
        unset($row['stored_name']);
        $row['download_url'] = 'api/index.php/attachments/' . (int) $row['id'] . '/download';
        if ($this->isPreviewableImage((string) ($row['mime_type'] ?? ''))) {
            $row['preview_url'] = 'api/index.php/attachments/' . (int) $row['id'] . '/preview';
        } else {
            unset($row['preview_url']);
        }
        return $row;
    }

    private function isPreviewableImage(string $mime): bool
    {
        return in_array(mb_strtolower(trim($mime)), [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        ], true);
    }

    /** @param array<string, mixed> $record */
    private function removePhysical(array $record): void
    {
        $storedName = (string) ($record['stored_name'] ?? '');
        if (preg_match('/^[a-f0-9]{64}$/', $storedName) !== 1) {
            return;
        }
        $path = $this->uploadDirectory() . DIRECTORY_SEPARATOR . $storedName;
        if (is_file($path)) {
            @unlink($path);
        }
    }
}
