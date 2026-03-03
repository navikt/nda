-- Migration: Backfill missing deployment titles
-- Up
-- Deployments verified by V2 that have a PR get title from github_pr_data.
-- Direct pushes (no PR) get title from first unverified commit message.

UPDATE deployments
SET title = github_pr_data->>'title'
WHERE title IS NULL
  AND github_pr_data IS NOT NULL
  AND github_pr_data->>'title' IS NOT NULL
  AND github_pr_data->>'title' != '';

UPDATE deployments
SET title = unverified_commits->0->>'message'
WHERE title IS NULL
  AND unverified_commits IS NOT NULL
  AND jsonb_array_length(unverified_commits) > 0
  AND unverified_commits->0->>'message' IS NOT NULL;

-- Down
-- No rollback needed: titles are additive and COALESCE-safe
