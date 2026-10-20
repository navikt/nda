CREATE TABLE nais_apply_rejected_repositories (
  monitored_app_id INTEGER NOT NULL REFERENCES monitored_applications(id) ON DELETE CASCADE,
  github_repo_id BIGINT NOT NULL,
  rejected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (monitored_app_id, github_repo_id)
);
