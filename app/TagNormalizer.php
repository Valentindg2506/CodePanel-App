<?php

declare(strict_types=1);

namespace CodePanel;

final class TagNormalizer
{
    public static function name(mixed $value): string
    {
        if (!is_scalar($value)) {
            return '';
        }
        $name = preg_replace('/\s+/u', ' ', trim((string) $value)) ?? '';
        return mb_substr($name, 0, 50);
    }

    public static function slug(string $name): string
    {
        $slug = mb_strtolower(self::name($name));
        $slug = preg_replace('/[^\p{L}\p{N}]+/u', '-', $slug) ?? '';
        $slug = trim($slug, '-');
        return mb_substr($slug, 0, 80);
    }

    /** @param array<int, mixed> $tags @return array<int, string> */
    public static function names(array $tags): array
    {
        $result = [];
        $slugs = [];
        foreach ($tags as $tag) {
            $name = self::name($tag);
            $slug = self::slug($name);
            if ($name === '' || $slug === '' || in_array($slug, $slugs, true)) {
                continue;
            }
            $result[] = $name;
            $slugs[] = $slug;
            if (count($result) === 30) {
                break;
            }
        }
        return $result;
    }
}
