-- Restructure user identity model:
-- - Introduce `users` table with nav_ident as primary key
-- - Introduce `user_github_accounts` table (1-to-many: one user can have multiple GitHub accounts)
-- - Migrate existing user_mappings data into the new tables
-- - Rename user_mappings to user_mappings_legacy (kept for one release cycle as rollback safety net)

-- ─── New tables ───────────────────────────────────────────────────────────────

CREATE TABLE users (
  nav_ident        TEXT PRIMARY KEY CHECK (nav_ident = UPPER(nav_ident)),
  display_name     TEXT,
  nav_email        TEXT,
  slack_member_id  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       TEXT
);

CREATE INDEX idx_users_slack       ON users(slack_member_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_email       ON users(nav_email)       WHERE deleted_at IS NULL;
CREATE INDEX idx_users_active      ON users(nav_ident)       WHERE deleted_at IS NULL;

-- Accounts without a nav_ident are "unlinked" deployers discovered from
-- deployment history but never mapped to a NAV identity.
CREATE TABLE user_github_accounts (
  id                      SERIAL PRIMARY KEY,
  nav_ident               TEXT REFERENCES users(nav_ident) ON DELETE SET NULL,
  github_username         TEXT NOT NULL UNIQUE CHECK (github_username = LOWER(github_username)),
  display_github_username TEXT CHECK (
    display_github_username IS NULL OR LOWER(display_github_username) = github_username
  ),
  display_name            TEXT,  -- display name for unlinked accounts (nav_ident IS NULL)
  is_primary              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,
  deleted_by              TEXT
);

CREATE INDEX idx_user_github_nav_ident ON user_github_accounts(nav_ident)       WHERE deleted_at IS NULL;
CREATE INDEX idx_user_github_username  ON user_github_accounts(github_username)  WHERE deleted_at IS NULL;

-- Create trigger function if it doesn't already exist (defined in schema.sql for fresh installs;
-- migrations-only environments need it here).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_github_accounts_updated_at
  BEFORE UPDATE ON user_github_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Migrate data ─────────────────────────────────────────────────────────────

-- Populate users from all user_mappings rows that have a nav_ident.
INSERT INTO users (nav_ident, display_name, nav_email, slack_member_id, created_at, updated_at, deleted_at, deleted_by)
SELECT nav_ident, display_name, nav_email, slack_member_id, created_at, updated_at, deleted_at, deleted_by
FROM user_mappings
WHERE nav_ident IS NOT NULL
ON CONFLICT (nav_ident) DO NOTHING;

-- Populate github accounts from all user_mappings rows.
-- Rows without nav_ident become "unlinked" accounts; display_name is carried
-- over so historical deployments still resolve a display name.
INSERT INTO user_github_accounts (
  nav_ident, github_username, display_github_username, display_name,
  created_at, updated_at, deleted_at, deleted_by
)
SELECT
  nav_ident,
  github_username,
  display_github_username,
  CASE WHEN nav_ident IS NULL THEN display_name ELSE NULL END,
  created_at,
  updated_at,
  deleted_at,
  deleted_by
FROM user_mappings
ON CONFLICT (github_username) DO NOTHING;

-- ─── Enforce is_primary uniqueness ────────────────────────────────────────────

-- For any nav_ident with multiple active primary accounts (possible after migration),
-- keep the most recently updated one as primary and demote the rest.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY nav_ident
      ORDER BY updated_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM user_github_accounts
  WHERE nav_ident IS NOT NULL
    AND is_primary = TRUE
    AND deleted_at IS NULL
)
UPDATE user_github_accounts
SET is_primary = FALSE, updated_at = NOW()
FROM ranked
WHERE user_github_accounts.id = ranked.id
  AND ranked.rn > 1;

-- Unique index: at most one active primary GitHub account per nav_ident.
CREATE UNIQUE INDEX idx_user_github_primary
  ON user_github_accounts(nav_ident)
  WHERE is_primary = TRUE AND deleted_at IS NULL;

-- ─── Rename old table ─────────────────────────────────────────────────────────

-- Keep the original table for one release cycle as a rollback safety net.
-- It can be dropped in a future migration once the deployment is confirmed stable.
ALTER TABLE user_mappings RENAME TO user_mappings_legacy;
