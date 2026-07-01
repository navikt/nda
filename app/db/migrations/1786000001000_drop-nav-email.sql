ALTER TABLE users DROP COLUMN IF EXISTS nav_email;
DROP INDEX IF EXISTS idx_users_nav_email;
