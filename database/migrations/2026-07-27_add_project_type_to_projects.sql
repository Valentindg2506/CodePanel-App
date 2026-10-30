-- CodePanel · migración aplicable una sola vez
-- Conserva la intención de los registros existentes: si ya tenían cliente o
-- fecha de entrega se consideran comerciales; el resto se considera personal.

ALTER TABLE projects
    ADD COLUMN project_type VARCHAR(20) NOT NULL DEFAULT 'personal' AFTER description;

UPDATE projects
SET project_type = CASE
    WHEN client_id IS NOT NULL OR due_date IS NOT NULL THEN 'commercial'
    ELSE 'personal'
END,
updated_at = updated_at;

ALTER TABLE projects
    ADD KEY idx_projects_user_type (user_id, project_type),
    ADD CONSTRAINT chk_projects_type CHECK (project_type IN ('personal', 'commercial')),
    ADD CONSTRAINT chk_projects_personal_due CHECK (project_type = 'commercial' OR due_date IS NULL);

-- MySQL no permite usar client_id en un CHECK porque su clave foránea usa
-- ON DELETE SET NULL. La API y ambas implementaciones de DataStore fuerzan
-- client_id = NULL para proyectos personales; el CHECK conserva la defensa
-- SQL para el tipo y la fecha sin romper la eliminación normal de clientes.
