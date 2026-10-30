<?php

declare(strict_types=1);

$_SERVER['CODEPANEL_ROUTE'] = 'devlogs' . ($_SERVER['PATH_INFO'] ?? '');
require __DIR__ . '/index.php';
