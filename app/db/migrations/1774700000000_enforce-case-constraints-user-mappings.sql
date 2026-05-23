-- Normalize existing data and add CHECK constraints to enforce casing.
-- github_username must be stored lowercase; nav_ident must be stored uppercase.

-- Step 1: Deduplicate rows that would collide after lowercasing github_username.
-- This is unlikely to occur in practice since upsertUserMapping has always
-- lowercased usernames, but we handle it defensively. Deleting a duplicate
-- mapping has no impact on data consistency elsewhere — deployments reference
-- deployer_username (not a FK to user_mappings), and display-name resolution
-- will continue to work via the surviving row.
--
-- Uses DISTINCT ON to keep one row per LOWER(github_username) group, preferring:
--   1. Active rows (deleted_at IS NULL) over soft-deleted
--   2. Already-lowercase form over mixed-case
--   3. Lowest ctid as final tiebreaker
DELETE FROM user_mappings
WHERE ctid NOT IN (
  SELECT DISTINCT ON (LOWER(github_username)) ctid
  FROM user_mappings
  ORDER BY LOWER(github_username),
           (deleted_at IS NULL) DESC,
           (github_username = LOWER(github_username)) DESC,
           ctid ASC
);

-- Step 2: Normalize any remaining rows that violate the convention.
UPDATE user_mappings
SET github_username = LOWER(github_username)
WHERE github_username != LOWER(github_username);

UPDATE user_mappings
SET nav_ident = UPPER(nav_ident)
WHERE nav_ident IS NOT NULL AND nav_ident != UPPER(nav_ident);

-- Step 3: Add CHECK constraints to prevent future violations.
ALTER TABLE user_mappings
  ADD CONSTRAINT chk_github_username_lower CHECK (github_username = LOWER(github_username));

ALTER TABLE user_mappings
  ADD CONSTRAINT chk_nav_ident_upper CHECK (nav_ident IS NULL OR nav_ident = UPPER(nav_ident));
