-- CodePanel · proyectos fijados y vista enriquecida
-- Migración no destructiva e idempotente para MySQL 8 / MariaDB 10.5+.
-- No actualiza filas, por lo que conserva sus created_at y updated_at históricos.

DELIMITER //
DROP PROCEDURE IF EXISTS codepanel_add_project_pinning//
CREATE PROCEDURE codepanel_add_project_pinning()
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'projects'
          AND column_name = 'pinned'
    ) THEN
        ALTER TABLE projects
            ADD COLUMN pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER color;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'projects'
          AND index_name = 'idx_projects_user_pinned_updated'
    ) THEN
        ALTER TABLE projects
            ADD KEY idx_projects_user_pinned_updated (user_id, pinned, updated_at);
    END IF;
END//
DELIMITER ;

CALL codepanel_add_project_pinning();
DROP PROCEDURE IF EXISTS codepanel_add_project_pinning;
