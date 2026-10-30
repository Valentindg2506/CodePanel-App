#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

readonly ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly BASE_URL="${BASE_URL:-http://localhost/CodePanel}"
readonly API="${BASE_URL%/}/api/index.php"
readonly COOKIE_JAR="$(mktemp "${ROOT}/tests/.public-feedback-cookie.XXXXXX")"
readonly TEST_IMAGE="$(mktemp --suffix=.png "${ROOT}/tests/.public-feedback-image.XXXXXX")"
readonly FAKE_IMAGE="$(mktemp --suffix=.png "${ROOT}/tests/.public-feedback-fake.XXXXXX")"

project_id=''
csrf_token=''
checks=0

cleanup() {
    if [[ -n "${project_id}" && -n "${csrf_token}" ]]; then
        curl --silent --output /dev/null --request DELETE --cookie "${COOKIE_JAR}" \
            --header "X-CSRF-Token: ${csrf_token}" "${API}/projects/${project_id}" || true
    fi
    rm -f -- "${COOKIE_JAR}" "${TEST_IMAGE}" "${FAKE_IMAGE}"
}
trap cleanup EXIT INT TERM

pass() {
    checks=$((checks + 1))
    printf '[OK] %s\n' "$1"
}

fail() {
    printf '[FALLO] %s\n' "$1" >&2
    exit 1
}

json_value() {
    local path="$1"
    php -r '
        $value = json_decode(stream_get_contents(STDIN), true);
        foreach (explode(".", $argv[1]) as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) exit(1);
            $value = $value[$segment];
        }
        echo is_scalar($value) ? (string) $value : json_encode($value);
    ' "${path}"
}

status_request() {
    local raw
    raw="$(curl --silent --show-error --write-out $'\n%{http_code}' "$@")"
    HTTP_STATUS="${raw##*$'\n'}"
    HTTP_BODY="${raw%$'\n'*}"
}

command -v convert >/dev/null 2>&1 || fail 'La prueba requiere ImageMagick para crear una captura temporal.'
convert -size 8x8 'xc:#df6f51' "${TEST_IMAGE}"
printf 'not-a-real-image' >"${FAKE_IMAGE}"

# El login exige el token CSRF de la sesión. Cuenta: FEEDBACK_SMOKE_EMAIL/PASSWORD o la de ejemplo.
status_request --cookie-jar "${COOKIE_JAR}" --cookie "${COOKIE_JAR}" "${API}/auth/csrf"
[[ "${HTTP_STATUS}" == '200' ]] || fail 'No se pudo obtener el token CSRF.'
csrf_token="$(json_value 'data.csrf_token' <<<"${HTTP_BODY}")"
login_payload="$(php -r 'echo json_encode(["email" => $argv[1], "password" => $argv[2]]);' \
    "${FEEDBACK_SMOKE_EMAIL:-demo@codepanel.local}" "${FEEDBACK_SMOKE_PASSWORD:-Demo1234!}")"
status_request --cookie-jar "${COOKIE_JAR}" --cookie "${COOKIE_JAR}" \
    --header 'Content-Type: application/json' --header "X-CSRF-Token: ${csrf_token}" \
    --data-binary "${login_payload}" \
    "${API}/auth/login"
[[ "${HTTP_STATUS}" == '200' ]] || fail 'No se pudo iniciar la sesión de prueba.'
csrf_token="$(json_value 'data.csrf_token' <<<"${HTTP_BODY}")"
pass 'Sesión autenticada para administrar el enlace'

status_request --cookie "${COOKIE_JAR}" --header "X-CSRF-Token: ${csrf_token}" \
    --header 'Content-Type: application/json' \
    --data-binary '{"name":"Feedback integration QA","description":"Proyecto temporal","project_type":"personal","status":"active","progress":45}' \
    "${API}/projects"
[[ "${HTTP_STATUS}" == '201' ]] || fail 'No se pudo crear el proyecto temporal.'
project_id="$(json_value 'data.id' <<<"${HTTP_BODY}")"
pass 'Proyecto temporal creado'

status_request --request POST --cookie "${COOKIE_JAR}" --header "X-CSRF-Token: ${csrf_token}" \
    "${API}/project-shares/${project_id}/enable"
[[ "${HTTP_STATUS}" == '200' ]] || fail 'No se pudo activar el enlace público.'
public_path="$(json_value 'data.public_path' <<<"${HTTP_BODY}")"
token="$(php -r '$fragment=parse_url(trim(stream_get_contents(STDIN)), PHP_URL_FRAGMENT); parse_str((string)$fragment, $values); echo $values["token"] ?? "";' <<<"${public_path}")"
[[ "${token}" =~ ^[a-f0-9]{64}$ ]] || fail 'El token no tiene el formato seguro esperado.'
pass 'Enlace público activado con token opaco en el fragmento'

status_request --header "X-Public-Project-Token: ${token}" "${API}/public-feedback"
[[ "${HTTP_STATUS}" == '200' ]] || fail 'El portal público no reconoció el enlace.'
[[ "$(json_value 'data.project.name' <<<"${HTTP_BODY}")" == 'Feedback integration QA' ]] \
    || fail 'El portal público no devolvió los datos mínimos del proyecto.'
pass 'Portal público disponible sin sesión'

public_headers="$(curl --silent --dump-header - --output /dev/null \
    --header "X-Public-Project-Token: ${token}" "${API}/public-feedback")"
if grep -qi '^Set-Cookie:' <<<"${public_headers}"; then
    fail 'El endpoint público creó una sesión innecesaria.'
fi
grep -qi '^Referrer-Policy: no-referrer' <<<"${public_headers}" || fail 'Falta la política no-referrer.'
pass 'Endpoint público stateless, no-store y sin referrer'

status_request --header "X-Public-Project-Token: ${token}" \
    --form 'type=bug' --form 'author_name=Cliente QA' --form 'author_email=qa@example.test' \
    --form 'message=El botón principal no responde al tocarlo por primera vez.' \
    --form "images[]=@${TEST_IMAGE};type=image/png" \
    "${API}/public-feedback"
[[ "${HTTP_STATUS}" == '201' ]] || fail "No se pudo enviar feedback público con una imagen (HTTP ${HTTP_STATUS}: $(json_value 'message' <<<"${HTTP_BODY}" || printf 'respuesta inválida'))."
[[ "$(json_value 'data.image_count' <<<"${HTTP_BODY}")" == '1' ]] || fail 'La imagen no quedó asociada al reporte.'
pass 'Feedback público e imagen validados y guardados'

status_request --header "X-Public-Project-Token: ${token}" \
    --form 'type=error' --form 'author_name=Cliente QA' \
    --form 'message=Esta carga debe rechazarse porque el contenido no es una imagen.' \
    --form "images[]=@${FAKE_IMAGE};type=image/png" \
    "${API}/public-feedback"
[[ "${HTTP_STATUS}" == '422' ]] || fail 'Un archivo falso con extensión PNG no fue rechazado.'
pass 'Validación MIME real rechaza archivos disfrazados'

status_request --cookie "${COOKIE_JAR}" "${API}/project-shares/${project_id}/feedback"
[[ "${HTTP_STATUS}" == '200' ]] || fail 'El dueño no pudo listar el feedback.'
feedback_id="$(json_value 'data.items.0.id' <<<"${HTTP_BODY}")"
image_id="$(json_value 'data.items.0.images.0.id' <<<"${HTTP_BODY}")"
[[ "$(json_value 'data.summary.new' <<<"${HTTP_BODY}")" == '1' ]] || fail 'El resumen del feedback es incorrecto.'
pass 'Feedback aislado y visible para el dueño'

image_response="$(curl --silent --output /dev/null --write-out '%{http_code}:%{content_type}' \
    --cookie "${COOKIE_JAR}" "${API}/project-shares/${project_id}/feedback-images/${image_id}")"
[[ "${image_response}" == '200:image/png' ]] || fail 'La captura autenticada no se pudo previsualizar.'
pass 'Captura entregada sólo por la API autenticada'

status_request --request PATCH --cookie "${COOKIE_JAR}" --header "X-CSRF-Token: ${csrf_token}" \
    --header 'Content-Type: application/json' --data-binary '{"status":"in_review"}' \
    "${API}/project-shares/${project_id}/feedback/${feedback_id}"
[[ "${HTTP_STATUS}" == '200' && "$(json_value 'data.status' <<<"${HTTP_BODY}")" == 'in_review' ]] \
    || fail 'No se pudo cambiar el estado del feedback.'
pass 'Estado privado actualizado con CSRF'

status_request --header "X-Public-Project-Token: ${token}" \
    --form 'type=comment' --form 'author_name=Cliente QA' \
    --form 'message=Un comentario sin capturas también debe poder enviarse.' \
    --form 'images[]=@/dev/null;filename=' \
    "${API}/public-feedback"
[[ "${HTTP_STATUS}" == '201' ]] || fail "Un comentario sin imágenes fue rechazado (HTTP ${HTTP_STATUS})."
[[ "$(json_value 'data.image_count' <<<"${HTTP_BODY}")" == '0' ]] || fail 'Un campo de archivo vacío no debe contar como imagen.'
pass 'Comentario sin capturas aceptado aunque llegue un campo de archivo vacío'

# Los envíos 1 y 2 son los de antes (con imagen y sin imágenes); del 3 al 8 llegan al límite.
for attempt in 3 4 5 6 7 8; do
    status_request --header "X-Public-Project-Token: ${token}" \
        --form 'type=comment' --form 'author_name=Rate QA' \
        --form "message=Comentario de validación de límite número ${attempt}." \
        "${API}/public-feedback"
    [[ "${HTTP_STATUS}" == '201' ]] || fail "El envío permitido ${attempt} fue rechazado antes del límite."
done
status_request --header "X-Public-Project-Token: ${token}" \
    --form 'type=comment' --form 'author_name=Rate QA' \
    --form 'message=Este noveno reporte debe ser limitado temporalmente.' \
    "${API}/public-feedback"
[[ "${HTTP_STATUS}" == '429' ]] || fail 'El noveno reporte del mismo origen no activó el rate limiting.'
pass 'Rate limiting público aplicado por enlace y origen'

old_token="${token}"
status_request --request POST --cookie "${COOKIE_JAR}" --header "X-CSRF-Token: ${csrf_token}" \
    "${API}/project-shares/${project_id}/regenerate"
[[ "${HTTP_STATUS}" == '200' ]] || fail 'No se pudo regenerar el enlace.'
public_path="$(json_value 'data.public_path' <<<"${HTTP_BODY}")"
token="$(php -r '$fragment=parse_url(trim(stream_get_contents(STDIN)), PHP_URL_FRAGMENT); parse_str((string)$fragment, $values); echo $values["token"] ?? "";' <<<"${public_path}")"
[[ "${token}" != "${old_token}" ]] || fail 'Regenerar conservó el token anterior.'
status_request --header "X-Public-Project-Token: ${old_token}" "${API}/public-feedback"
[[ "${HTTP_STATUS}" == '404' ]] || fail 'El token reemplazado siguió siendo válido.'
pass 'Regeneración invalida el enlace anterior inmediatamente'

status_request --request DELETE --cookie "${COOKIE_JAR}" --header "X-CSRF-Token: ${csrf_token}" \
    "${API}/project-shares/${project_id}/feedback/${feedback_id}"
[[ "${HTTP_STATUS}" == '200' ]] || fail 'No se pudo eliminar el feedback.'
status_request --cookie "${COOKIE_JAR}" "${API}/project-shares/${project_id}/feedback-images/${image_id}"
[[ "${HTTP_STATUS}" == '404' ]] || fail 'La imagen física continuó accesible tras eliminar el reporte.'
pass 'Eliminar feedback también retira sus imágenes'

status_request --request POST --cookie "${COOKIE_JAR}" --header "X-CSRF-Token: ${csrf_token}" \
    "${API}/project-shares/${project_id}/disable"
[[ "${HTTP_STATUS}" == '200' ]] || fail 'No se pudo desactivar el enlace.'
status_request --header "X-Public-Project-Token: ${token}" "${API}/public-feedback"
[[ "${HTTP_STATUS}" == '404' ]] || fail 'El enlace desactivado siguió disponible.'
pass 'Desactivar bloquea el portal inmediatamente'

storage_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "${BASE_URL%/}/storage/public-feedback/")"
[[ "${storage_status}" == '403' || "${storage_status}" == '404' ]] || fail 'El directorio de capturas es público.'
pass 'Almacenamiento físico bloqueado desde Apache'

status_request --request DELETE --cookie "${COOKIE_JAR}" --header "X-CSRF-Token: ${csrf_token}" \
    "${API}/projects/${project_id}"
[[ "${HTTP_STATUS}" == '200' ]] || fail 'No se pudo limpiar el proyecto temporal.'
project_id=''
pass 'Datos temporales eliminados'

printf 'OK feedback público: %d comprobaciones.\n' "${checks}"
