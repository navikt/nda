-- Application groups: link monitored_applications that represent the same
-- logical app across multiple NAIS clusters or teams.
CREATE TABLE IF NOT EXISTS application_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE monitored_applications
  ADD COLUMN IF NOT EXISTS application_group_id INTEGER REFERENCES application_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_monitored_apps_group ON monitored_applications(application_group_id)
  WHERE application_group_id IS NOT NULL;
