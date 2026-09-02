-- dev_team_application_groups was never populated by any production code
-- path (only integration tests inserted rows via raw SQL). Confirmed empty
-- in production before dropping. Step 2 of the application_groups
-- deprecation plan.

DROP INDEX IF EXISTS idx_dev_team_application_groups_active;
DROP TABLE IF EXISTS dev_team_application_groups;
