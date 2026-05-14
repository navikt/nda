-- Backfill titles for manually_approved deployments that lost metadata
-- due to the bug where manual approval wiped title, github_pr_data,
-- github_pr_url, github_pr_number, and unverified_commits.
--
-- Uses three fallback sources (in priority order):
--   1. commits table (joined via commit_sha)
--   2. github_pr_snapshots metadata (via verification_runs → pr_snapshot_ids)
--   3. github_pr_snapshots metadata (via detected owner/repo + github_pr_number from verification_runs result)

-- Step 1: Fill title from commits table (commit message or original PR title)
UPDATE deployments d
SET title = COALESCE(c.original_pr_title, c.message)
FROM commits c
WHERE c.sha = d.commit_sha
  AND d.title IS NULL
  AND d.four_eyes_status = 'manually_approved'
  AND COALESCE(c.original_pr_title, c.message) IS NOT NULL;

-- Step 2: Fill title + github_pr_data from PR snapshots linked via verification_runs
-- The verification_runs table stores pr_snapshot_ids from each verification run.
-- We find the metadata snapshot and extract the PR title.
WITH snapshot_data AS (
  SELECT DISTINCT ON (vr.deployment_id)
    vr.deployment_id,
    ps.data->>'title' AS pr_title,
    ps.data AS pr_metadata,
    ps.pr_number,
    ps.owner,
    ps.repo
  FROM verification_runs vr
  CROSS JOIN LATERAL unnest(vr.pr_snapshot_ids) AS sid
  JOIN github_pr_snapshots ps ON ps.id = sid
  WHERE ps.data_type = 'metadata'
    AND ps.data->>'title' IS NOT NULL
    AND ps.data->>'title' != ''
  ORDER BY vr.deployment_id, vr.run_at DESC
)
UPDATE deployments d
SET
  title = sd.pr_title,
  github_pr_number = COALESCE(d.github_pr_number, sd.pr_number),
  github_pr_url = COALESCE(
    d.github_pr_url,
    'https://github.com/' || sd.owner || '/' || sd.repo || '/pull/' || sd.pr_number
  )
FROM snapshot_data sd
WHERE sd.deployment_id = d.id
  AND d.title IS NULL
  AND d.four_eyes_status = 'manually_approved';

-- Step 3: For any remaining, try to match via commit_sha → commits → original_pr_number → snapshots
WITH commit_pr AS (
  SELECT DISTINCT ON (d.id)
    d.id AS deployment_id,
    ps.data->>'title' AS pr_title,
    c.original_pr_number AS pr_number,
    d.detected_github_owner AS owner,
    d.detected_github_repo_name AS repo
  FROM deployments d
  JOIN commits c ON c.sha = d.commit_sha
  JOIN github_pr_snapshots ps
    ON ps.owner = d.detected_github_owner
    AND ps.repo = d.detected_github_repo_name
    AND ps.pr_number = c.original_pr_number
    AND ps.data_type = 'metadata'
  WHERE d.title IS NULL
    AND d.four_eyes_status = 'manually_approved'
    AND c.original_pr_number IS NOT NULL
    AND ps.data->>'title' IS NOT NULL
    AND ps.data->>'title' != ''
  ORDER BY d.id, ps.fetched_at DESC
)
UPDATE deployments d
SET
  title = cp.pr_title,
  github_pr_number = COALESCE(d.github_pr_number, cp.pr_number),
  github_pr_url = COALESCE(
    d.github_pr_url,
    'https://github.com/' || cp.owner || '/' || cp.repo || '/pull/' || cp.pr_number
  )
FROM commit_pr cp
WHERE cp.deployment_id = d.id
  AND d.title IS NULL;
