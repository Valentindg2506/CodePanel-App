#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

failures=0
warnings=0

pass() {
    printf '[OK] %s\n' "$1"
}

warn() {
    printf '[AVISO] %s\n' "$1"
    warnings=$((warnings + 1))
}

fail() {
    printf '[ERROR] %s\n' "$1"
    failures=$((failures + 1))
}

require_command() {
    if command -v "$1" >/dev/null 2>&1; then
        pass "Comando disponible: $1"
    else
        fail "Falta el comando requerido: $1"
    fi
}

env_value() {
    local key="$1"
    local file="$2"

    awk -v wanted="${key}" '
        /^[[:space:]]*#/ { next }
        {
            line = $0
            sub(/^[[:space:]]*/, "", line)
            split(line, fields, "=")
            key = fields[1]
            sub(/[[:space:]]*$/, "", key)
            if (key == wanted) {
                sub(/^[^=]*=/, "", line)
                sub(/^[[:space:]]*/, "", line)
                sub(/[[:space:]]*$/, "", line)
                gsub(/^[\047"]|[\047"]$/, "", line)
                print line
                exit
            }
        }
    ' "${file}"
}

cd "${PROJECT_ROOT}"

printf 'CodePanel · verificación local\n'
printf 'Raíz: %s\n\n' "${PROJECT_ROOT}"

require_command php
require_command curl

if command -v php >/dev/null 2>&1; then
    php_version="$(php -r 'echo PHP_VERSION;')"
    php_major="$(php -r 'echo PHP_MAJOR_VERSION;')"
    php_minor="$(php -r 'echo PHP_MINOR_VERSION;')"

    if ((php_major > 8 || (php_major == 8 && php_minor >= 1))); then
        pass "PHP ${php_version} (mínimo: 8.1)"
    else
        fail "PHP ${php_version}; CodePanel requiere PHP 8.1 o superior"
    fi

    required_extensions=(pdo pdo_mysql json mbstring session openssl fileinfo)
    missing_extensions=()
    for extension in "${required_extensions[@]}"; do
        if ! php -r "exit(extension_loaded('${extension}') ? 0 : 1);"; then
            missing_extensions+=("${extension}")
        fi
    done

    if ((${#missing_extensions[@]} == 0)); then
        pass 'Extensiones PHP requeridas disponibles'
    else
        fail "Faltan extensiones PHP: ${missing_extensions[*]}"
    fi

    php_files=()
    if command -v rg >/dev/null 2>&1; then
        while IFS= read -r -d '' file; do
            php_files+=("${file}")
        done < <(rg --files -0 -g '*.php' -g '!vendor/**' -g '!node_modules/**')
    else
        while IFS= read -r -d '' file; do
            php_files+=("${file#./}")
        done < <(find . -type f -name '*.php' -not -path './vendor/*' -not -path './node_modules/*' -print0)
    fi

    lint_failures=0
    for file in "${php_files[@]}"; do
        if ! php -l "${file}" >/dev/null; then
            lint_failures=$((lint_failures + 1))
        fi
    done

    if ((lint_failures == 0)); then
        pass "Sintaxis PHP válida (${#php_files[@]} archivos)"
    else
        fail "Falló el lint de ${lint_failures} archivo(s) PHP"
    fi
fi

config_file=''
if [[ -f .env.php ]]; then
    config_file='.env.php'
elif [[ -f .env ]]; then
    config_file='.env'
elif [[ -f .env.php.example ]]; then
    config_file='.env.php.example'
    warn 'No existe .env.php; se validará solamente la plantilla .env.php.example'
elif [[ -f .env.example ]]; then
    config_file='.env.example'
    warn 'No existe .env.php ni .env; se validará solamente la plantilla .env.example'
else
    fail 'No se encontró .env.php, .env ni una plantilla de configuración'
fi

if [[ -n "${config_file}" ]]; then
    required_keys=(DB_HOST DB_PORT DB_NAME DB_USER DB_PASS DB_CHARSET APP_ENV APP_DEBUG APP_URL SESSION_NAME DEMO_FALLBACK)
    missing_keys=()
    for key in "${required_keys[@]}"; do
        if ! grep -Eq "^[[:space:]]*${key}[[:space:]]*=" "${config_file}"; then
            missing_keys+=("${key}")
        fi
    done

    if ((${#missing_keys[@]} == 0)); then
        pass "Variables requeridas presentes en ${config_file}"
    else
        fail "Faltan variables en ${config_file}: ${missing_keys[*]}"
    fi

    app_env="$(env_value APP_ENV "${config_file}")"
    app_debug="$(env_value APP_DEBUG "${config_file}")"
    demo_fallback="$(env_value DEMO_FALLBACK "${config_file}")"
    allow_registration="$(env_value ALLOW_REGISTRATION "${config_file}")"

    if [[ "${config_file}" =~ ^\.env(\.php)?$ && "${app_env,,}" == 'production' ]]; then
        if [[ "${app_debug,,}" =~ ^(1|true|yes|on)$ ]]; then
            fail 'APP_DEBUG debe estar desactivado en producción'
        fi
        if [[ "${demo_fallback,,}" =~ ^(1|true|yes|on)$ ]]; then
            fail 'DEMO_FALLBACK debe estar desactivado en producción'
        fi
        if [[ -z "${allow_registration}" || "${allow_registration,,}" =~ ^(1|true|yes|on)$ ]]; then
            fail 'ALLOW_REGISTRATION debe estar definido como false en producción después de crear las cuentas autorizadas'
        fi
    fi

    for upload_key in UPLOAD_MAX_BYTES UPLOAD_USER_QUOTA_BYTES; do
        upload_value="$(env_value "${upload_key}" "${config_file}")"
        if [[ -z "${upload_value}" ]]; then
            continue
        fi
        if [[ ! "${upload_value}" =~ ^[0-9]+$ ]] || ((10#${upload_value} < 1)); then
            fail "${upload_key} debe ser un número entero positivo cuando se define"
            continue
        fi
        if [[ "${upload_key}" == 'UPLOAD_MAX_BYTES' ]] && ((10#${upload_value} > 10485760)); then
            fail 'UPLOAD_MAX_BYTES no puede superar el límite interno de 10485760 bytes'
        fi
        if [[ "${upload_key}" == 'UPLOAD_USER_QUOTA_BYTES' ]] && ((10#${upload_value} > 104857600)); then
            fail 'UPLOAD_USER_QUOTA_BYTES no puede superar el límite interno de 104857600 bytes'
        fi
    done
fi

if [[ ! -f .htaccess ]]; then
    fail 'Falta .htaccess en la raíz para proteger secretos y volcados'
elif grep -Eqi 'FilesMatch[^>]*(sql|dump|bak|backup)' .htaccess; then
    pass 'La regla web de la raíz contempla volcados y copias de respaldo'
else
    fail '.htaccess no contiene una regla reconocible para bloquear volcados SQL y backups'
fi

if [[ ! -f database/.htaccess ]]; then
    fail 'Falta database/.htaccess'
elif grep -Eqi 'Require[[:space:]]+all[[:space:]]+denied|Deny[[:space:]]+from[[:space:]]+all' database/.htaccess; then
    pass 'Acceso web denegado en database/.htaccess'
else
    fail 'database/.htaccess no contiene una regla de denegación reconocible'
fi

for private_dir in tests scripts; do
    protection_file="${private_dir}/.htaccess"
    fallback_file="${private_dir}/index.php"
    if [[ ! -f "${protection_file}" ]] || ! grep -Eqi 'Require[[:space:]]+all[[:space:]]+denied|Deny[[:space:]]+from[[:space:]]+all' "${protection_file}"; then
        fail "Falta una regla de denegación válida en ${protection_file}"
    else
        pass "Acceso web denegado en ${protection_file}"
    fi
    if [[ ! -f "${fallback_file}" ]] || ! grep -Eq 'http_response_code[[:space:]]*\([[:space:]]*404[[:space:]]*\)' "${fallback_file}"; then
        fail "Falta un fallback 404 válido en ${fallback_file}"
    else
        pass "Fallback 404 disponible en ${fallback_file}"
    fi
done

if [[ -d storage ]]; then
    if [[ -d storage/uploads ]]; then
        pass 'Directorio privado de adjuntos disponible'
    else
        fail 'Existe storage/ pero falta storage/uploads/'
    fi
    if [[ -d storage/public-feedback ]]; then
        pass 'Directorio privado de capturas públicas disponible'
    else
        fail 'Existe storage/ pero falta storage/public-feedback/'
    fi

    for protection_file in storage/.htaccess storage/uploads/.htaccess storage/public-feedback/.htaccess; do
        if [[ ! -f "${protection_file}" ]]; then
            fail "Falta la protección web ${protection_file}"
        elif grep -Eqi 'Require[[:space:]]+all[[:space:]]+denied|Deny[[:space:]]+from[[:space:]]+all' "${protection_file}"; then
            pass "Acceso web denegado en ${protection_file}"
        else
            fail "${protection_file} no contiene una regla de denegación reconocible"
        fi
    done


    for fallback_file in storage/index.php storage/uploads/index.php storage/public-feedback/index.php; do
        if [[ ! -f "${fallback_file}" ]]; then
            fail "Falta el fallback privado ${fallback_file}"
        elif grep -Eq 'http_response_code[[:space:]]*\([[:space:]]*404[[:space:]]*\)' "${fallback_file}"; then
            pass "Fallback 404 disponible en ${fallback_file}"
        else
            fail "${fallback_file} no responde explícitamente con HTTP 404"
        fi
    done

    if [[ -d storage/uploads && -w storage/uploads ]]; then
        pass 'storage/uploads/ es escribible por el usuario de verificación'
    elif [[ -d storage/uploads ]]; then
        warn 'storage/uploads/ no es escribible por el usuario actual; comprueba el usuario de PHP'
    fi
    if [[ -d storage/public-feedback && -w storage/public-feedback ]]; then
        pass 'storage/public-feedback/ es escribible por el usuario de verificación'
    elif [[ -d storage/public-feedback ]]; then
        warn 'storage/public-feedback/ no es escribible por el usuario actual; comprueba el usuario de PHP'
    fi
fi

if [[ -n "${BASE_URL:-}" ]]; then
    printf '\nEjecutando smoke test contra %s\n' "${BASE_URL}"
    if "${PROJECT_ROOT}/tests/smoke.sh"; then
        pass 'Smoke test HTTP'
    else
        fail 'Smoke test HTTP'
    fi
else
    warn 'Smoke test omitido; define BASE_URL para probar una instancia en ejecución'
fi

printf '\nResultado: %d error(es), %d aviso(s).\n' "${failures}" "${warnings}"
((failures == 0))
