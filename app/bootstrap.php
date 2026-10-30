<?php

declare(strict_types=1);

use CodePanel\Env;

spl_autoload_register(static function (string $class): void {
    $prefix = 'CodePanel\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }

    $relative = str_replace('\\', DIRECTORY_SEPARATOR, substr($class, strlen($prefix)));
    $file = __DIR__ . DIRECTORY_SEPARATOR . $relative . '.php';
    if (is_file($file)) {
        require $file;
    }
});

$projectRoot = dirname(__DIR__);
$secureEnvironment = $projectRoot . '/.env.php';
Env::load(is_file($secureEnvironment) ? $secureEnvironment : $projectRoot . '/.env');

date_default_timezone_set(Env::get('APP_TIMEZONE', 'America/Argentina/Buenos_Aires') ?? 'America/Argentina/Buenos_Aires');

$explicitRoute = $_SERVER['CODEPANEL_ROUTE'] ?? $_GET['route'] ?? null;
$requestPath = parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
$statelessPublicRequest = (is_string($explicitRoute) && str_starts_with(trim($explicitRoute, '/'), 'public-feedback'))
    || (is_string($requestPath) && preg_match('~/api/index\.php/public-feedback(?:/|$)~', $requestPath) === 1);

if (!$statelessPublicRequest && session_status() !== PHP_SESSION_ACTIVE) {
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Lax');

    $secure = Env::get('SESSION_SECURE', 'auto');
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $secureCookie = $secure === 'auto' ? $isHttps : filter_var($secure, FILTER_VALIDATE_BOOL);

    session_name(Env::get('SESSION_NAME', 'codepanel_session') ?? 'codepanel_session');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'domain' => '',
        'secure' => $secureCookie,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}
