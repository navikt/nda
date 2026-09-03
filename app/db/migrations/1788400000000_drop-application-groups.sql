-- Step 7b of the application_groups deprecation plan. All display and
-- verification-propagation logic was migrated in PR #640 to the repo-based
-- monorepo model (application_repositories / monorepo.server.ts). No code
-- reads application_groups or monitored_applications.application_group_id
-- any more (confirmed by repo-wide search before writing this migration).

ALTER TABLE monitored_applications
  DROP COLUMN IF EXISTS application_group_id;

DROP INDEX IF EXISTS idx_monitored_apps_group;
DROP INDEX IF EXISTS application_groups_active_name_idx;
DROP TABLE IF EXISTS application_groups;
