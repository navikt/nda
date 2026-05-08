-- Role-based access control (RBAC) tables for section and team role assignments.
-- Both tables use soft-delete (deleted_at/deleted_by) for audit trail.
-- Partial unique indexes ensure only one active assignment per (user, scope, role).

-- Section-level roles: teknologileder, seksjonsleder, leveranseleder
CREATE TABLE section_role_assignments (
  id SERIAL PRIMARY KEY,
  nav_ident TEXT NOT NULL,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('teknologileder', 'seksjonsleder', 'leveranseleder')),
  assigned_by TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE UNIQUE INDEX uq_section_role_active
  ON section_role_assignments(nav_ident, section_id, role)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_section_roles_nav_ident
  ON section_role_assignments(nav_ident)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_section_roles_section_id
  ON section_role_assignments(section_id)
  WHERE deleted_at IS NULL;

-- Team-level roles: produktleder, utvikler
CREATE TABLE dev_team_role_assignments (
  id SERIAL PRIMARY KEY,
  nav_ident TEXT NOT NULL,
  dev_team_id INTEGER NOT NULL REFERENCES dev_teams(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('produktleder', 'utvikler')),
  assigned_by TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE UNIQUE INDEX uq_team_role_active
  ON dev_team_role_assignments(nav_ident, dev_team_id, role)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_team_roles_nav_ident
  ON dev_team_role_assignments(nav_ident)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_team_roles_dev_team_id
  ON dev_team_role_assignments(dev_team_id)
  WHERE deleted_at IS NULL;

-- Migrate existing user_dev_team_preference entries as 'utvikler' role.
-- ON CONFLICT handles any edge-case duplicates.
INSERT INTO dev_team_role_assignments (nav_ident, dev_team_id, role, assigned_by, assigned_at)
SELECT nav_ident, dev_team_id, 'utvikler', 'migration', updated_at
FROM user_dev_team_preference
ON CONFLICT (nav_ident, dev_team_id, role) WHERE deleted_at IS NULL DO NOTHING;
