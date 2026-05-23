-- Add display_github_username to preserve original GitHub casing for display.
-- The primary github_username column remains lowercase for reliable JOINs and
-- lookups, while display_github_username stores the casing the user sees on
-- GitHub (e.g. "Andilun" vs "andilun").

ALTER TABLE user_mappings
  ADD COLUMN display_github_username VARCHAR(255);

-- Populate from the most recent deployment for each user, which has the
-- casing GitHub actually uses. Uses DISTINCT ON to pick one row per
-- lowercase username, ordered by newest deployment first.
UPDATE user_mappings um
SET display_github_username = sub.deployer_username
FROM (
  SELECT DISTINCT ON (LOWER(deployer_username))
    LOWER(deployer_username) AS lower_username,
    deployer_username
  FROM deployments
  WHERE deployer_username IS NOT NULL AND deployer_username != ''
  ORDER BY LOWER(deployer_username), created_at DESC
) sub
WHERE um.github_username = sub.lower_username;

-- For mappings without any deployments, fall back to the lowercase value.
UPDATE user_mappings
SET display_github_username = github_username
WHERE display_github_username IS NULL;

-- Ensure future rows always have a display username.
ALTER TABLE user_mappings
  ALTER COLUMN display_github_username SET NOT NULL;
