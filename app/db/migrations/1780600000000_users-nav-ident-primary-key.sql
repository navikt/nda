-- Restructure user identity model:
-- - Introduce `users` table with nav_ident as primary key
-- - Introduce `user_github_accounts` table (1-to-many: one user can have multiple GitHub accounts)
-- - Migrate existing user_mappings data into the new tables
-- - Rename user_mappings to user_mappings_legacy (kept for one release cycle as rollback safety net)

-- ─── New tables ───────────────────────────────────────────────────────────────

CREATE TABLE users (
  nav_ident        TEXT PRIMARY KEY CHECK (nav_ident = UPPER(nav_ident) AND nav_ident ~ '^[A-Z][0-9]{6}$'),
  display_name     TEXT NOT NULL,
  nav_email        TEXT NOT NULL,
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
  github_username         TEXT NOT NULL UNIQUE CHECK (
    github_username = LOWER(github_username)
    AND github_username ~ '^[a-z0-9][a-z0-9-]*$'
    AND github_username !~ '--'
    AND github_username !~ '-$'
    AND length(github_username) BETWEEN 1 AND 39
  ),
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

-- ─── Migrate data ─────────────────────────────────────────────────────────────

-- Populate users from all user_mappings rows that have a nav_ident.
-- DISTINCT ON (nav_ident) picks the most recently updated row per nav_ident
-- deterministically, avoiding the non-determinism of ON CONFLICT DO NOTHING.
INSERT INTO users (nav_ident, display_name, nav_email, slack_member_id, created_at, updated_at, deleted_at, deleted_by)
SELECT DISTINCT ON (nav_ident) nav_ident, display_name, nav_email, slack_member_id, created_at, updated_at, deleted_at, deleted_by
FROM user_mappings
WHERE nav_ident IS NOT NULL
  AND nav_ident ~ '^[A-Z][0-9]{6}$'
  AND display_name IS NOT NULL
  AND nav_email IS NOT NULL
ORDER BY nav_ident, updated_at DESC NULLS LAST;

-- Populate github accounts from all user_mappings rows.
-- Rows without nav_ident become "unlinked" accounts; display_name is carried
-- over so historical deployments still resolve a display name.
INSERT INTO user_github_accounts (
  nav_ident, github_username, display_github_username, display_name,
  created_at, updated_at, deleted_at, deleted_by
)
SELECT
  CASE WHEN nav_ident ~ '^[A-Z][0-9]{6}$' THEN nav_ident ELSE NULL END,
  github_username,
  display_github_username,
  CASE WHEN nav_ident IS NULL THEN display_name ELSE NULL END,
  created_at,
  updated_at,
  deleted_at,
  deleted_by
FROM user_mappings
WHERE github_username ~ '^[a-z0-9][a-z0-9-]*$'
  AND github_username !~ '--'
  AND github_username !~ '-$'
  AND length(github_username) BETWEEN 1 AND 39
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
