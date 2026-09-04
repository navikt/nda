-- Introduce a repository-level settings entity.
--
-- Context:
-- audit_start_year, implicit_approval and default_branch have until now been
-- configured per monitored application. Several applications can be deployed
-- from the same GitHub repository (monorepo), and they must share identical
-- four-eyes rules — otherwise the same commit can be judged differently
-- depending on which app it was deployed as.
--
-- repositories is keyed by github_repo_id (GitHub's global, immutable
-- repository id) rather than (owner, name), since owner/name change on rename
-- or org transfer. application_repositories.github_repo_id is backfilled
-- asynchronously, so applications whose active repository row has no
-- github_repo_id yet keep falling back to their per-app column values.
--
-- The per-app columns (monitored_applications.audit_start_year,
-- .default_branch, .default_branch_synced_at) and app_settings
-- ('implicit_approval') are deliberately kept as fallback storage and are
-- written through on every repo-level change.

CREATE TABLE IF NOT EXISTS repositories (
  id SERIAL PRIMARY KEY,
  github_repo_id BIGINT NOT NULL UNIQUE,
  github_owner VARCHAR(255) NOT NULL,
  github_repo_name VARCHAR(255) NOT NULL,
  audit_start_year INTEGER NULL,
  implicit_approval_mode VARCHAR(50) NOT NULL DEFAULT 'off',
  default_branch VARCHAR(255) NULL,
  default_branch_synced_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE repositories DROP CONSTRAINT IF EXISTS repositories_implicit_approval_mode_check;
ALTER TABLE repositories ADD CONSTRAINT repositories_implicit_approval_mode_check
  CHECK (implicit_approval_mode IN ('off', 'dependabot_only', 'all'));

CREATE INDEX IF NOT EXISTS idx_repositories_owner_name ON repositories (github_owner, github_repo_name);

COMMENT ON TABLE repositories IS 'Repository-level configuration shared by every monitored application deployed from the same GitHub repository';
COMMENT ON COLUMN repositories.github_repo_id IS 'GitHub''s global, immutable repository id. Links to application_repositories.github_repo_id';
COMMENT ON COLUMN repositories.audit_start_year IS 'Deployments before this year are ignored in statistics and reports. NULL means no limit';
COMMENT ON COLUMN repositories.implicit_approval_mode IS 'off | dependabot_only | all. Strictest mode of the merged applications wins on backfill';
COMMENT ON COLUMN repositories.default_branch IS 'Default branch fetched from GitHub. NULL until synced — consumers fall back to monitored_applications.default_branch';

CREATE TABLE IF NOT EXISTS repo_config_audit_log (
  id SERIAL PRIMARY KEY,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  changed_by_nav_ident VARCHAR(20) NOT NULL,
  changed_by_name VARCHAR(255),
  setting_key VARCHAR(100) NOT NULL,
  old_value JSONB,
  new_value JSONB NOT NULL,
  change_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_repo_config_audit_log_repository_id ON repo_config_audit_log(repository_id);
CREATE INDEX IF NOT EXISTS idx_repo_config_audit_log_created_at ON repo_config_audit_log(created_at DESC);

COMMENT ON TABLE repo_config_audit_log IS 'Audit trail for repository-level configuration changes, required for compliance. app_config_audit_log is kept as the historical per-app trail';
