<?php

declare(strict_types=1);

$action = is_string($_GET['action'] ?? null) ? $_GET['action'] : 'me';
$_SERVER['CODEPANEL_ROUTE'] = 'auth/' . trim($action, '/');
require __DIR__ . '/index.php';
