-- Normalize nav_ident to uppercase in user_mappings.
-- nav_ident is always stored as uppercase everywhere else (role_assignments, JWT claims
-- from Entra ID). Normalizing here allows plain equality joins instead of UPPER() on
-- both sides, enabling existing indexes to be used.

UPDATE user_mappings
SET nav_ident = UPPER(nav_ident)
WHERE nav_ident IS NOT NULL
  AND nav_ident != UPPER(nav_ident);

-- Add a partial index on nav_ident for the common JOIN pattern:
--   user_mappings um ON um.nav_ident = r.nav_ident AND um.deleted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_user_mappings_nav_ident_active
  ON user_mappings(nav_ident)
  WHERE deleted_at IS NULL;
