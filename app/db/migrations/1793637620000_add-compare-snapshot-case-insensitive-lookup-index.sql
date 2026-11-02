CREATE INDEX idx_compare_raw_snapshots_case_insensitive_lookup
  ON github_compare_raw_snapshots (github_repo_id, lower(base_sha), lower(head_sha), fetched_at DESC, id DESC);
