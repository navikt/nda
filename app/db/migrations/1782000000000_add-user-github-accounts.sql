-- Step 3 of expand/contract migration: add user_github_accounts table.
-- Links GitHub usernames to users (nav_ident). Replaces the github_username/nav_ident
-- relationship in user_mappings. Allows multiple GitHub accounts per user.

CREATE TABLE IF NOT EXISTS user_github_accounts (
  github_username        TEXT PRIMARY KEY CHECK (github_username = LOWER(github_username)),
  display_github_username TEXT CHECK (
    display_github_username IS NULL OR LOWER(display_github_username) = github_username
  ),
  nav_ident              TEXT NOT NULL REFERENCES users(nav_ident),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ NULL,
  deleted_by             TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_github_accounts_nav_ident
  ON user_github_accounts(nav_ident);

CREATE INDEX IF NOT EXISTS idx_user_github_accounts_active
  ON user_github_accounts(github_username) WHERE deleted_at IS NULL;

-- updated_at is maintained explicitly in upsert queries (no trigger needed)

-- Backfill from user_mappings: seed all active mappings that already have
-- a matching users row (those with nav_ident present in both tables).
INSERT INTO user_github_accounts (github_username, display_github_username, nav_ident)
SELECT um.github_username, um.display_github_username, um.nav_ident
FROM user_mappings um
INNER JOIN users u ON u.nav_ident = um.nav_ident AND u.deleted_at IS NULL
WHERE um.deleted_at IS NULL
  AND um.nav_ident IS NOT NULL
ON CONFLICT (github_username) DO UPDATE SET
  nav_ident               = EXCLUDED.nav_ident,
  display_github_username = COALESCE(EXCLUDED.display_github_username, user_github_accounts.display_github_username),
  updated_at              = NOW(),
  deleted_at              = NULL,
  deleted_by              = NULL;
