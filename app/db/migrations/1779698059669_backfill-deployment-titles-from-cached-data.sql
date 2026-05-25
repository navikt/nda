-- Backfill missing deployment titles from already-cached data.
--
-- Deployments created before the detectedTitle feature (PR #215) have a NULL
-- title when no PR was found (e.g. unauthorized_branch deployments). The new
-- verification logic derives a title from the first commit message at
-- verification time going forward, but historical rows need a one-time
-- backfill from the data already stored in the database.
--
-- Three passes, in priority order (each pass only touches rows still NULL
-- after the previous one):
--
-- 1. github_pr_data->>'title'     — PR title already stored as JSON
-- 2. unverified_commits->0->>'message'  — first unverified commit in JSON
-- 3. github_compare_snapshots     — first commit in the compare cache
--
-- All three passes take only the first line of the message, trim it, and
-- cap it at 500 chars to match the VARCHAR(500) column limit.

-- Pass 1: backfill from stored PR data
UPDATE deployments
SET title = LEFT(TRIM(github_pr_data->>'title'), 500)
WHERE title IS NULL
  AND github_pr_data IS NOT NULL
  AND TRIM(github_pr_data->>'title') != '';

-- Pass 2: backfill from stored unverified commits (first commit, first line)
UPDATE deployments
SET title = LEFT(TRIM(SPLIT_PART(unverified_commits->0->>'message', E'\n', 1)), 500)
WHERE title IS NULL
  AND unverified_commits IS NOT NULL
  AND jsonb_array_length(unverified_commits) > 0
  AND TRIM(SPLIT_PART(unverified_commits->0->>'message', E'\n', 1)) != '';

-- Pass 3: backfill from github_compare_snapshots (first commit, first line).
-- Uses DISTINCT ON to pick the most recently fetched snapshot per head_sha.
-- Only snapshots that include a 'commits' array are used.
UPDATE deployments d
SET title = LEFT(
  TRIM(SPLIT_PART(gcs.data->'commits'->0->>'message', E'\n', 1)),
  500
)
FROM (
  SELECT DISTINCT ON (head_sha)
    head_sha,
    data
  FROM github_compare_snapshots
  WHERE head_sha IN (SELECT commit_sha FROM deployments WHERE title IS NULL)
    AND data ? 'commits'
    AND jsonb_array_length(data->'commits') > 0
  ORDER BY head_sha, fetched_at DESC
) gcs
WHERE d.commit_sha = gcs.head_sha
  AND d.title IS NULL
  AND TRIM(SPLIT_PART(gcs.data->'commits'->0->>'message', E'\n', 1)) != '';
