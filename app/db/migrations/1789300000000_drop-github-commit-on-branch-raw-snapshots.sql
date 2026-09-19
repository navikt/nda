-- Migration: Drop github_commit_on_branch_raw_snapshots
-- Purpose: isCommitOnBranch() no longer archives the raw GitHub response (see
-- app/lib/github/git.server.ts), and getLatestCommitOnBranchRawSnapshot() never had any
-- callers. The table grew to 500 GB purely from periodic reverification (every 5 minutes
-- via the sync scheduler) writing a new append-only row each time, without ever being read
-- back. Dropping it entirely reclaims the disk space; see docs/raw-data-archival.md.
--
-- Ship only after the code removal (which stops referencing this table in
-- cleanupOldSnapshots/SNAPSHOT_TABLE_SPECS) has been fully rolled out to all replicas.
-- scripts/migrate.ts runs at pod startup and production has multiple replicas, so running
-- this DROP TABLE before that rollout completes can make an old replica's periodic cleanup
-- fail with "relation \"github_commit_on_branch_raw_snapshots\" does not exist".

DROP TABLE IF EXISTS github_commit_on_branch_raw_snapshots;
