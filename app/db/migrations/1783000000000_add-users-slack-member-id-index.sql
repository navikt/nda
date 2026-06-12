-- Index on users.slack_member_id to support fast lookups by Slack ID.
-- Partial index excludes deleted rows (the only lookup that matters is active users).
CREATE INDEX IF NOT EXISTS idx_users_slack_member_id
  ON users (slack_member_id)
  WHERE slack_member_id IS NOT NULL AND deleted_at IS NULL;
