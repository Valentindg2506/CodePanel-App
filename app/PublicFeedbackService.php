<?php

declare(strict_types=1);

namespace CodePanel;

use finfo;
use PDO;
use PDOException;

final class PublicFeedbackService
{
    private const TOKEN_PATTERN = '/^[a-f0-9]{64}$/D';
    private const TYPES = ['comment', 'bug', 'error'];
    private const STATUSES = ['new', 'in_review', 'resolved', 'closed'];
    private const MAX_IMAGES = 4;
    private const MAX_IMAGE_BYTES = 5_242_880;
    private const MAX_REQUEST_IMAGE_BYTES = 12_582_912;
    private const HARD_USER_QUOTA = 104_857_600;
    private const RATE_PER_REQUESTER = 8;
    private const RATE_PER_LINK = 60;

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @return array<string, mixed> */
    public function sharingConfig(int $projectId, int $userId): array
    {
        $project = $this->ownedProject($projectId, $userId);
        $statement = $this->pdo->prepare(
            'SELECT token, is_active, created_at, updated_at
             FROM project_public_links
             WHERE project_id = :project_id AND user_id = :user_id
             LIMIT 1',
        );
        $statement->execute([':project_id' => $projectId, ':user_id' => $userId]);
        $link = $statement->fetch();

        return $this->presentConfig($project, is_array($link) ? $link : null);
    }

    /** @return array<string, mixed> */
    public function enable(int $projectId, int $userId): array
    {
        $this->pdo->beginTransaction();
        try {
            $project = $this->lockOwnedProject($projectId, $userId);
            $select = $this->pdo->prepare(
                'SELECT id, token FROM project_public_links
                 WHERE project_id = :project_id AND user_id = :user_id
                 LIMIT 1 FOR UPDATE',
            );
            $select->execute([':project_id' => $projectId, ':user_id' => $userId]);
            $link = $select->fetch();
            if (is_array($link)) {
                $update = $this->pdo->prepare(
                    'UPDATE project_public_links SET is_active = 1
                     WHERE id = :id AND user_id = :user_id',
                );
                $update->execute([':id' => $link['id'], ':user_id' => $userId]);
            } else {
                $token = $this->uniqueToken();
                $insert = $this->pdo->prepare(
                    'INSERT INTO project_public_links (user_id, project_id, token, is_active)
                     VALUES (:user_id, :project_id, :token, 1)',
                );
                $insert->execute([
                    ':user_id' => $userId,
                    ':project_id' => $projectId,
                    ':token' => $token,
                ]);
            }
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            $this->rollBack();
            throw $exception;
        }

        return $this->sharingConfig($projectId, $userId);
    }

    /** @return array<string, mixed> */
    public function disable(int $projectId, int $userId): array
    {
        $this->ownedProject($projectId, $userId);
        $statement = $this->pdo->prepare(
            'UPDATE project_public_links SET is_active = 0
             WHERE project_id = :project_id AND user_id = :user_id',
        );
        $statement->execute([':project_id' => $projectId, ':user_id' => $userId]);
        return $this->sharingConfig($projectId, $userId);
    }

    /** @return array<string, mixed> */
    public function regenerate(int $projectId, int $userId): array
    {
        $this->pdo->beginTransaction();
        try {
            $this->lockOwnedProject($projectId, $userId);
            $select = $this->pdo->prepare(
                'SELECT id FROM project_public_links
                 WHERE project_id = :project_id AND user_id = :user_id
                 LIMIT 1 FOR UPDATE',
            );
            $select->execute([':project_id' => $projectId, ':user_id' => $userId]);
            $linkId = $select->fetchColumn();
            $token = $this->uniqueToken();
            if ($linkId === false) {
                $statement = $this->pdo->prepare(
                    'INSERT INTO project_public_links (user_id, project_id, token, is_active)
                     VALUES (:user_id, :project_id, :token, 1)',
                );
                $statement->execute([
                    ':user_id' => $userId,
                    ':project_id' => $projectId,
                    ':token' => $token,
                ]);
            } else {
                $statement = $this->pdo->prepare(
                    'UPDATE project_public_links SET token = :token, is_active = 1
                     WHERE id = :id AND user_id = :user_id',
                );
                $statement->execute([':token' => $token, ':id' => $linkId, ':user_id' => $userId]);
            }
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            $this->rollBack();
            throw $exception;
        }

        return $this->sharingConfig($projectId, $userId);
    }

    /** @return array<string, mixed> */
    public function publicProject(string $token): array
    {
        $link = $this->activeLink($token);
        return [
            'project' => [
                'name' => (string) $link['project_name'],
                'description' => $this->nullableString($link['project_description'] ?? null),
                'status' => (string) $link['project_status'],
                'progress' => (int) $link['project_progress'],
            ],
            'options' => [
                'types' => self::TYPES,
                'max_images' => self::MAX_IMAGES,
                'max_image_bytes' => self::MAX_IMAGE_BYTES,
            ],
        ];
    }

    /** @return array<string, mixed> */
    public function submit(string $token): array
    {
        $link = $this->activeLink($token);
        $input = $this->publicInput();
        $validated = $this->validatePublicInput($input);
        $images = $this->validateImages();
        $incomingBytes = array_sum(array_column($images, 'size_bytes'));
        $requesterHash = $this->requesterHash($token);
        $storedFiles = [];

        $this->pdo->beginTransaction();
        try {
            $userLock = $this->pdo->prepare('SELECT id FROM users WHERE id = :user_id LIMIT 1 FOR UPDATE');
            $userLock->execute([':user_id' => $link['user_id']]);
            if ($userLock->fetchColumn() === false) {
                throw new ApiException('El enlace público ya no está disponible.', 404);
            }

            $lockedLink = $this->activeLink($token, true);
            $this->assertRateLimit((int) $lockedLink['id'], $requesterHash);
            $this->assertStorageQuota((int) $lockedLink['user_id'], $incomingBytes);

            $reference = bin2hex(random_bytes(16));
            $statement = $this->pdo->prepare(
                'INSERT INTO project_feedback
                    (public_link_id, user_id, project_id, public_id, type, status, author_name, author_email, message)
                 VALUES
                    (:public_link_id, :user_id, :project_id, :public_id, :type, \'new\', :author_name, :author_email, :message)',
            );
            $statement->execute([
                ':public_link_id' => $lockedLink['id'],
                ':user_id' => $lockedLink['user_id'],
                ':project_id' => $lockedLink['project_id'],
                ':public_id' => $reference,
                ':type' => $validated['type'],
                ':author_name' => $validated['author_name'],
                ':author_email' => $validated['author_email'],
                ':message' => $validated['message'],
            ]);
            $feedbackId = (int) $this->pdo->lastInsertId();

            $directory = $this->uploadDirectory();
            foreach ($images as $image) {
                $storedName = bin2hex(random_bytes(32));
                $destination = $directory . DIRECTORY_SEPARATOR . $storedName;
                if (!move_uploaded_file((string) $image['tmp_name'], $destination)) {
                    throw new ApiException('No se pudo guardar una de las imágenes.', 500);
                }
                @chmod($destination, 0640);
                $storedFiles[] = $destination;

                $insertImage = $this->pdo->prepare(
                    'INSERT INTO project_feedback_images
                        (feedback_id, user_id, project_id, original_name, stored_name, mime_type, extension,
                         size_bytes, width, height)
                     VALUES
                        (:feedback_id, :user_id, :project_id, :original_name, :stored_name, :mime_type, :extension,
                         :size_bytes, :width, :height)',
                );
                $insertImage->execute([
                    ':feedback_id' => $feedbackId,
                    ':user_id' => $lockedLink['user_id'],
                    ':project_id' => $lockedLink['project_id'],
                    ':original_name' => $image['original_name'],
                    ':stored_name' => $storedName,
                    ':mime_type' => $image['mime_type'],
                    ':extension' => $image['extension'],
                    ':size_bytes' => $image['size_bytes'],
                    ':width' => $image['width'],
                    ':height' => $image['height'],
                ]);
            }

            $this->pdo->commit();
        } catch (\Throwable $exception) {
            $this->rollBack();
            foreach ($storedFiles as $path) {
                if (is_file($path)) {
                    @unlink($path);
                }
            }
            throw $exception;
        }

        return [
            'reference' => $reference,
            'type' => $validated['type'],
            'status' => 'new',
            'created_at' => gmdate('Y-m-d H:i:s'),
            'image_count' => count($images),
        ];
    }

    /** @return array{items: array<int, array<string, mixed>>, summary: array<string, int>} */
    public function listFeedback(int $projectId, int $userId, array $filters = []): array
    {
        $this->ownedProject($projectId, $userId);
        $where = ['f.project_id = :project_id', 'f.user_id = :user_id'];
        $params = [':project_id' => $projectId, ':user_id' => $userId];
        foreach (['status' => self::STATUSES, 'type' => self::TYPES] as $field => $allowed) {
            $value = is_scalar($filters[$field] ?? null) ? trim((string) $filters[$field]) : '';
            if ($value !== '' && in_array($value, $allowed, true)) {
                $where[] = "f.{$field} = :{$field}";
                $params[":{$field}"] = $value;
            }
        }
        $limit = filter_var($filters['limit'] ?? 100, FILTER_VALIDATE_INT);
        $limit = $limit === false ? 100 : max(1, min(200, (int) $limit));
        $statement = $this->pdo->prepare(
            'SELECT f.* FROM project_feedback f WHERE ' . implode(' AND ', $where)
            . ' ORDER BY FIELD(f.status, \'new\', \'in_review\', \'resolved\', \'closed\'), f.created_at DESC, f.id DESC'
            . ' LIMIT :limit',
        );
        foreach ($params as $name => $value) {
            $statement->bindValue($name, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll();
        $images = $this->imagesForFeedbackRows($rows, $projectId, $userId);
        $items = [];
        foreach ($rows as $row) {
            $id = (int) $row['id'];
            $items[] = $this->presentFeedback($row, $images[$id] ?? []);
        }
        return ['items' => $items, 'summary' => $this->feedbackSummary($projectId, $userId)];
    }

    /** @return array<string, mixed> */
    public function updateStatus(int $projectId, int $feedbackId, int $userId, mixed $rawStatus): array
    {
        $status = is_scalar($rawStatus) ? trim((string) $rawStatus) : '';
        if (!in_array($status, self::STATUSES, true)) {
            throw new ApiException('Revisa los campos marcados.', 422, [
                'status' => 'El estado debe ser new, in_review, resolved o closed.',
            ]);
        }
        $statement = $this->pdo->prepare(
            'UPDATE project_feedback SET status = :status
             WHERE id = :id AND project_id = :project_id AND user_id = :user_id',
        );
        $statement->execute([
            ':status' => $status,
            ':id' => $feedbackId,
            ':project_id' => $projectId,
            ':user_id' => $userId,
        ]);
        if ($statement->rowCount() === 0) {
            $exists = $this->findOwnedFeedback($projectId, $feedbackId, $userId);
            if ($exists === null) {
                throw new ApiException('No encontramos ese reporte.', 404);
            }
        }
        return $this->findPresentedFeedback($projectId, $feedbackId, $userId);
    }

    /** @return array<string, mixed> */
    public function deleteFeedback(int $projectId, int $feedbackId, int $userId): array
    {
        $this->pdo->beginTransaction();
        try {
            $feedback = $this->findOwnedFeedback($projectId, $feedbackId, $userId, true);
            if ($feedback === null) {
                throw new ApiException('No encontramos ese reporte.', 404);
            }
            $images = $this->pdo->prepare(
                'SELECT stored_name FROM project_feedback_images
                 WHERE feedback_id = :feedback_id AND project_id = :project_id AND user_id = :user_id',
            );
            $images->execute([
                ':feedback_id' => $feedbackId,
                ':project_id' => $projectId,
                ':user_id' => $userId,
            ]);
            $storedNames = $images->fetchAll(PDO::FETCH_COLUMN);
            $delete = $this->pdo->prepare(
                'DELETE FROM project_feedback
                 WHERE id = :id AND project_id = :project_id AND user_id = :user_id',
            );
            $delete->execute([':id' => $feedbackId, ':project_id' => $projectId, ':user_id' => $userId]);
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            $this->rollBack();
            throw $exception;
        }
        $this->removeStoredFiles($storedNames);
        return ['id' => $feedbackId, 'reference' => (string) $feedback['public_id']];
    }

    public function previewOwnerImage(int $projectId, int $imageId, int $userId): never
    {
        $statement = $this->pdo->prepare(
            'SELECT i.* FROM project_feedback_images i
             INNER JOIN project_feedback f ON f.id = i.feedback_id
             WHERE i.id = :id AND i.project_id = :project_id AND i.user_id = :user_id
               AND f.project_id = i.project_id AND f.user_id = i.user_id
             LIMIT 1',
        );
        $statement->execute([':id' => $imageId, ':project_id' => $projectId, ':user_id' => $userId]);
        $image = $statement->fetch();
        if (!is_array($image)) {
            throw new ApiException('No encontramos esa imagen.', 404);
        }
        $path = $this->uploadDirectory() . DIRECTORY_SEPARATOR . (string) $image['stored_name'];
        if (!is_file($path) || !is_readable($path)) {
            throw new ApiException('La imagen ya no está disponible.', 404);
        }
        header_remove('Content-Type');
        header('Content-Type: ' . (string) $image['mime_type']);
        header('Content-Length: ' . (string) filesize($path));
        header('Content-Disposition: inline; filename="feedback.' . (string) $image['extension'] . '"');
        header('Cache-Control: private, no-store, max-age=0');
        header('Content-Security-Policy: default-src \'none\'; sandbox');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    /** @return array<int, string> */
    public function projectStoredFiles(int $projectId, int $userId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT stored_name FROM project_feedback_images
             WHERE project_id = :project_id AND user_id = :user_id',
        );
        $statement->execute([':project_id' => $projectId, ':user_id' => $userId]);
        return array_values(array_filter(
            $statement->fetchAll(PDO::FETCH_COLUMN),
            static fn (mixed $name): bool => is_string($name),
        ));
    }

    /** @param array<int, string> $storedNames */
    public function removeStoredFiles(array $storedNames): void
    {
        if ($storedNames === []) {
            return;
        }
        $directory = $this->uploadDirectory();
        foreach ($storedNames as $storedName) {
            if (preg_match('/^[a-f0-9]{64}$/D', $storedName) !== 1) {
                continue;
            }
            $path = $directory . DIRECTORY_SEPARATOR . $storedName;
            if (is_file($path)) {
                @unlink($path);
            }
        }
    }

    /** @return array<string, mixed> */
    private function presentConfig(array $project, ?array $link): array
    {
        $enabled = $link !== null && (bool) $link['is_active'];
        return [
            'project_id' => (int) $project['id'],
            'enabled' => $enabled,
            'public_path' => $enabled
                ? $this->basePath() . '/share.php#token=' . rawurlencode((string) $link['token'])
                : null,
            'created_at' => $link['created_at'] ?? null,
            'updated_at' => $link['updated_at'] ?? null,
            'feedback' => $this->feedbackSummary((int) $project['id'], (int) $project['user_id']),
        ];
    }

    /** @return array<string, int> */
    private function feedbackSummary(int $projectId, int $userId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT status, COUNT(*) AS amount FROM project_feedback
             WHERE project_id = :project_id AND user_id = :user_id GROUP BY status',
        );
        $statement->execute([':project_id' => $projectId, ':user_id' => $userId]);
        $summary = ['total' => 0, 'new' => 0, 'in_review' => 0, 'resolved' => 0, 'closed' => 0];
        foreach ($statement->fetchAll() as $row) {
            $status = (string) $row['status'];
            if (array_key_exists($status, $summary)) {
                $summary[$status] = (int) $row['amount'];
                $summary['total'] += (int) $row['amount'];
            }
        }
        return $summary;
    }

    /** @return array<string, mixed> */
    private function ownedProject(int $projectId, int $userId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, user_id FROM projects WHERE id = :id AND user_id = :user_id LIMIT 1',
        );
        $statement->execute([':id' => $projectId, ':user_id' => $userId]);
        $project = $statement->fetch();
        if (!is_array($project)) {
            throw new ApiException('No encontramos ese proyecto.', 404);
        }
        return $project;
    }

    /** @return array<string, mixed> */
    private function lockOwnedProject(int $projectId, int $userId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, user_id FROM projects
             WHERE id = :id AND user_id = :user_id LIMIT 1 FOR UPDATE',
        );
        $statement->execute([':id' => $projectId, ':user_id' => $userId]);
        $project = $statement->fetch();
        if (!is_array($project)) {
            throw new ApiException('No encontramos ese proyecto.', 404);
        }
        return $project;
    }

    /** @return array<string, mixed> */
    private function activeLink(string $token, bool $forUpdate = false): array
    {
        $token = mb_strtolower(trim($token));
        if (preg_match(self::TOKEN_PATTERN, $token) !== 1) {
            throw new ApiException('El enlace público no existe o ya no está disponible.', 404);
        }
        $statement = $this->pdo->prepare(
            'SELECT l.id, l.user_id, l.project_id, p.name AS project_name,
                    p.description AS project_description, p.status AS project_status,
                    p.progress AS project_progress
             FROM project_public_links l
             INNER JOIN projects p ON p.id = l.project_id AND p.user_id = l.user_id
             WHERE l.token = :token AND l.is_active = 1
             LIMIT 1' . ($forUpdate ? ' FOR UPDATE' : ''),
        );
        $statement->execute([':token' => $token]);
        $link = $statement->fetch();
        if (!is_array($link)) {
            throw new ApiException('El enlace público no existe o ya no está disponible.', 404);
        }
        return $link;
    }

    private function uniqueToken(): string
    {
        for ($attempt = 0; $attempt < 4; $attempt++) {
            $token = bin2hex(random_bytes(32));
            $statement = $this->pdo->prepare('SELECT 1 FROM project_public_links WHERE token = :token LIMIT 1');
            $statement->execute([':token' => $token]);
            if ($statement->fetchColumn() === false) {
                return $token;
            }
        }
        throw new ApiException('No se pudo crear un enlace seguro. Inténtalo nuevamente.', 500);
    }

    /** @return array<string, mixed> */
    private function publicInput(): array
    {
        $contentType = mb_strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
        if (str_starts_with($contentType, 'multipart/form-data')) {
            /** @var array<string, mixed> $post */
            $post = $_POST;
            return $post;
        }
        return Http::body();
    }

    /** @param array<string, mixed> $input @return array{type: string, author_name: string, author_email: ?string, message: string} */
    private function validatePublicInput(array $input): array
    {
        if (trim((string) ($input['website'] ?? '')) !== '') {
            throw new ApiException('No se pudo enviar el reporte.', 422);
        }
        $type = trim((string) ($input['type'] ?? ''));
        $authorName = trim((string) ($input['author_name'] ?? ''));
        $authorEmail = mb_strtolower(trim((string) ($input['author_email'] ?? '')));
        $message = trim((string) ($input['message'] ?? ''));
        $errors = [];
        if (!in_array($type, self::TYPES, true)) {
            $errors['type'] = 'Elige comentario, bug o error.';
        }
        if (mb_strlen($authorName) < 2 || mb_strlen($authorName) > 100) {
            $errors['author_name'] = 'El nombre debe tener entre 2 y 100 caracteres.';
        }
        if ($authorEmail !== '' && (!filter_var($authorEmail, FILTER_VALIDATE_EMAIL) || mb_strlen($authorEmail) > 190)) {
            $errors['author_email'] = 'Ingresa un email válido o deja el campo vacío.';
        }
        if (mb_strlen($message) < 10 || mb_strlen($message) > 5000) {
            $errors['message'] = 'El detalle debe tener entre 10 y 5000 caracteres.';
        }
        if ($errors !== []) {
            throw new ApiException('Revisa los campos marcados.', 422, $errors);
        }
        return [
            'type' => $type,
            'author_name' => $authorName,
            'author_email' => $authorEmail === '' ? null : $authorEmail,
            'message' => $message,
        ];
    }

    /** @return array<int, array<string, mixed>> */
    private function validateImages(): array
    {
        // Un campo de archivo sin selección llega como UPLOAD_ERR_NO_FILE: no es una imagen, se ignora.
        $files = array_values(array_filter(
            $this->normalizeImages($_FILES['images'] ?? null),
            static fn (array $file): bool => (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE,
        ));
        if (count($files) > self::MAX_IMAGES) {
            throw new ApiException('Solo puedes adjuntar hasta cuatro imágenes.', 422, [
                'images' => 'Quita algunas imágenes antes de enviar.',
            ]);
        }
        $detector = new finfo(FILEINFO_MIME_TYPE);
        $allowed = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
        ];
        $validated = [];
        $total = 0;
        foreach ($files as $file) {
            $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
            if ($error !== UPLOAD_ERR_OK) {
                throw new ApiException('No se pudo recibir una de las imágenes.', 422, [
                    'images' => $this->uploadError($error),
                ]);
            }
            $temporaryPath = (string) ($file['tmp_name'] ?? '');
            if ($temporaryPath === '' || !is_uploaded_file($temporaryPath)) {
                throw new ApiException('No se pudo verificar una de las imágenes.', 422, [
                    'images' => 'Vuelve a seleccionar los archivos.',
                ]);
            }
            $size = filesize($temporaryPath);
            $size = $size === false ? 0 : (int) $size;
            if ($size < 1 || $size > self::MAX_IMAGE_BYTES) {
                throw new ApiException('Una imagen supera el límite permitido.', 413, [
                    'images' => 'Cada imagen debe pesar como máximo 5 MiB.',
                ]);
            }
            $total += $size;
            if ($total > self::MAX_REQUEST_IMAGE_BYTES) {
                throw new ApiException('Las imágenes superan el límite total permitido.', 413, [
                    'images' => 'El total de imágenes debe pesar como máximo 12 MiB.',
                ]);
            }
            $mime = $detector->file($temporaryPath);
            $mime = is_string($mime) ? mb_strtolower(trim($mime)) : '';
            if (!isset($allowed[$mime])) {
                throw new ApiException('El formato de una imagen no está permitido.', 422, [
                    'images' => 'Usa imágenes JPG, PNG o WebP.',
                ]);
            }
            $dimensions = @getimagesize($temporaryPath);
            $width = is_array($dimensions) ? (int) ($dimensions[0] ?? 0) : 0;
            $height = is_array($dimensions) ? (int) ($dimensions[1] ?? 0) : 0;
            if ($width < 1 || $height < 1 || $width > 10000 || $height > 10000 || $width * $height > 40_000_000) {
                throw new ApiException('No se pudo validar una de las imágenes.', 422, [
                    'images' => 'La imagen es inválida o tiene dimensiones excesivas.',
                ]);
            }
            $originalName = $this->safeOriginalName((string) ($file['name'] ?? 'imagen'));
            $clientExtension = mb_strtolower((string) pathinfo($originalName, PATHINFO_EXTENSION));
            $validExtensions = $mime === 'image/jpeg' ? ['jpg', 'jpeg'] : [$allowed[$mime]];
            if (!in_array($clientExtension, $validExtensions, true)) {
                throw new ApiException('La extensión no coincide con el contenido de una imagen.', 422, [
                    'images' => 'Revisa el formato de los archivos seleccionados.',
                ]);
            }
            $validated[] = [
                'tmp_name' => $temporaryPath,
                'original_name' => $originalName,
                'mime_type' => $mime,
                'extension' => $allowed[$mime],
                'size_bytes' => $size,
                'width' => $width,
                'height' => $height,
            ];
        }
        return $validated;
    }

    /** @return array<int, array<string, mixed>> */
    private function normalizeImages(mixed $raw): array
    {
        if (!is_array($raw) || !isset($raw['name'])) {
            return [];
        }
        if (!is_array($raw['name'])) {
            return [[
                'name' => $raw['name'] ?? '',
                'type' => $raw['type'] ?? '',
                'tmp_name' => $raw['tmp_name'] ?? '',
                'error' => $raw['error'] ?? UPLOAD_ERR_NO_FILE,
                'size' => $raw['size'] ?? 0,
            ]];
        }
        $files = [];
        foreach (array_keys($raw['name']) as $index) {
            $files[] = [
                'name' => $raw['name'][$index] ?? '',
                'type' => $raw['type'][$index] ?? '',
                'tmp_name' => $raw['tmp_name'][$index] ?? '',
                'error' => $raw['error'][$index] ?? UPLOAD_ERR_NO_FILE,
                'size' => $raw['size'][$index] ?? 0,
            ];
        }
        return $files;
    }

    private function assertRateLimit(int $linkId, string $requesterHash): void
    {
        $bucket = gmdate('Y-m-d H:00:00');
        $globalHash = str_repeat('0', 64);
        $statement = $this->pdo->prepare(
            'INSERT INTO project_feedback_rate_limits (public_link_id, requester_hash, window_start, attempts)
             VALUES (:public_link_id, :requester_hash, :window_start, 1)
             ON DUPLICATE KEY UPDATE attempts = attempts + 1',
        );
        $select = $this->pdo->prepare(
            'SELECT attempts FROM project_feedback_rate_limits
             WHERE public_link_id = :public_link_id AND requester_hash = :requester_hash
               AND window_start = :window_start LIMIT 1',
        );
        foreach ([[$requesterHash, self::RATE_PER_REQUESTER], [$globalHash, self::RATE_PER_LINK]] as [$hash, $limit]) {
            $params = [':public_link_id' => $linkId, ':requester_hash' => $hash, ':window_start' => $bucket];
            $statement->execute($params);
            $select->execute($params);
            if ((int) $select->fetchColumn() > $limit) {
                throw new ApiException('Se alcanzó el límite temporal de reportes. Inténtalo más tarde.', 429, [
                    'rate_limit' => 'Espera antes de enviar otro reporte.',
                ]);
            }
        }
        if (random_int(1, 50) === 1) {
            $this->pdo->exec(
                'DELETE FROM project_feedback_rate_limits
                 WHERE window_start < UTC_TIMESTAMP() - INTERVAL 2 DAY LIMIT 200',
            );
        }
    }

    private function assertStorageQuota(int $userId, int $incomingBytes): void
    {
        $quota = min(
            self::HARD_USER_QUOTA,
            max(1, Env::int('UPLOAD_USER_QUOTA_BYTES', self::HARD_USER_QUOTA)),
        );
        $statement = $this->pdo->prepare(
            'SELECT
                (SELECT COALESCE(SUM(size_bytes), 0) FROM attachments WHERE user_id = :attachments_user)
                +
                (SELECT COALESCE(SUM(size_bytes), 0) FROM project_feedback_images WHERE user_id = :feedback_user)
                AS used_bytes',
        );
        $statement->execute([':attachments_user' => $userId, ':feedback_user' => $userId]);
        if ((int) $statement->fetchColumn() + $incomingBytes > $quota) {
            throw new ApiException('El espacio disponible para imágenes está completo.', 413, [
                'images' => 'El responsable del proyecto debe liberar espacio antes de recibir más imágenes.',
            ]);
        }
    }

    /** @param array<int, array<string, mixed>> $rows @return array<int, array<int, array<string, mixed>>> */
    private function imagesForFeedbackRows(array $rows, int $projectId, int $userId): array
    {
        $ids = array_values(array_filter(array_map(
            static fn (array $row): int => (int) ($row['id'] ?? 0),
            $rows,
        )));
        if ($ids === []) {
            return [];
        }
        $placeholders = implode(', ', array_fill(0, count($ids), '?'));
        $statement = $this->pdo->prepare(
            "SELECT id, feedback_id, original_name, mime_type, extension, size_bytes, width, height, created_at
             FROM project_feedback_images
             WHERE project_id = ? AND user_id = ? AND feedback_id IN ({$placeholders})
             ORDER BY id ASC",
        );
        $statement->execute(array_merge([$projectId, $userId], $ids));
        $grouped = [];
        foreach ($statement->fetchAll() as $row) {
            $row['id'] = (int) $row['id'];
            $row['feedback_id'] = (int) $row['feedback_id'];
            $row['size_bytes'] = (int) $row['size_bytes'];
            $row['width'] = (int) $row['width'];
            $row['height'] = (int) $row['height'];
            $row['preview_url'] = $this->basePath() . '/api/index.php/project-shares/' . $projectId
                . '/feedback-images/' . $row['id'];
            $grouped[$row['feedback_id']][] = $row;
        }
        return $grouped;
    }

    /** @param array<string, mixed> $row @param array<int, array<string, mixed>> $images @return array<string, mixed> */
    private function presentFeedback(array $row, array $images): array
    {
        return [
            'id' => (int) $row['id'],
            'reference' => (string) $row['public_id'],
            'type' => (string) $row['type'],
            'status' => (string) $row['status'],
            'author_name' => (string) $row['author_name'],
            'author_email' => $this->nullableString($row['author_email'] ?? null),
            'message' => (string) $row['message'],
            'created_at' => (string) $row['created_at'],
            'updated_at' => (string) $row['updated_at'],
            'images' => $images,
        ];
    }

    /** @return array<string, mixed>|null */
    private function findOwnedFeedback(int $projectId, int $feedbackId, int $userId, bool $forUpdate = false): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT * FROM project_feedback
             WHERE id = :id AND project_id = :project_id AND user_id = :user_id
             LIMIT 1' . ($forUpdate ? ' FOR UPDATE' : ''),
        );
        $statement->execute([':id' => $feedbackId, ':project_id' => $projectId, ':user_id' => $userId]);
        $row = $statement->fetch();
        return is_array($row) ? $row : null;
    }

    /** @return array<string, mixed> */
    private function findPresentedFeedback(int $projectId, int $feedbackId, int $userId): array
    {
        $row = $this->findOwnedFeedback($projectId, $feedbackId, $userId);
        if ($row === null) {
            throw new ApiException('No encontramos ese reporte.', 404);
        }
        $images = $this->imagesForFeedbackRows([$row], $projectId, $userId);
        return $this->presentFeedback($row, $images[$feedbackId] ?? []);
    }

    private function requesterHash(string $token): string
    {
        $address = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (filter_var($address, FILTER_VALIDATE_IP) === false) {
            $address = 'unknown';
        }
        return hash_hmac('sha256', $address, $token);
    }

    private function uploadDirectory(): string
    {
        $directory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'public-feedback';
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            throw new ApiException('El almacenamiento de imágenes no está disponible.', 503);
        }
        if (!is_writable($directory)) {
            throw new ApiException('El almacenamiento de imágenes no tiene permisos de escritura.', 503);
        }
        return $directory;
    }

    private function safeOriginalName(string $name): string
    {
        if (preg_match('/[\r\n\0]/', $name) === 1) {
            throw new ApiException('El nombre de una imagen no es válido.', 422, ['images' => 'Cambia el nombre del archivo.']);
        }
        $name = basename(str_replace('\\', '/', trim($name)));
        if ($name === '' || $name === '.' || $name === '..' || mb_strlen($name) > 255) {
            throw new ApiException('El nombre de una imagen no es válido.', 422, ['images' => 'Cambia el nombre del archivo.']);
        }
        return $name;
    }

    private function uploadError(int $code): string
    {
        return match ($code) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'Una imagen supera el tamaño permitido por el servidor.',
            UPLOAD_ERR_PARTIAL => 'Una imagen llegó incompleta.',
            UPLOAD_ERR_NO_FILE => 'No se recibió una de las imágenes.',
            default => 'No se pudo recibir una de las imágenes.',
        };
    }

    private function nullableString(mixed $value): ?string
    {
        return $value === null || $value === '' ? null : (string) $value;
    }

    private function basePath(): string
    {
        $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? ''));
        $marker = strpos($script, '/api/');
        if ($marker !== false) {
            return rtrim(substr($script, 0, $marker), '/');
        }
        return rtrim(str_replace('\\', '/', dirname($script)), '/.');
    }

    private function rollBack(): void
    {
        if ($this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
    }
}
