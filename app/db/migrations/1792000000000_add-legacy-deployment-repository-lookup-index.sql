CREATE INDEX idx_deployments_legacy_repository_lookup
  ON deployments (monitored_app_id, detected_github_owner, detected_github_repo_name)
  WHERE repository_id IS NULL;
