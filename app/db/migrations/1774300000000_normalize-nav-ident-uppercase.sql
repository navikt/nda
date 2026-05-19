-- Normalize nav_ident to uppercase in user_mappings.
-- nav_ident is always stored as uppercase everywhere else (role_assignments, JWT claims
-- from Entra ID). Normalizing here allows plain equality joins instead of UPPER() on
-- both sides, enabling existing indexes to be used.

UPDATE user_mappings
SET nav_ident = UPPER(nav_ident)
WHERE nav_ident IS NOT NULL
  AND nav_ident != UPPER(nav_ident);
