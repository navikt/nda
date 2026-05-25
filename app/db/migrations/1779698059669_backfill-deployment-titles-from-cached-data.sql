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
-- 1. github_pr_data->>'title'          — PR title already stored as JSON
-- 2. unverified_commits->0->>'message' — first unverified commit in JSON
-- 3. github_compare_snapshots          — first commit in the compare cache
--
-- Each pass strips whitespace including carriage returns and newlines
-- (BTRIM with E' \t\r\n' to match JS .trim()) and caps at 500 chars (VARCHAR(500) column limit).
-- Pass 1 uses the PR title as-is (PR titles are single-line by convention).
-- Passes 2 and 3 extract only the first line of the commit message (SPLIT_PART on E'\n').

-- Pass 1: backfill from stored PR data
UPDATE deployments
SET title = LEFT(BTRIM(github_pr_data->>'title', E' \t\r\n'), 500)
WHERE title IS NULL
  AND github_pr_data IS NOT NULL
  AND BTRIM(github_pr_data->>'title', E' \t\r\n') != '';

-- Pass 2: backfill from stored unverified commits (first commit, first line)
UPDATE deployments
SET title = LEFT(BTRIM(SPLIT_PART(unverified_commits->0->>'message', E'\n', 1), E' \t\r\n'), 500)
WHERE title IS NULL
  AND unverified_commits IS NOT NULL
  AND jsonb_array_length(unverified_commits) > 0
  AND BTRIM(SPLIT_PART(unverified_commits->0->>'message', E'\n', 1), E' \t\r\n') != '';

-- Pass 3 (backfill from github_compare_snapshots) is intentionally omitted here.
-- It is available as a manual admin action on /admin/data-mismatches to avoid
-- holding a startup lock while joining against a potentially large cache table.
