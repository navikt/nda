-- Add display_github_username to preserve original GitHub casing for display.
-- The primary github_username column remains lowercase for reliable JOINs and
-- lookups, while display_github_username stores the casing the user sees on
-- GitHub (e.g. "Andilun" vs "andilun").
--
-- Nullable: test helpers and legacy INSERTs that omit this column will get NULL.
-- The UI uses COALESCE(display_github_username, github_username) as fallback.

ALTER TABLE user_mappings
  ADD COLUMN display_github_username TEXT;

-- Populate from the most recent deployment for each user, which has the
-- casing GitHub actually uses. Uses a subquery with max(created_at) to avoid
-- a global sort on the deployments table.
UPDATE user_mappings um
SET display_github_username = d.deployer_username
FROM (
  SELECT deployer_username, LOWER(deployer_username) AS lower_username
  FROM deployments
  WHERE deployer_username IS NOT NULL AND deployer_username != ''
    AND (LOWER(deployer_username), created_at) IN (
      SELECT LOWER(deployer_username), MAX(created_at)
      FROM deployments
      WHERE deployer_username IS NOT NULL AND deployer_username != ''
      GROUP BY LOWER(deployer_username)
    )
) d
WHERE um.github_username = d.lower_username;

-- For mappings without any deployments, fall back to the lowercase value.
UPDATE user_mappings
SET display_github_username = github_username
WHERE display_github_username IS NULL;

-- Enforce invariant: display casing must match the canonical username.
ALTER TABLE user_mappings
  ADD CONSTRAINT chk_display_github_username_matches
  CHECK (display_github_username IS NULL OR LOWER(display_github_username) = github_username);
