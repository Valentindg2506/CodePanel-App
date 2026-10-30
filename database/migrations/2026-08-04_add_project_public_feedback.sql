-- Enlaces públicos por proyecto y portal de feedback.
-- Idempotente: se puede ejecutar más de una vez sin borrar datos existentes.

CREATE TABLE IF NOT EXISTS project_public_links (
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

CREATE TABLE IF NOT EXISTS project_feedback (
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

CREATE TABLE IF NOT EXISTS project_feedback_images (
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

CREATE TABLE IF NOT EXISTS project_feedback_rate_limits (
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
