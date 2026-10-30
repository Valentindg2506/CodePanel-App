-- CodePanel · productividad, calendario y personalización
-- Migración no destructiva para MySQL 8+. Puede ejecutarse más de una vez.

DELIMITER //
DROP PROCEDURE IF EXISTS codepanel_add_tags_column//
CREATE PROCEDURE codepanel_add_tags_column(IN table_name_value VARCHAR(64))
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = table_name_value
          AND column_name = 'tags'
    ) THEN
        SET @add_tags_sql = CONCAT(
            'ALTER TABLE `', table_name_value,
            '` ADD COLUMN tags JSON NOT NULL DEFAULT (JSON_ARRAY())'
        );
        PREPARE add_tags_statement FROM @add_tags_sql;
        EXECUTE add_tags_statement;
        DEALLOCATE PREPARE add_tags_statement;
    END IF;
END//
DELIMITER ;

CALL codepanel_add_tags_column('projects');
CALL codepanel_add_tags_column('tasks');
CALL codepanel_add_tags_column('clients');
CALL codepanel_add_tags_column('leads');
CALL codepanel_add_tags_column('budgets');
CALL codepanel_add_tags_column('releases');
CALL codepanel_add_tags_column('resources');

DROP PROCEDURE IF EXISTS codepanel_add_tags_column;

CREATE TABLE IF NOT EXISTS user_settings (
    user_id BIGINT UNSIGNED NOT NULL,
    default_currency CHAR(3) NOT NULL DEFAULT 'ARS',
    date_format VARCHAR(20) NOT NULL DEFAULT 'd/m/Y',
    timezone VARCHAR(100) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    theme VARCHAR(20) NOT NULL DEFAULT 'system',
    week_start VARCHAR(10) NOT NULL DEFAULT 'monday',
    default_hourly_cost DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0,
    dashboard_widgets JSON NOT NULL,
    reminder_days JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT chk_user_settings_currency CHECK (default_currency IN ('ARS', 'USD', 'EUR')),
    CONSTRAINT chk_user_settings_theme CHECK (theme IN ('system', 'light', 'night')),
    CONSTRAINT chk_user_settings_week_start CHECK (week_start IN ('monday', 'sunday')),
    CONSTRAINT chk_user_settings_hourly_cost CHECK (default_hourly_cost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO user_settings (
    user_id, default_currency, date_format, timezone, theme, week_start,
    default_hourly_cost, dashboard_widgets, reminder_days
)
SELECT
    id, 'ARS', 'd/m/Y', 'America/Argentina/Buenos_Aires', 'system', 'monday', 0,
    JSON_ARRAY('overview', 'projects', 'tasks', 'reminders', 'time_tracking', 'profitability', 'calendar', 'weekly_review', 'budgets', 'resources'),
    JSON_ARRAY(1, 3, 7)
FROM users
ON DUPLICATE KEY UPDATE user_id = VALUES(user_id);

CREATE TABLE IF NOT EXISTS tags (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(80) NOT NULL,
    color CHAR(7) NOT NULL DEFAULT '#7867E6',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tags_user_slug (user_id, slug),
    KEY idx_tags_user_name (user_id, name),
    CONSTRAINT fk_tags_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Las etiquetas JSON existentes permanecen intactas en sus entidades. El catálogo
-- las incorpora al volver a guardar cada registro, evitando funciones exclusivas de
-- versiones recientes de MySQL/MariaDB en esta migración compatible.

CREATE TABLE IF NOT EXISTS reminders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    title VARCHAR(180) NOT NULL,
    due_at DATETIME NOT NULL COMMENT 'UTC',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    notes TEXT NULL,
    tags JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_reminders_user_due (user_id, due_at),
    KEY idx_reminders_user_status (user_id, status),
    KEY idx_reminders_project (project_id),
    CONSTRAINT fk_reminders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_reminders_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
    CONSTRAINT chk_reminders_status CHECK (status IN ('pending', 'done', 'dismissed')),
    CONSTRAINT chk_reminders_priority CHECK (priority IN ('low', 'medium', 'high'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS time_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    task_id BIGINT UNSIGNED NULL,
    work_date DATE NOT NULL,
    description VARCHAR(500) NOT NULL,
    duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    started_at DATETIME NULL COMMENT 'UTC',
    ended_at DATETIME NULL COMMENT 'UTC',
    billable TINYINT(1) NOT NULL DEFAULT 0,
    hourly_cost DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0,
    cost_currency CHAR(3) NOT NULL DEFAULT 'ARS',
    tags JSON NOT NULL,
    running_slot TINYINT GENERATED ALWAYS AS (
        CASE WHEN started_at IS NOT NULL AND ended_at IS NULL THEN 1 ELSE NULL END
    ) STORED,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_time_entries_one_running (user_id, running_slot),
    KEY idx_time_entries_user_date (user_id, work_date),
    KEY idx_time_entries_project (project_id),
    KEY idx_time_entries_task (task_id),
    CONSTRAINT fk_time_entries_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_time_entries_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
    CONSTRAINT fk_time_entries_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE SET NULL,
    CONSTRAINT chk_time_entries_duration CHECK (duration_minutes <= 1440),
    CONSTRAINT chk_time_entries_order CHECK (ended_at IS NULL OR (started_at IS NOT NULL AND ended_at >= started_at)),
    CONSTRAINT chk_time_entries_currency CHECK (cost_currency IN ('ARS', 'USD', 'EUR')),
    CONSTRAINT chk_time_entries_hourly_cost CHECK (hourly_cost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS weekly_reviews (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    week_start DATE NOT NULL,
    wins TEXT NULL,
    blockers TEXT NULL,
    next_focus TEXT NULL,
    rating TINYINT UNSIGNED NOT NULL DEFAULT 3,
    tags JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_weekly_reviews_user_week (user_id, week_start),
    KEY idx_weekly_reviews_user_updated (user_id, updated_at),
    CONSTRAINT fk_weekly_reviews_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT chk_weekly_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attachments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name CHAR(64) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    extension VARCHAR(12) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_attachments_stored_name (stored_name),
    KEY idx_attachments_owner_entity (user_id, entity_type, entity_id),
    CONSTRAINT fk_attachments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT chk_attachments_size CHECK (size_bytes > 0 AND size_bytes <= 10485760)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
