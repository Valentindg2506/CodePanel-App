#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
readonly API_PREFIX="${SMOKE_API_PREFIX:-/api/index.php}"
readonly TIMEOUT_SECONDS="${SMOKE_TIMEOUT:-15}"
readonly COOKIE_JAR="$(mktemp "${SCRIPT_DIR}/.smoke-cookie.XXXXXX")"

HTTP_STATUS=''
HTTP_BODY=''
CSRF_TOKEN=''
HEALTH_DEMO_MODE='false'
checks=0

cleanup() {
    rm -f -- "${COOKIE_JAR}"
}
trap cleanup EXIT INT TERM

fail() {
    printf '[FALLO] %s\n' "$1" >&2
    if [[ -n "${HTTP_STATUS}" ]]; then
        printf '        HTTP %s\n' "${HTTP_STATUS}" >&2
    fi
    exit 1
}

pass() {
    checks=$((checks + 1))
    printf '[OK] %s\n' "$1"
}

request() {
    local method="$1"
    local path="$2"
    local payload="${3:-}"
    local raw
    local url="${BASE_URL%/}/${path#/}"
    local args=(
        --silent
        --show-error
        --connect-timeout "${TIMEOUT_SECONDS}"
        --max-time "${TIMEOUT_SECONDS}"
        --request "${method}"
        --header 'Accept: application/json'
        --cookie "${COOKIE_JAR}"
        --cookie-jar "${COOKIE_JAR}"
        --write-out $'\n%{http_code}'
    )
    if [[ -n "${CSRF_TOKEN}" ]]; then
        args+=(--header "X-CSRF-Token: ${CSRF_TOKEN}")
    fi

    if [[ -n "${payload}" ]]; then
        args+=(--header 'Content-Type: application/json' --data-binary '@-')
        if ! raw="$(printf '%s' "${payload}" | curl "${args[@]}" "${url}")"; then
            fail "No se pudo conectar con ${url}"
        fi
    else
        if ! raw="$(curl "${args[@]}" "${url}")"; then
            fail "No se pudo conectar con ${url}"
        fi
    fi

    HTTP_STATUS="${raw##*$'\n'}"
    HTTP_BODY="${raw%$'\n'*}"
}

expect_status() {
    local label="$1"
    shift
    local expected

    for expected in "$@"; do
        if [[ "${HTTP_STATUS}" == "${expected}" ]]; then
            pass "${label} (HTTP ${HTTP_STATUS})"
            return 0
        fi
    done

    fail "${label}: se esperaba HTTP $*, se recibió ${HTTP_STATUS}"
}

expect_json() {
    local label="$1"

    if ! php -r '
        $body = stream_get_contents(STDIN);
        json_decode($body, true);
        exit(json_last_error() === JSON_ERROR_NONE ? 0 : 1);
    ' <<<"${HTTP_BODY}"; then
        fail "${label}: la respuesta no es JSON válido"
    fi
}

expect_success_envelope() {
    local label="$1"

    if ! php -r '
        $payload = json_decode(stream_get_contents(STDIN), true);
        $valid = is_array($payload)
            && ($payload["success"] ?? null) === true
            && array_key_exists("data", $payload);
        exit($valid ? 0 : 1);
    ' <<<"${HTTP_BODY}"; then
        fail "${label}: la API no devolvió un envelope exitoso"
    fi
}

expect_authenticated_session() {
    if ! php -r '
        $payload = json_decode(stream_get_contents(STDIN), true);
        exit(($payload["data"]["authenticated"] ?? null) === true ? 0 : 1);
    ' <<<"${HTTP_BODY}"; then
        fail 'La sesión no quedó autenticada después del login'
    fi
    pass 'La sesión identifica al usuario autenticado'
}

expect_list_envelope() {
    local label="$1"

    if ! php -r '
        $payload = json_decode(stream_get_contents(STDIN), true);
        $data = $payload["data"] ?? null;
        exit(is_array($data) && array_is_list($data) ? 0 : 1);
    ' <<<"${HTTP_BODY}"; then
        fail "${label}: data no es un listado JSON"
    fi
}

expect_object_data_envelope() {
    local label="$1"

    if ! php -r '
        $payload = json_decode(stream_get_contents(STDIN));
        $valid = is_object($payload)
            && ($payload->success ?? null) === true
            && property_exists($payload, "data")
            && is_object($payload->data);
        exit($valid ? 0 : 1);
    ' <<<"${HTTP_BODY}"; then
        fail "${label}: data no es un objeto JSON"
    fi
}

expect_health_envelope() {
    if ! php -r '
        $data = json_decode(stream_get_contents(STDIN), true);
        $valid = is_array($data)
            && ($data["success"] ?? null) === true
            && isset($data["data"])
            && is_array($data["data"])
            && in_array(($data["data"]["status"] ?? null), ["ok", "degraded"], true)
            && is_string($data["data"]["database"] ?? null)
            && is_bool($data["data"]["demo_mode"] ?? null);
        exit($valid ? 0 : 1);
    ' <<<"${HTTP_BODY}"; then
        fail 'Health: el JSON no contiene el envelope esperado'
    fi
    pass 'Health devuelve estado, PHP, base de datos y modo demo'
}

make_login_payload() {
    printf '%s\0%s' "$1" "$2" | php -r '
        $values = explode("\0", stream_get_contents(STDIN), 2);
        echo json_encode([
            "email" => $values[0] ?? "",
            "password" => $values[1] ?? "",
        ], JSON_UNESCAPED_SLASHES);
    '
}

if ! command -v curl >/dev/null 2>&1; then
    fail 'El smoke test requiere curl'
fi

if ! command -v php >/dev/null 2>&1; then
    fail 'El smoke test requiere PHP CLI para validar JSON'
fi

case "${TIMEOUT_SECONDS}" in
    ''|*[!0-9]*) fail 'SMOKE_TIMEOUT debe ser un número entero positivo' ;;
    0) fail 'SMOKE_TIMEOUT debe ser mayor que cero' ;;
esac

printf 'CodePanel · smoke test\n'
printf 'Destino: %s\n\n' "${BASE_URL%/}"

request GET '/'
expect_status 'Interfaz principal disponible' 200
if [[ -z "${HTTP_BODY//[[:space:]]/}" ]]; then
    fail 'La interfaz principal respondió sin contenido'
fi

request GET "${API_PREFIX}/health"
expect_status 'API health disponible' 200
expect_json 'Health'
expect_health_envelope
HEALTH_DEMO_MODE="$(php -r '
    $payload = json_decode(stream_get_contents(STDIN), true);
    echo ($payload["data"]["demo_mode"] ?? false) === true ? "true" : "false";
' <<<"${HTTP_BODY}")"

request GET "${API_PREFIX}/auth/me"
expect_status 'Estado de sesión accesible' 200 401 403
expect_json 'Estado de sesión'
if [[ "${HTTP_STATUS}" == '200' ]]; then
    expect_success_envelope 'Estado de sesión'
fi

if [[ "${SMOKE_CHECK_PROTECTED_FILES:-0}" == '1' ]]; then
    request GET '/.env'
    expect_status 'El archivo .env no es público' 403 404

    request GET '/.env.php'
    if [[ "${HTTP_STATUS}" == '200' && -z "${HTTP_BODY//[[:space:]]/}" ]]; then
        pass 'El archivo .env.php se ejecuta sin exponer contenido'
    else
        expect_status 'El archivo .env.php está protegido' 403 404
    fi

    request GET '/database/schema.sql'
    expect_status 'El esquema SQL no es público' 403 404

    request GET '/codepanel.sql'
    expect_status 'Los volcados SQL de la raíz no son públicos' 403 404

    request GET '/storage/uploads/.htaccess'
    expect_status 'El almacenamiento de adjuntos no es público' 403 404

    request GET '/storage/index.php'
    expect_status 'El fallback de storage permanece privado' 403 404

    request GET '/storage/uploads/index.php'
    expect_status 'El fallback de uploads permanece privado' 403 404

    request GET '/storage/public-feedback/index.php'
    expect_status 'El fallback de capturas públicas permanece privado' 403 404

    request GET '/tests/backend_regression.php'
    expect_status 'Las pruebas internas no son públicas' 403 404

    request GET '/scripts/verify.sh'
    expect_status 'Los scripts de mantenimiento no son públicos' 403 404
fi

login_email="${SMOKE_EMAIL:-}"
login_password="${SMOKE_PASSWORD:-}"
if [[ "${SMOKE_USE_DEMO:-0}" == '1' ]]; then
    login_email="${login_email:-demo@codepanel.local}"
    login_password="${login_password:-Demo1234!}"
fi

if [[ -n "${login_email}" || -n "${login_password}" ]]; then
    if [[ -z "${login_email}" || -z "${login_password}" ]]; then
        fail 'Para probar login deben definirse SMOKE_EMAIL y SMOKE_PASSWORD juntos'
    fi

    # El login también exige el token CSRF de la sesión, igual que la interfaz.
    request GET "${API_PREFIX}/auth/csrf"
    expect_status 'Token CSRF disponible' 200
    CSRF_TOKEN="$(php -r '$p = json_decode(stream_get_contents(STDIN), true); echo $p["data"]["csrf_token"] ?? "";' <<<"${HTTP_BODY}")"
    [[ -n "${CSRF_TOKEN}" ]] || fail 'La API no devolvió un token CSRF'

    login_payload="$(make_login_payload "${login_email}" "${login_password}")"
    request POST "${API_PREFIX}/auth/login" "${login_payload}"
    expect_status 'Login válido' 200
    expect_json 'Login'
    expect_success_envelope 'Login'

    request GET "${API_PREFIX}/auth/me"
    expect_status 'Sesión autenticada' 200
    expect_json 'Sesión autenticada'
    expect_success_envelope 'Sesión autenticada'
    expect_authenticated_session

    request GET "${API_PREFIX}/dashboard"
    expect_status 'Dashboard autenticado' 200
    expect_json 'Dashboard'
    expect_success_envelope 'Dashboard'

    for resource in projects ideas clients leads tasks devlogs budgets payments releases resources reminders time_entries weekly_reviews tags; do
        request GET "${API_PREFIX}/${resource}"
        expect_status "Listado ${resource}" 200
        expect_json "Listado ${resource}"
        expect_success_envelope "Listado ${resource}"
        expect_list_envelope "Listado ${resource}"
    done


    request GET "${API_PREFIX}/settings"
    expect_status 'Configuración personal' 200
    expect_json 'Configuración personal'
    expect_success_envelope 'Configuración personal'
    expect_object_data_envelope 'Configuración personal'

    calendar_from="$(php -r 'echo date("Y-m-01");')"
    calendar_to="$(php -r 'echo date("Y-m-t");')"
    request GET "${API_PREFIX}/calendar?from=${calendar_from}&to=${calendar_to}"
    expect_status 'Calendario mensual' 200
    expect_json 'Calendario mensual'
    expect_success_envelope 'Calendario mensual'
    expect_list_envelope 'Calendario mensual'

    request GET "${API_PREFIX}/profitability"
    expect_status 'Rentabilidad' 200
    expect_json 'Rentabilidad'
    expect_success_envelope 'Rentabilidad'
    expect_object_data_envelope 'Rentabilidad'

    request GET "${API_PREFIX}/attention"
    expect_status 'Centro de recordatorios agregado' 200
    expect_json 'Centro de recordatorios agregado'
    expect_success_envelope 'Centro de recordatorios agregado'
    expect_list_envelope 'Centro de recordatorios agregado'

    request GET "${API_PREFIX}/weekly_summary"
    expect_status 'Resumen semanal agregado' 200
    expect_json 'Resumen semanal agregado'
    expect_success_envelope 'Resumen semanal agregado'
    expect_object_data_envelope 'Resumen semanal agregado'

    # Los adjuntos se comprueban únicamente en lectura: el smoke test nunca sube archivos.
    request GET "${API_PREFIX}/attachments"
    expect_status 'Listado attachments' 200
    expect_json 'Listado attachments'
    expect_success_envelope 'Listado attachments'
    expect_list_envelope 'Listado attachments'

    if [[ "${HEALTH_DEMO_MODE}" == 'true' ]]; then
        request GET "${API_PREFIX}/attachments/1/download"
        expect_status 'Descargas desactivadas en modo demo' 503
        expect_json 'Descargas desactivadas en modo demo'
    fi
else
    printf '[OMITIDO] Login y recursos privados; define SMOKE_USE_DEMO=1 o credenciales SMOKE_*\n'
fi

printf '\nSmoke test completado: %d comprobaciones.\n' "${checks}"
