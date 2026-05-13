-- Add 'tech_lead' to the allowed team roles.
-- tech_lead has the same permissions as produktleder (team leader role).

-- Drop all CHECK constraints on the role column (name may be auto-generated).
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
    WHERE con.conrelid = 'dev_team_role_assignments'::regclass
      AND con.contype = 'c'
      AND att.attname = 'role'
  LOOP
    EXECUTE format('ALTER TABLE dev_team_role_assignments DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE dev_team_role_assignments
  ADD CONSTRAINT dev_team_role_assignments_role_check
  CHECK (role IN ('produktleder', 'tech_lead', 'utvikler'));
