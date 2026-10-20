ALTER TABLE github_commit_associated_prs_raw_snapshots
  ADD COLUMN pagination_complete BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN github_commit_associated_prs_raw_snapshots.pagination_complete IS 'Whether every page of the GitHub commit-associated pull request response was fetched; legacy snapshots default to incomplete';
