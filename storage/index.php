<?php

declare(strict_types=1);

// Evita que un servidor que ignore .htaccess enumere el almacenamiento.
http_response_code(404);
header_remove('X-Powered-By');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
exit;
