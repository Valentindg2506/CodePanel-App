<?php

declare(strict_types=1);

$_SERVER['CODEPANEL_ROUTE'] = 'attachments' . ($_SERVER['PATH_INFO'] ?? '');
require __DIR__ . '/index.php';
