<?php

declare(strict_types=1);

namespace CodePanel;

interface DataStore
{
    /** Máximo de filas por listado: la interfaz pide colecciones completas para filtrar y buscar en local. */
    public const LIST_LIMIT = 1000;

    /** @param array<string, mixed> $filters @return array<int, array<string, mixed>> */
    public function list(string $entity, int $userId, array $filters = []): array;

    /** @return array<string, mixed>|null */
    public function find(string $entity, int $id, int $userId): ?array;

    /**
     * @return array{
     *   project: array<string, mixed>,
     *   tasks: array<int, array<string, mixed>>,
     *   timeline: array<int, array<string, mixed>>,
     *   releases: array<int, array<string, mixed>>,
     *   resources: array<int, array<string, mixed>>,
     *   budgets: array<int, array<string, mixed>>,
     *   attachments: array<int, array<string, mixed>>
     * }|null
     */
    public function projectOverview(int $projectId, int $userId): ?array;

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function create(string $entity, int $userId, array $data): array;

    /** @param array<string, mixed> $data @return array<string, mixed>|null */
    public function update(string $entity, int $id, int $userId, array $data): ?array;

    public function delete(string $entity, int $id, int $userId): bool;

    public function foreignExists(string $entity, int $id, int $userId): bool;

    /** @return array<string, mixed> */
    public function dashboard(int $userId): array;

    /** @return array<string, mixed> */
    public function getSettings(int $userId): array;

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function updateSettings(int $userId, array $data): array;

    /** @return array<string, mixed>|null */
    public function runningTimeEntry(int $userId, ?int $excludeId = null): ?array;

    public function tagSlugExists(string $slug, int $userId, ?int $excludeId = null): bool;

    /** @return array<int, array<string, mixed>> */
    public function calendar(int $userId, string $from, string $to): array;

    /** @return array<string, mixed> */
    public function profitability(int $userId): array;

    /** @return array<int, array<string, mixed>> */
    public function attention(int $userId): array;

    /** @return array<string, mixed> */
    public function weeklySummary(int $userId, string $from, string $to): array;

    /** @return array<int, array<string, mixed>> */
    public function listAttachments(int $userId, ?string $entityType = null, ?int $entityId = null): array;

    /** @return array<string, mixed>|null */
    public function findAttachment(int $id, int $userId): ?array;

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function createAttachment(int $userId, array $data, int $quotaBytes): array;

    /** @return array<string, mixed>|null */
    public function deleteAttachment(int $id, int $userId): ?array;

    /** @return array<int, array<string, mixed>> Deleted metadata, including stored_name. */
    public function deleteAttachmentsForEntity(string $entityType, int $entityId, int $userId): array;

    /** @return array<int, array{entity_type: string, entity_id: int}> */
    public function dependentAttachmentTargets(string $entityType, int $entityId, int $userId): array;
}
