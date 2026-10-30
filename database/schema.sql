-- CodePanel · esquema MySQL 8 / MariaDB 10.5+
-- Selecciona previamente la base de datos asignada por tu hosting.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS project_feedback_rate_limits;
DROP TABLE IF EXISTS project_feedback_images;
DROP TABLE IF EXISTS project_feedback;
DROP TABLE IF EXISTS project_public_links;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS weekly_reviews;
DROP TABLE IF EXISTS time_entries;
DROP TABLE IF EXISTS reminders;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS dev_logs;
DROP TABLE IF EXISTS releases;
DROP TABLE IF EXISTS resources;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS leads;
DROP TABLE IF EXISTS ideas;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(80) NOT NULL,
    email VARCHAR(190) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Intentos de acceso fallidos: limitan la fuerza bruta por email y por IP sin depender de la cookie.
CREATE TABLE login_attempts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(190) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    attempted_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_login_attempts_email (email, attempted_at),
    KEY idx_login_attempts_ip (ip_address, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE clients (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(140) NOT NULL,
    company VARCHAR(140) NULL,
    email VARCHAR(190) NULL,
    phone VARCHAR(50) NULL,
    website VARCHAR(500) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    source VARCHAR(100) NULL,
    notes TEXT NULL,
    last_contact DATE NULL,
    tags JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_clients_user_status (user_id, status),
    KEY idx_clients_user_updated (user_id, updated_at),
    KEY idx_clients_user_email (user_id, email),
    CONSTRAINT fk_clients_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE projects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    client_id BIGINT UNSIGNED NULL,
    name VARCHAR(140) NOT NULL,
    description TEXT NULL,
    project_type VARCHAR(20) NOT NULL DEFAULT 'personal',
    status VARCHAR(30) NOT NULL DEFAULT 'planned',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
    due_date DATE NULL,
    tech_stack JSON NOT NULL,
    repository_url VARCHAR(500) NULL,
    live_url VARCHAR(500) NULL,
    color CHAR(7) NOT NULL DEFAULT '#7867E6',
    pinned TINYINT(1) NOT NULL DEFAULT 0,
    tags JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_projects_user_status (user_id, status),
    KEY idx_projects_user_type (user_id, project_type),
    KEY idx_projects_user_due (user_id, due_date),
    KEY idx_projects_user_pinned_updated (user_id, pinned, updated_at),
    KEY idx_projects_user_updated (user_id, updated_at),
    KEY idx_projects_client (client_id),
    CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_projects_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE SET NULL,
    CONSTRAINT chk_projects_type CHECK (project_type IN ('personal', 'commercial')),
    CONSTRAINT chk_projects_personal_due CHECK (project_type = 'commercial' OR due_date IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_public_links (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NOT NULL,
    token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_public_links_project (project_id),
    UNIQUE KEY uq_project_public_links_token (token),
    KEY idx_project_public_links_owner (user_id, project_id),
    CONSTRAINT fk_project_public_links_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_project_public_links_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT chk_project_public_links_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_feedback (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_link_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NOT NULL,
    public_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'new',
    author_name VARCHAR(100) NOT NULL,
    author_email VARCHAR(190) NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_feedback_public_id (public_id),
    KEY idx_project_feedback_owner_project (user_id, project_id, status, created_at),
    KEY idx_project_feedback_link_created (public_link_id, created_at),
    CONSTRAINT fk_project_feedback_link FOREIGN KEY (public_link_id) REFERENCES project_public_links (id) ON DELETE CASCADE,
    CONSTRAINT fk_project_feedback_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_project_feedback_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT chk_project_feedback_type CHECK (type IN ('comment', 'bug', 'error')),
    CONSTRAINT chk_project_feedback_status CHECK (status IN ('new', 'in_review', 'resolved', 'closed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_feedback_images (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    feedback_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    extension VARCHAR(12) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    width SMALLINT UNSIGNED NOT NULL,
    height SMALLINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_feedback_images_stored (stored_name),
    KEY idx_project_feedback_images_feedback (feedback_id),
    KEY idx_project_feedback_images_owner_project (user_id, project_id),
    CONSTRAINT fk_project_feedback_images_feedback FOREIGN KEY (feedback_id) REFERENCES project_feedback (id) ON DELETE CASCADE,
    CONSTRAINT fk_project_feedback_images_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_project_feedback_images_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT chk_project_feedback_images_size CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    CONSTRAINT chk_project_feedback_images_dimensions CHECK (width > 0 AND height > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_feedback_rate_limits (
    public_link_id BIGINT UNSIGNED NOT NULL,
    requester_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    window_start DATETIME NOT NULL,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (public_link_id, requester_hash, window_start),
    KEY idx_project_feedback_rate_cleanup (window_start),
    CONSTRAINT fk_project_feedback_rate_link FOREIGN KEY (public_link_id) REFERENCES project_public_links (id) ON DELETE CASCADE,
    CONSTRAINT chk_project_feedback_rate_attempts CHECK (attempts > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ideas (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(180) NOT NULL,
    description TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'inbox',
    category VARCHAR(80) NULL,
    effort TINYINT UNSIGNED NOT NULL DEFAULT 3,
    impact TINYINT UNSIGNED NOT NULL DEFAULT 3,
    tags JSON NOT NULL,
    archived TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ideas_user_status (user_id, status, archived),
    KEY idx_ideas_user_updated (user_id, updated_at),
    CONSTRAINT fk_ideas_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leads (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(140) NOT NULL,
    company VARCHAR(140) NULL,
    email VARCHAR(190) NULL,
    phone VARCHAR(50) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'new',
    value DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0,
    source VARCHAR(100) NULL,
    next_follow_up DATE NULL,
    notes TEXT NULL,
    tags JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_leads_user_status (user_id, status),
    KEY idx_leads_user_follow_up (user_id, next_follow_up),
    KEY idx_leads_user_updated (user_id, updated_at),
    CONSTRAINT fk_leads_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tasks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    title VARCHAR(180) NOT NULL,
    description TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'todo',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    assignee VARCHAR(140) NULL,
    due_date DATE NULL,
    completed_at DATETIME NULL,
    tags JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_tasks_user_status (user_id, status),
    KEY idx_tasks_user_due (user_id, due_date),
    KEY idx_tasks_project (project_id),
    CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dev_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    entry_date DATE NOT NULL,
    title VARCHAR(180) NOT NULL,
    content TEXT NULL,
    entry_type VARCHAR(30) NOT NULL DEFAULT 'progress',
    minutes_spent SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    tags JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_dev_logs_user_date (user_id, entry_date),
    KEY idx_dev_logs_user_type (user_id, entry_type),
    KEY idx_dev_logs_project (project_id),
    CONSTRAINT fk_dev_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_dev_logs_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
    CONSTRAINT chk_dev_logs_type CHECK (entry_type IN ('progress', 'decision', 'blocker', 'learning', 'note')),
    CONSTRAINT chk_dev_logs_minutes CHECK (minutes_spent <= 1440)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE budgets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    client_id BIGINT UNSIGNED NULL,
    project_id BIGINT UNSIGNED NULL,
    title VARCHAR(180) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    amount DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0,
    valid_until DATE NULL,
    notes TEXT NULL,
    tags JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_budgets_id_user (id, user_id),
    KEY idx_budgets_user_status (user_id, status),
    KEY idx_budgets_user_valid (user_id, valid_until),
    KEY idx_budgets_client (client_id),
    KEY idx_budgets_project (project_id),
    CONSTRAINT fk_budgets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_budgets_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE SET NULL,
    CONSTRAINT fk_budgets_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
    CONSTRAINT chk_budgets_status CHECK (status IN ('draft', 'sent', 'approved', 'rejected', 'expired')),
    CONSTRAINT chk_budgets_currency CHECK (currency IN ('ARS', 'USD', 'EUR')),
    CONSTRAINT chk_budgets_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    budget_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(12,2) UNSIGNED NOT NULL,
    paid_at DATE NOT NULL,
    method VARCHAR(30) NOT NULL DEFAULT 'transfer',
    reference VARCHAR(180) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_payments_user_date (user_id, paid_at),
    KEY idx_payments_budget_user (budget_id, user_id),
    CONSTRAINT fk_payments_budget_owner FOREIGN KEY (budget_id, user_id) REFERENCES budgets (id, user_id) ON DELETE CASCADE,
    CONSTRAINT chk_payments_amount CHECK (amount > 0),
    CONSTRAINT chk_payments_method CHECK (method IN ('transfer', 'cash', 'card', 'digital_wallet', 'other'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE releases (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(180) NOT NULL,
    version VARCHAR(80) NULL,
    kind VARCHAR(20) NOT NULL DEFAULT 'version',
    environment VARCHAR(30) NOT NULL DEFAULT 'production',
    status VARCHAR(30) NOT NULL DEFAULT 'planned',
    release_date DATE NULL,
    url VARCHAR(500) NULL,
    notes TEXT NULL,
    tags JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_releases_user_status (user_id, status),
    KEY idx_releases_user_date (user_id, release_date),
    KEY idx_releases_project (project_id),
    CONSTRAINT fk_releases_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_releases_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT chk_releases_kind CHECK (kind IN ('version', 'delivery')),
    CONSTRAINT chk_releases_environment CHECK (environment IN ('development', 'staging', 'production', 'client')),
    CONSTRAINT chk_releases_status CHECK (status IN ('planned', 'ready', 'published', 'rolled_back'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_settings (
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

CREATE TABLE tags (
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

CREATE TABLE reminders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    title VARCHAR(180) NOT NULL,
    due_at DATETIME NOT NULL,
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

CREATE TABLE time_entries (
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

CREATE TABLE weekly_reviews (
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

CREATE TABLE attachments (
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

CREATE TABLE resources (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    name VARCHAR(180) NOT NULL,
    resource_type VARCHAR(30) NOT NULL DEFAULT 'service',
    provider VARCHAR(140) NULL,
    url VARCHAR(500) NULL,
    environment VARCHAR(30) NOT NULL DEFAULT 'production',
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    renewal_date DATE NULL,
    cost DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0,
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    billing_cycle VARCHAR(20) NOT NULL DEFAULT 'none',
    notes TEXT NULL,
    tags JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_resources_user_status (user_id, status),
    KEY idx_resources_user_renewal (user_id, renewal_date),
    KEY idx_resources_project (project_id),
    CONSTRAINT fk_resources_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_resources_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
    CONSTRAINT chk_resources_type CHECK (resource_type IN ('domain', 'hosting', 'server', 'database', 'repository', 'service', 'documentation', 'other')),
    CONSTRAINT chk_resources_environment CHECK (environment IN ('development', 'staging', 'production', 'shared')),
    CONSTRAINT chk_resources_status CHECK (status IN ('active', 'attention', 'inactive')),
    CONSTRAINT chk_resources_cost CHECK (cost >= 0),
    CONSTRAINT chk_resources_currency CHECK (currency IN ('ARS', 'USD', 'EUR')),
    CONSTRAINT chk_resources_billing CHECK (billing_cycle IN ('none', 'monthly', 'yearly', 'one_time'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
