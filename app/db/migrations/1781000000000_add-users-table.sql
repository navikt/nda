-- Step 1 of nav_ident migration: add the `users` table.
--
-- The table will be populated by the scripts/populate-users.ts script
-- (which calls the MS Graph API to fetch display_name and nav_email).
-- Until that script has run, upsertUserMapping dual-writes to both
-- user_mappings and users so new data is kept in sync.

CREATE TABLE IF NOT EXISTS users (
  nav_ident    TEXT PRIMARY KEY CHECK (nav_ident ~ '^[A-Z][0-9]{6}$'),
  display_name TEXT NOT NULL,
  nav_email    TEXT NOT NULL,
  slack_member_id TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ NULL,
  deleted_by   TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_nav_email ON users(nav_email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(nav_ident) WHERE deleted_at IS NULL;
