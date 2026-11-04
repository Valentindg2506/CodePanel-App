<?php

declare(strict_types=1);

namespace CodePanel;

/**
 * Detecta secretos evidentes para que no acaben guardados en texto plano.
 *
 * CodePanel guarda dónde está cada credencial («1Password → Atlas → Producción»), nunca la credencial.
 * No es un escáner exhaustivo: frena los formatos más habituales (claves privadas, tokens con prefijo
 * conocido, contraseñas escritas como «password=…» y URLs con usuario y contraseña).
 */
final class SecretGuard
{
    private const PATTERNS = [
        '/-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/',
        '/\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{10,}/',
        '/\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}/',
        '/\bgithub_pat_[0-9A-Za-z_]{40,}/',
        '/\bglpat-[0-9A-Za-z_-]{20,}/',
        '/\bxox[abprs]-[0-9A-Za-z-]{10,}/',
        '/\bAKIA[0-9A-Z]{16}\b/',
        '/\bAIza[0-9A-Za-z_-]{35}\b/',
        '/\bcp_[0-9a-f]{40,}\b/',
        '/\beyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/',
        '/[a-z][a-z0-9+.-]*:\/\/[^\s:\/@]+:[^\s@\/]+@/i',
        '/\b(?:password|passwd|pwd|contraseña|clave|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["\']?[^\s"\']{6,}/iu',
    ];

    /** Formatos de secreto conocidos. Se usa en textos largos, como los fragmentos de código. */
    public static function containsSecret(string $text): bool
    {
        foreach (self::PATTERNS as $pattern) {
            if (preg_match($pattern, $text) === 1) {
                return true;
            }
        }
        return false;
    }

    /**
     * Para una referencia a una credencial: además de los formatos conocidos, rechaza cualquier
     * cadena larga sin espacios que mezcle letras y números, que es el aspecto de una clave.
     */
    public static function looksLikeCredential(string $text): bool
    {
        if (self::containsSecret($text)) {
            return true;
        }
        foreach (preg_split('/[\s→>\/|·,;]+/u', $text) ?: [] as $word) {
            if (mb_strlen($word) >= 24
                && preg_match('/[A-Za-z]/', $word) === 1
                && preg_match('/\d/', $word) === 1
                && preg_match('/^[\w\-+=.~!@#$%^&*]+$/', $word) === 1) {
                return true;
            }
        }
        return false;
    }
}
