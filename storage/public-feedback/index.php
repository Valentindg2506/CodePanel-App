<?php

declare(strict_types=1);

// Las capturas de feedback sólo se entregan tras comprobar la sesión del dueño.
http_response_code(404);
header_remove('X-Powered-By');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
exit;
