-- Up
COMMENT ON TABLE github_commit_on_branch_raw_snapshots IS 'GitHub compareCommits API responses behind isCommitOnBranch(), archived at decision time since the branch HEAD moves and a later re-fetch would not reproduce the same result. Only a confirmed identical/ahead status archives the full response; behind/diverged/other outcomes archive only { status }, since diff patches and commit lists for those outcomes are never read back';
COMMENT ON COLUMN github_commit_on_branch_raw_snapshots.branch IS 'Branch name compared against at decision time; the branch HEAD moves, so most snapshots remain audit-trail-only — only a confirmed identical/ahead status (matched against the current github_repo_id) is reused as a cache hit by getDerivedCommitOnBranchStatusFromRawSnapshot(), since branch history is append-only for that outcome';

-- Down
COMMENT ON TABLE github_commit_on_branch_raw_snapshots IS 'Unmodified GitHub compareCommits API responses behind isCommitOnBranch(), archived at decision time since the branch HEAD moves and a later re-fetch would not reproduce the same result';
COMMENT ON COLUMN github_commit_on_branch_raw_snapshots.branch IS 'Branch name compared against at decision time; the branch HEAD moves, so this snapshot cannot be reused as a cache, only as an audit trail';
