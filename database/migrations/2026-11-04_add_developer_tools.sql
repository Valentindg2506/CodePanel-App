-- CodePanel · herramientas para programadores (versión 1.9)
-- Migración no destructiva e idempotente para MySQL 8 / MariaDB 10.5+: se puede ejecutar varias veces.
-- Solo AÑADE columnas opcionales y tablas nuevas; no modifica ni borra datos existentes.
--   · tasks.estimated_minutes y tasks.checklist: horas estimadas y subtareas.
--   · resources.credential_ref: dónde está una credencial (nunca la credencial).
--   · snippets: fragmentos de código y comandos, opcionalmente vinculados a un proyecto.
--   · api_tokens: tokens personales para usar la API (solo se guarda su SHA-256).
-- Aplícala ANTES de publicar el código de la versión 1.9. Si el código llega antes, estas funciones
-- quedan ocultas y el resto de la aplicación sigue funcionando igual.

DELIMITER //
DROP PROCEDURE IF EXISTS codepanel_add_developer_tools//
CREATE PROCEDURE codepanel_add_developer_tools()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'tasks' AND column_name = 'estimated_minutes'
    ) THEN
        ALTER TABLE tasks ADD COLUMN estimated_minutes INT UNSIGNED NULL AFTER completed_at;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'tasks' AND column_name = 'checklist'
    ) THEN
        ALTER TABLE tasks ADD COLUMN checklist JSON NULL AFTER estimated_minutes;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'resources' AND column_name = 'credential_ref'
    ) THEN
        ALTER TABLE resources ADD COLUMN credential_ref VARCHAR(200) NULL AFTER notes;
    END IF;
END//
DELIMITER ;

CALL codepanel_add_developer_tools();
DROP PROCEDURE IF EXISTS codepanel_add_developer_tools;

CREATE TABLE IF NOT EXISTS snippets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    title VARCHAR(160) NOT NULL,
    language VARCHAR(40) NULL,
    content TEXT NOT NULL,
    tags JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_snippets_user_updated (user_id, updated_at),
    KEY idx_snippets_project (project_id),
    CONSTRAINT fk_snippets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_snippets_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(80) NOT NULL,
    token_prefix VARCHAR(16) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    scope VARCHAR(10) NOT NULL DEFAULT 'read',
    last_used_at DATETIME NULL,
    expires_at DATETIME NULL,
    revoked_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_api_tokens_hash (token_hash),
    KEY idx_api_tokens_user (user_id, revoked_at),
    CONSTRAINT fk_api_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT chk_api_tokens_scope CHECK (scope IN ('read', 'write'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
