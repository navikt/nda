-- Migration: Scope github_compare_snapshots by immutable github_repo_id
-- Purpose: Guard the compare cache against owner/repo name reuse. See
-- app/db/migrations/1788900000000_add-repository-name-history.sql for the
-- background on why owner/repo names alone are not a stable identity.

ALTER TABLE github_compare_snapshots ADD COLUMN github_repo_id BIGINT;

CREATE INDEX idx_compare_snapshots_repo_id_lookup
  ON github_compare_snapshots(github_repo_id, base_sha, head_sha, fetched_at DESC)
  WHERE github_repo_id IS NOT NULL;

COMMENT ON COLUMN github_compare_snapshots.github_repo_id IS 'GitHub''s global, immutable repository id, nullable for rows written before this column existed. Read sites must accept NULL as "unknown" and fall back to owner/repo matching, never treat NULL as a mismatch.';
