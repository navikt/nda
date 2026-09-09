-- Track historical GitHub owner/repo names for repositories.
--
-- repositories.github_repo_id is the stable identifier, but github_owner and
-- github_repo_name change when a repo is renamed or transferred to another
-- org. When that happens, the sync logic overwrites the existing row
-- in-place (same id) rather than creating a new one. This table stores the
-- name that was replaced, so an old bookmarked /repository/:owner/:repo URL
-- can be resolved and redirected to the repository's current name instead of
-- 404-ing.
--
-- Uniqueness is scoped per-repository rather than globally: an owner/name
-- combination can legitimately be reused later by a different repository
-- (delete+recreate, or the name being freed up after a rename/transfer), so
-- a global unique constraint would cause future sync writes for the newer
-- repository to fail. A plain (non-unique) index on (github_owner,
-- github_repo_name) supports the redirect lookup, which should pick the most
-- recent match (MAX(replaced_at)) if more than one repository has ever used
-- that name.

CREATE TABLE IF NOT EXISTS repository_name_history (
  id SERIAL PRIMARY KEY,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  github_owner VARCHAR(255) NOT NULL,
  github_repo_name VARCHAR(255) NOT NULL,
  replaced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (repository_id, github_owner, github_repo_name)
);

CREATE INDEX IF NOT EXISTS idx_repository_name_history_repository_id ON repository_name_history(repository_id);
CREATE INDEX IF NOT EXISTS idx_repository_name_history_owner_name ON repository_name_history(github_owner, github_repo_name);

COMMENT ON TABLE repository_name_history IS 'Historical github_owner/github_repo_name values for repositories, used to redirect stale bookmarked URLs to the current name after a rename or org transfer';
COMMENT ON COLUMN repository_name_history.repository_id IS 'The repository this historical name belonged to';
COMMENT ON COLUMN repository_name_history.replaced_at IS 'When this owner/repo name stopped being current';
