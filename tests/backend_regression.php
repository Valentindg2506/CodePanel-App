<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    header('Cache-Control: no-store');
    exit;
}

use CodePanel\ApiException;
use CodePanel\Auth;
use CodePanel\DatabaseStore;
use CodePanel\DemoStore;
use CodePanel\EntityCatalog;
use CodePanel\Env;
use CodePanel\PublicFeedbackService;
use CodePanel\SettingsCatalog;

require dirname(__DIR__) . '/app/bootstrap.php';

/** @param mixed $actual */
function check(bool $condition, string $message, mixed $actual = null): void
{
    if ($condition) {
        return;
    }
    $detail = $actual === null ? '' : ' · ' . json_encode($actual, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    throw new RuntimeException($message . $detail);
}

/** @return PDO */
function connectServer(string $host, int $port, string $user, string $password, ?string $database = null): PDO
{
    $dsn = "mysql:host={$host};port={$port};charset=utf8mb4";
    if ($database !== null) {
        $dsn .= ';dbname=' . $database;
    }
    return new PDO($dsn, $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
}

function runSqlFile(string $path, string $host, int $port, string $user, string $password, string $database): void
{
    $previousPassword = getenv('MYSQL_PWD');
    putenv('MYSQL_PWD=' . $password);
    $process = proc_open([
        'mysql', '--default-character-set=utf8mb4', '--host=' . $host, '--port=' . (string) $port,
        '--user=' . $user, $database,
    ], [
        0 => ['file', $path, 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ], $pipes, dirname(__DIR__));
    if (!is_resource($process)) {
        throw new RuntimeException('No se pudo iniciar el cliente MySQL para la prueba.');
    }
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $status = proc_close($process);
    if ($previousPassword === false) {
        putenv('MYSQL_PWD');
    } else {
        putenv('MYSQL_PWD=' . $previousPassword);
    }
    check($status === 0, 'Falló un archivo SQL de prueba.', [
        'file' => basename($path), 'stdout' => trim((string) $stdout), 'stderr' => trim((string) $stderr),
    ]);
}

/** @param callable(int): array<string, mixed> $worker @return array<int, array<string, mixed>> */
function runConcurrent(int $workers, callable $worker): array
{
    check(function_exists('pcntl_fork'), 'La prueba concurrente requiere pcntl.');
    $children = [];
    for ($index = 0; $index < $workers; $index++) {
        $pair = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, 0);
        check(is_array($pair), 'No se pudo crear el canal de sincronización.');
        $pid = pcntl_fork();
        check($pid !== -1, 'No se pudo iniciar un proceso de prueba.');
        if ($pid === 0) {
            fclose($pair[0]);
            fread($pair[1], 1);
            try {
                $result = $worker($index);
            } catch (ApiException $exception) {
                $result = ['ok' => false, 'status' => $exception->status, 'message' => $exception->getMessage()];
            } catch (Throwable $exception) {
                $result = ['ok' => false, 'status' => 500, 'message' => $exception::class . ': ' . $exception->getMessage()];
            }
            fwrite($pair[1], json_encode($result, JSON_THROW_ON_ERROR) . "\n");
            fclose($pair[1]);
            exit(0);
        }
        fclose($pair[1]);
        $children[] = ['pid' => $pid, 'socket' => $pair[0]];
    }
    foreach ($children as $child) {
        fwrite($child['socket'], '1');
    }
    $results = [];
    foreach ($children as $child) {
        $payload = stream_get_contents($child['socket']);
        fclose($child['socket']);
        pcntl_waitpid($child['pid'], $status);
        check(pcntl_wifexited($status) && pcntl_wexitstatus($status) === 0, 'Un proceso concurrente no terminó correctamente.');
        $decoded = json_decode(trim((string) $payload), true);
        check(is_array($decoded), 'Un proceso concurrente devolvió una respuesta inválida.', $payload);
        $results[] = $decoded;
    }
    return $results;
}

/** @param array<string, mixed> $row */
function insertRow(PDO $pdo, string $table, array $row): void
{
    $columns = array_keys($row);
    $placeholders = array_map(static fn (string $column): string => ':' . $column, $columns);
    $statement = $pdo->prepare(
        "INSERT INTO `{$table}` (`" . implode('`, `', $columns) . '`) VALUES (' . implode(', ', $placeholders) . ')',
    );
    $params = [];
    foreach ($row as $key => $value) {
        $params[':' . $key] = is_array($value)
            ? json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)
            : $value;
    }
    $statement->execute($params);
}

$host = getenv('CODEPANEL_TEST_DB_HOST') ?: (Env::get('DB_HOST', '127.0.0.1') ?? '127.0.0.1');
$port = (int) (getenv('CODEPANEL_TEST_DB_PORT') ?: Env::int('DB_PORT', 3306));
$user = getenv('CODEPANEL_TEST_DB_USER') ?: (Env::get('DB_USER', 'root') ?? 'root');
$password = getenv('CODEPANEL_TEST_DB_PASS');
$password = $password === false ? (Env::get('DB_PASS', '') ?? '') : $password;
$database = 'codepanel_backend_' . getmypid() . '_' . bin2hex(random_bytes(3));
$root = dirname(__DIR__);

$server = connectServer($host, $port, $user, $password);
$server->exec("CREATE DATABASE `{$database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$server = null;

try {
    runSqlFile($root . '/database/schema.sql', $host, $port, $user, $password, $database);
    runSqlFile($root . '/database/migrations/2026-07-27_add_productivity_modules.sql', $host, $port, $user, $password, $database);
    runSqlFile($root . '/database/migrations/2026-07-27_add_productivity_modules.sql', $host, $port, $user, $password, $database);
    runSqlFile($root . '/database/migrations/2026-08-03_add_project_pinning.sql', $host, $port, $user, $password, $database);
    runSqlFile($root . '/database/migrations/2026-08-03_add_project_pinning.sql', $host, $port, $user, $password, $database);
    runSqlFile($root . '/database/migrations/2026-08-04_add_project_public_feedback.sql', $host, $port, $user, $password, $database);
    runSqlFile($root . '/database/migrations/2026-08-04_add_project_public_feedback.sql', $host, $port, $user, $password, $database);
    runSqlFile($root . '/database/migrations/2026-10-23_add_login_attempts.sql', $host, $port, $user, $password, $database);
    runSqlFile($root . '/database/migrations/2026-10-23_add_login_attempts.sql', $host, $port, $user, $password, $database);

    $newConnection = static fn (): PDO => connectServer($host, $port, $user, $password, $database);
    $pdo = $newConnection();
    $tables = (int) $pdo->query(
        'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()',
    )->fetchColumn();
    check($tables === 22, 'El esquema final debe contener 22 tablas.', $tables);
    check((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0,
        'El esquema no debe crear usuarios: el de ejemplo está en database/seed-demo.sql.');
    $authWithEmptyBase = new Auth($pdo, false);
    check($authWithEmptyBase->registrationEnabled(), 'Con la base vacía debe poder crearse la primera cuenta.');
    insertRow($pdo, 'users', ['id' => 1, 'name' => 'QA', 'email' => 'qa@example.test', 'password_hash' => password_hash('Qa123456', PASSWORD_DEFAULT)]);
    check(!$authWithEmptyBase->registrationEnabled(), 'Con cuentas creadas, el registro debe quedar cerrado por defecto.');
    foreach (EntityCatalog::all() as $entity => $spec) {
        $columns = array_column($pdo->query('SHOW COLUMNS FROM `' . $spec['table'] . '`')->fetchAll(), 'Field');
        foreach (array_keys($spec['fields']) as $field) {
            check(in_array($field, $columns, true), "Falta {$spec['table']}.{$field} para {$entity}.");
        }
    }
    foreach (['attention', 'weekly_summary', 'project-shares', 'public-feedback'] as $shim) {
        $path = $root . '/api/' . $shim . '.php';
        check(is_file($path) && str_contains((string) file_get_contents($path), "CODEPANEL_ROUTE'] = '{$shim}"),
            "Falta el shim de API {$shim}.");
    }

    $previousRegistration = getenv('ALLOW_REGISTRATION');
    putenv('ALLOW_REGISTRATION=false');
    $auth = new Auth(null, true);
    check(!$auth->registrationEnabled(), 'ALLOW_REGISTRATION=false no fue respetado.');
    try {
        $auth->register(['name' => 'Blocked', 'email' => 'blocked@example.test', 'password' => 'Blocked123']);
        check(false, 'El registro desactivado debía devolver 403.');
    } catch (ApiException $exception) {
        check($exception->status === 403, 'El registro desactivado devolvió un estado inesperado.', $exception->status);
    } finally {
        if ($previousRegistration === false) {
            putenv('ALLOW_REGISTRATION');
        } else {
            putenv('ALLOW_REGISTRATION=' . $previousRegistration);
        }
    }

    $store = new DatabaseStore($pdo);
    $phpProject = $store->create('projects', 1, [
        'client_id' => null, 'name' => 'Pinned PHP project', 'description' => 'qa-project-search',
        'project_type' => 'personal', 'status' => 'active', 'priority' => 'high', 'progress' => 35,
        'due_date' => null, 'tech_stack' => ['PHP', 'MySQL'], 'repository_url' => null,
        'live_url' => null, 'color' => '#df704f', 'pinned' => true, 'tags' => ['qa-project-search'],
    ]);
    $phpUnitProject = $store->create('projects', 1, [
        'client_id' => null, 'name' => 'PHPUnit project', 'description' => null,
        'project_type' => 'personal', 'status' => 'planned', 'priority' => 'medium', 'progress' => 0,
        'due_date' => null, 'tech_stack' => ['PHPUnit'], 'repository_url' => null,
        'live_url' => null, 'color' => '#7867E6', 'pinned' => false, 'tags' => [],
    ]);
    $projectRows = $store->list('projects', 1, ['limit' => 200]);
    check((int) ($projectRows[0]['id'] ?? 0) === (int) $phpProject['id'],
        'Los proyectos fijados deben aparecer primero.', $projectRows);
    check(array_column($store->list('projects', 1, ['tech' => 'php']), 'id') === [(int) $phpProject['id']],
        'El filtro tech debe ser exacto y no distinguir mayúsculas.');
    check(array_column($store->list('projects', 1, ['tech' => 'phpunit']), 'id') === [(int) $phpUnitProject['id']],
        'El filtro tech confundió PHP con PHPUnit.');
    check(array_column($store->list('projects', 1, ['pinned' => false]), 'id') === [(int) $phpUnitProject['id']],
        'El filtro pinned=false no fue respetado.');
    check(array_column($store->list('projects', 1, ['search' => 'qa-project-search']), 'id') === [(int) $phpProject['id']],
        'La búsqueda de proyectos no incluyó sus etiquetas.');

    $_SERVER['SCRIPT_NAME'] = '/CodePanel/api/index.php';
    $feedbackService = new PublicFeedbackService($pdo);
    $share = $feedbackService->enable((int) $phpProject['id'], 1);
    check(($share['enabled'] ?? false) === true && is_string($share['public_path'] ?? null),
        'No se pudo activar el enlace público.', $share);
    $fragment = parse_url((string) $share['public_path'], PHP_URL_FRAGMENT);
    parse_str(is_string($fragment) ? $fragment : '', $fragmentValues);
    $firstToken = (string) ($fragmentValues['token'] ?? '');
    check((bool) preg_match('/^[a-f0-9]{64}$/D', $firstToken), 'El token público no es criptográficamente opaco.');
    $publicProject = $feedbackService->publicProject($firstToken);
    check(($publicProject['project']['name'] ?? null) === $phpProject['name']
        && !array_key_exists('user_id', $publicProject['project'] ?? []),
        'La vista pública expuso datos incorrectos o privados.', $publicProject);

    $_SERVER['CONTENT_TYPE'] = 'multipart/form-data; boundary=codepanel-test';
    $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    $_POST = [
        'type' => 'bug', 'author_name' => 'QA Client', 'author_email' => 'client@example.test',
        'message' => 'El botón principal no responde al primer intento.',
    ];
    $_FILES = [];
    $submission = $feedbackService->submit($firstToken);
    check(($submission['status'] ?? null) === 'new' && ($submission['image_count'] ?? null) === 0,
        'No se pudo registrar feedback público sin imágenes.', $submission);
    $feedback = $feedbackService->listFeedback((int) $phpProject['id'], 1);
    check(count($feedback['items']) === 1 && ($feedback['items'][0]['type'] ?? null) === 'bug'
        && ($feedback['summary']['new'] ?? null) === 1,
        'El dueño no recibió el feedback público.', $feedback);
    $feedbackId = (int) $feedback['items'][0]['id'];
    $reviewing = $feedbackService->updateStatus((int) $phpProject['id'], $feedbackId, 1, 'in_review');
    check(($reviewing['status'] ?? null) === 'in_review', 'No se pudo cambiar el estado del feedback.', $reviewing);

    $feedbackService->disable((int) $phpProject['id'], 1);
    try {
        $feedbackService->publicProject($firstToken);
        check(false, 'Un enlace desactivado continuó disponible.');
    } catch (ApiException $exception) {
        check($exception->status === 404, 'El enlace desactivado devolvió un estado inesperado.', $exception->status);
    }
    $renewed = $feedbackService->regenerate((int) $phpProject['id'], 1);
    $renewedFragment = parse_url((string) $renewed['public_path'], PHP_URL_FRAGMENT);
    parse_str(is_string($renewedFragment) ? $renewedFragment : '', $renewedValues);
    $renewedToken = (string) ($renewedValues['token'] ?? '');
    check($renewedToken !== $firstToken && (bool) preg_match('/^[a-f0-9]{64}$/D', $renewedToken),
        'Regenerar no reemplazó el token público.');
    try {
        $feedbackService->publicProject($firstToken);
        check(false, 'El token reemplazado continuó disponible.');
    } catch (ApiException $exception) {
        check($exception->status === 404, 'El token reemplazado devolvió un estado inesperado.', $exception->status);
    }
    unset($_SERVER['CONTENT_TYPE'], $_SERVER['REMOTE_ADDR']);
    $_POST = [];
    $_FILES = [];

    $projectTask = $store->create('tasks', 1, [
        'project_id' => (int) $phpProject['id'], 'title' => 'Overview task', 'description' => null,
        'status' => 'todo', 'priority' => 'medium', 'assignee' => null, 'due_date' => null,
        'completed_at' => null, 'tags' => [],
    ]);
    $projectLog = $store->create('devlogs', 1, [
        'project_id' => (int) $phpProject['id'], 'entry_date' => '2026-08-03', 'title' => 'Overview log',
        'content' => 'Timeline detail', 'entry_type' => 'progress', 'minutes_spent' => 15, 'tags' => [],
    ]);
    insertRow($pdo, 'attachments', [
        'user_id' => 1, 'entity_type' => 'projects', 'entity_id' => (int) $phpProject['id'],
        'original_name' => 'overview.png', 'stored_name' => str_repeat('a', 64), 'mime_type' => 'image/png',
        'extension' => 'png', 'size_bytes' => 12,
    ]);
    $overview = $store->projectOverview((int) $phpProject['id'], 1);
    check(is_array($overview)
        && in_array((int) $projectTask['id'], array_column($overview['tasks'], 'id'), true)
        && in_array((int) $projectLog['id'], array_column($overview['timeline'], 'id'), true),
        'El overview no reunió las relaciones del proyecto.', $overview);
    check(!array_key_exists('stored_name', $overview['attachments'][0] ?? [])
        && !array_key_exists('user_id', $overview['attachments'][0] ?? []),
        'El store expuso campos privados de un adjunto.', $overview['attachments'] ?? []);
    check($store->projectOverview((int) $phpProject['id'], 9999) === null,
        'El overview debe ocultar proyectos de otro usuario.');

    $budget = $store->create('budgets', 1, [
        'client_id' => null, 'project_id' => null, 'title' => 'Rollback', 'status' => 'approved',
        'currency' => 'ARS', 'amount' => 100.0, 'valid_until' => null, 'notes' => null, 'tags' => [],
    ]);
    $payment = $store->create('payments', 1, [
        'budget_id' => $budget['id'], 'amount' => 30.0, 'paid_at' => date('Y-m-d'),
        'method' => 'transfer', 'reference' => null, 'notes' => null,
    ]);
    try {
        $store->create('payments', 1, [
            'budget_id' => $budget['id'], 'amount' => 80.0, 'paid_at' => date('Y-m-d'),
            'method' => 'cash', 'reference' => null, 'notes' => null,
        ]);
        check(false, 'Un cobro por encima del saldo debía rechazarse.');
    } catch (ApiException $exception) {
        check($exception->status === 422 && !$pdo->inTransaction(), 'El rechazo de create debe hacer rollback.', $exception->status);
    }
    check((float) $pdo->query('SELECT SUM(amount) FROM payments WHERE budget_id = ' . (int) $budget['id'])->fetchColumn() === 30.0,
        'El create rechazado alteró el total.');
    $payment = $store->update('payments', (int) $payment['id'], 1, ['amount' => 80.0]);
    check((float) ($payment['amount'] ?? 0) === 80.0, 'No se pudo actualizar un cobro válido.');
    try {
        $store->update('payments', (int) $payment['id'], 1, ['amount' => 110.0]);
        check(false, 'Un update por encima del saldo debía rechazarse.');
    } catch (ApiException $exception) {
        check($exception->status === 422 && !$pdo->inTransaction(), 'El rechazo de update debe hacer rollback.', $exception->status);
    }
    check((float) $store->find('payments', (int) $payment['id'], 1)['amount'] === 80.0,
        'El update rechazado cambió el cobro.');
    try {
        $store->update('budgets', (int) $budget['id'], 1, ['amount' => 70.0]);
        check(false, 'No se debe reducir un presupuesto por debajo de lo cobrado.');
    } catch (ApiException $exception) {
        check($exception->status === 422 && !$pdo->inTransaction(), 'El presupuesto inválido debe hacer rollback.');
    }
    try {
        $store->update('budgets', (int) $budget['id'], 1, ['currency' => 'USD']);
        check(false, 'No se debe cambiar la moneda de un presupuesto cobrado.');
    } catch (ApiException $exception) {
        check($exception->status === 422 && !$pdo->inTransaction(), 'La moneda inválida debe hacer rollback.');
    }

    $pdo->exec("CREATE TRIGGER test_block_payment_delete BEFORE DELETE ON payments FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced rollback'");
    try {
        $store->delete('payments', (int) $payment['id'], 1);
        check(false, 'El trigger de prueba debía forzar el rollback del delete.');
    } catch (PDOException) {
        check(!$pdo->inTransaction(), 'El delete fallido dejó una transacción abierta.');
    }
    check($store->find('payments', (int) $payment['id'], 1) !== null, 'El delete fallido no se revirtió.');
    $pdo->exec('DROP TRIGGER test_block_payment_delete');
    check($store->delete('payments', (int) $payment['id'], 1), 'No se pudo eliminar el cobro tras liberar el rollback.');
    check(!$store->delete('payments', (int) $payment['id'], 1), 'Un segundo delete debe indicar que el cobro ya no existe.');
    $store->delete('budgets', (int) $budget['id'], 1);
    $store = null;
    $pdo = null;

    $makeBudget = static function (string $title, float $amount) use ($newConnection): int {
        $pdo = $newConnection();
        $store = new DatabaseStore($pdo);
        $row = $store->create('budgets', 1, [
            'client_id' => null, 'project_id' => null, 'title' => $title, 'status' => 'approved',
            'currency' => 'ARS', 'amount' => $amount, 'valid_until' => null, 'notes' => null, 'tags' => [],
        ]);
        return (int) $row['id'];
    };
    $paymentData = static fn (int $budgetId, float $amount): array => [
        'budget_id' => $budgetId, 'amount' => $amount, 'paid_at' => date('Y-m-d'),
        'method' => 'transfer', 'reference' => null, 'notes' => null,
    ];

    $concurrentBudget = $makeBudget('Concurrent create', 100.0);
    $results = runConcurrent(2, static function () use ($newConnection, $paymentData, $concurrentBudget): array {
        $pdo = $newConnection();
        $row = (new DatabaseStore($pdo))->create('payments', 1, $paymentData($concurrentBudget, 60.0));
        return ['ok' => true, 'id' => $row['id']];
    });
    check(count(array_filter($results, static fn (array $row): bool => ($row['ok'] ?? false) === true)) === 1,
        'Dos creates concurrentes no deben sobrepasar el presupuesto.', $results);
    check(count(array_filter($results, static fn (array $row): bool => ($row['status'] ?? null) === 422)) === 1,
        'El create concurrente perdedor debe devolver 422.', $results);
    $pdo = $newConnection();
    check((float) $pdo->query("SELECT SUM(amount) FROM payments WHERE budget_id = {$concurrentBudget}")->fetchColumn() === 60.0,
        'El total concurrente de create no es consistente.');
    $pdo = null;

    $updateBudget = $makeBudget('Concurrent update', 100.0);
    $pdo = $newConnection();
    $store = new DatabaseStore($pdo);
    $first = $store->create('payments', 1, $paymentData($updateBudget, 20.0));
    $second = $store->create('payments', 1, $paymentData($updateBudget, 20.0));
    $firstId = (int) $first['id'];
    $secondId = (int) $second['id'];
    $store = null;
    $pdo = null;
    $results = runConcurrent(2, static function (int $index) use ($newConnection, $firstId, $secondId): array {
        $pdo = $newConnection();
        $id = $index === 0 ? $firstId : $secondId;
        $row = (new DatabaseStore($pdo))->update('payments', $id, 1, ['amount' => 80.0]);
        return ['ok' => true, 'id' => $row['id'] ?? null];
    });
    check(count(array_filter($results, static fn (array $row): bool => ($row['ok'] ?? false) === true)) === 1,
        'Dos updates concurrentes no deben sobrepasar el presupuesto.', $results);
    check(count(array_filter($results, static fn (array $row): bool => ($row['status'] ?? null) === 422)) === 1,
        'El update concurrente perdedor debe devolver 422.', $results);
    $pdo = $newConnection();
    check((float) $pdo->query("SELECT SUM(amount) FROM payments WHERE budget_id = {$updateBudget}")->fetchColumn() === 100.0,
        'El total concurrente de update no es consistente.');
    $pdo = null;

    $deleteBudget = $makeBudget('Concurrent delete', 100.0);
    $pdo = $newConnection();
    $store = new DatabaseStore($pdo);
    $deleting = $store->create('payments', 1, $paymentData($deleteBudget, 60.0));
    $growing = $store->create('payments', 1, $paymentData($deleteBudget, 40.0));
    $deletingId = (int) $deleting['id'];
    $growingId = (int) $growing['id'];
    $store = null;
    $pdo = null;
    $results = runConcurrent(2, static function (int $index) use ($newConnection, $deletingId, $growingId): array {
        $pdo = $newConnection();
        $store = new DatabaseStore($pdo);
        if ($index === 0) {
            return ['ok' => $store->delete('payments', $deletingId, 1), 'action' => 'delete'];
        }
        $row = $store->update('payments', $growingId, 1, ['amount' => 100.0]);
        return ['ok' => true, 'action' => 'update', 'amount' => $row['amount'] ?? null];
    });
    check(count(array_filter($results, static fn (array $row): bool => ($row['action'] ?? null) === 'delete' && ($row['ok'] ?? false))) === 1,
        'El delete concurrente debe completarse.', $results);
    $pdo = $newConnection();
    $total = (float) $pdo->query("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE budget_id = {$deleteBudget}")->fetchColumn();
    check($total <= 100.0 && !((bool) $pdo->query("SELECT COUNT(*) FROM payments WHERE id = {$deletingId}")->fetchColumn()),
        'Delete/update concurrentes rompieron la invariante.', ['total' => $total, 'results' => $results]);

    $timezone = new DateTimeZone('Pacific/Kiritimati');
    $today = new DateTimeImmutable('today', $timezone);
    $todayDate = $today->format('Y-m-d');
    $tomorrow = $today->modify('+1 day')->format('Y-m-d');
    $future = $today->modify('+6 days')->format('Y-m-d');
    $weekOffset = ((int) $today->format('N') - 1 + 7) % 7;
    $weekFrom = $today->modify("-{$weekOffset} days");
    $weekTo = $weekFrom->modify('+6 days');
    $completedAt = $weekFrom->setTime(12, 0)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    $createdAt = '2026-08-01 12:00:00';
    $userId = 2;
    insertRow($pdo, 'users', [
        'id' => $userId, 'name' => 'Parity', 'email' => 'parity@example.test',
        'password_hash' => password_hash('test', PASSWORD_DEFAULT), 'created_at' => $createdAt, 'updated_at' => $createdAt,
    ]);
    $settings = [
        'user_id' => $userId, ...SettingsCatalog::defaults(), 'timezone' => 'Pacific/Kiritimati',
        'week_start' => 'monday', 'reminder_days' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
    ];
    insertRow($pdo, 'user_settings', $settings);

    $collections = [
        'projects' => [[
            'id' => 2001, 'user_id' => $userId, 'client_id' => 2101, 'name' => 'Parity Project',
            'description' => null, 'project_type' => 'commercial', 'status' => 'active', 'priority' => 'medium',
            'progress' => 20, 'due_date' => null, 'tech_stack' => [], 'repository_url' => null, 'live_url' => null,
            'color' => '#7867E6', 'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]],
        'clients' => [[
            'id' => 2101, 'user_id' => $userId, 'name' => 'Parity Client', 'company' => null, 'email' => null,
            'phone' => null, 'website' => null, 'status' => 'active', 'source' => null, 'notes' => null,
            'last_contact' => null, 'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]],
        'tasks' => [
            [
                'id' => 2201, 'user_id' => $userId, 'project_id' => 2001, 'title' => 'Due task',
                'description' => 'Task detail', 'status' => 'todo', 'priority' => 'high', 'assignee' => null,
                'due_date' => $todayDate, 'completed_at' => null, 'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
            ],
            [
                'id' => 2202, 'user_id' => $userId, 'project_id' => 2001, 'title' => 'Completed task',
                'description' => null, 'status' => 'done', 'priority' => 'low', 'assignee' => null,
                'due_date' => $tomorrow, 'completed_at' => $completedAt, 'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
            ],
        ],
        'leads' => [[
            'id' => 2301, 'user_id' => $userId, 'name' => 'Parity Lead', 'company' => null, 'email' => null,
            'phone' => null, 'status' => 'new', 'value' => 0, 'source' => null, 'next_follow_up' => $todayDate,
            'notes' => null, 'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]],
        'budgets' => [[
            'id' => 2401, 'user_id' => $userId, 'client_id' => 2101, 'project_id' => 2001, 'title' => 'Parity Budget',
            'status' => 'sent', 'currency' => 'ARS', 'amount' => 100, 'valid_until' => $todayDate,
            'notes' => 'Internal notes', 'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]],
        'payments' => [[
            'id' => 2501, 'user_id' => $userId, 'budget_id' => 2401, 'amount' => 25, 'paid_at' => $weekFrom->format('Y-m-d'),
            'method' => 'transfer', 'reference' => null, 'notes' => null, 'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]],
        'releases' => [[
            'id' => 2601, 'user_id' => $userId, 'project_id' => 2001, 'title' => 'Parity Release', 'version' => '1.0',
            'kind' => 'version', 'environment' => 'production', 'status' => 'ready', 'release_date' => $todayDate,
            'url' => null, 'notes' => 'Release notes', 'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]],
        'resources' => [
            [
                'id' => 2701, 'user_id' => $userId, 'project_id' => 2001, 'name' => 'No date attention',
                'resource_type' => 'service', 'provider' => null, 'url' => null, 'environment' => 'production',
                'status' => 'attention', 'renewal_date' => null, 'cost' => 0, 'currency' => 'ARS', 'billing_cycle' => 'none',
                'notes' => null, 'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
            ],
            [
                'id' => 2702, 'user_id' => $userId, 'project_id' => 2001, 'name' => 'Future attention',
                'resource_type' => 'service', 'provider' => null, 'url' => null, 'environment' => 'production',
                'status' => 'attention', 'renewal_date' => $future, 'cost' => 0, 'currency' => 'ARS', 'billing_cycle' => 'none',
                'notes' => null, 'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
            ],
            [
                'id' => 2703, 'user_id' => $userId, 'project_id' => null, 'name' => 'Due resource',
                'resource_type' => 'service', 'provider' => null, 'url' => null, 'environment' => 'shared',
                'status' => 'active', 'renewal_date' => $todayDate, 'cost' => 0, 'currency' => 'ARS', 'billing_cycle' => 'none',
                'notes' => null, 'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
            ],
        ],
        'reminders' => [[
            'id' => 2801, 'user_id' => $userId, 'project_id' => 2001, 'title' => 'Manual reminder',
            'due_at' => $today->modify('+1 day')->setTime(12, 0)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
            'status' => 'pending', 'priority' => 'medium', 'notes' => null, 'tags' => [],
            'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]],
        'time_entries' => [[
            'id' => 2901, 'user_id' => $userId, 'project_id' => 2001, 'task_id' => null,
            'work_date' => $weekFrom->format('Y-m-d'), 'description' => 'Parity time', 'duration_minutes' => 90,
            'started_at' => null, 'ended_at' => null, 'billable' => true, 'hourly_cost' => 10,
            'cost_currency' => 'ARS', 'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]],
        'devlogs' => [[
            'id' => 3001, 'user_id' => $userId, 'project_id' => 2001, 'entry_date' => $weekFrom->format('Y-m-d'),
            'title' => 'Parity log', 'content' => null, 'entry_type' => 'progress', 'minutes_spent' => 10,
            'tags' => [], 'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]],
        'ideas' => [], 'weekly_reviews' => [], 'attachments' => [], 'tags' => [],
        'user_settings' => [$settings],
    ];
    foreach (['clients', 'projects', 'tasks', 'leads', 'budgets', 'payments', 'releases', 'resources', 'reminders', 'time_entries'] as $entity) {
        foreach ($collections[$entity] as $row) {
            insertRow($pdo, $entity, $row);
        }
    }
    foreach ($collections['devlogs'] as $row) {
        insertRow($pdo, 'dev_logs', $row);
    }
    $_SESSION['codepanel_demo_data'] = $collections;
    $demo = new DemoStore();
    $databaseStore = new DatabaseStore($pdo);
    $databaseAttention = $databaseStore->attention($userId);
    $demoAttention = $demo->attention($userId);
    check($databaseAttention === $demoAttention, 'attention perdió paridad DatabaseStore/DemoStore.', [
        'database' => $databaseAttention, 'demo' => $demoAttention,
    ]);
    check(!in_array('derived-resource-2702', array_column($databaseAttention, 'id'), true),
        'reminder_days=[] no debe incluir una renovación futura.');
    $databaseWeekly = $databaseStore->weeklySummary($userId, $weekFrom->format('Y-m-d'), $weekTo->format('Y-m-d'));
    $demoWeekly = $demo->weeklySummary($userId, $weekFrom->format('Y-m-d'), $weekTo->format('Y-m-d'));
    check($databaseWeekly === $demoWeekly, 'weekly_summary perdió paridad DatabaseStore/DemoStore.', [
        'database' => $databaseWeekly, 'demo' => $demoWeekly,
    ]);

    echo "OK backend: esquema/catálogo/migraciones idempotentes, feedback público, registro configurable, transacciones y concurrencia de cobros, attention y weekly_summary.\n";
} finally {
    $server = connectServer($host, $port, $user, $password);
    $server->exec("DROP DATABASE IF EXISTS `{$database}`");
}
