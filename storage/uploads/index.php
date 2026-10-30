<?php

declare(strict_types=1);

// Los adjuntos sólo se entregan mediante la descarga autenticada de la API.
http_response_code(404);
header_remove('X-Powered-By');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
exit;
