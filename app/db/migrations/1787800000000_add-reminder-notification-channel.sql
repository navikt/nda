-- Add a dedicated Slack channel for approval reminder notifications,
-- separate from the approval/deploy notification channels.
ALTER TABLE monitored_applications
ADD COLUMN IF NOT EXISTS reminder_channel_id TEXT;

COMMENT ON COLUMN monitored_applications.reminder_channel_id IS 'Slack channel for reminder notifications about unapproved deployments';

-- Reminders are not tied to a single deployment, so slack_notifications needs
-- a direct link to the monitored application for reminder history lookups.
ALTER TABLE slack_notifications
ADD COLUMN IF NOT EXISTS monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_slack_notifications_monitored_app
ON slack_notifications(monitored_app_id)
WHERE monitored_app_id IS NOT NULL;

COMMENT ON COLUMN slack_notifications.monitored_app_id IS 'Monitored application this notification belongs to (used for reminders, which have no single deployment)';

-- Allow the new 'reminder' notification type
ALTER TABLE slack_notifications DROP CONSTRAINT IF EXISTS slack_notifications_notification_type_check;
ALTER TABLE slack_notifications ADD CONSTRAINT slack_notifications_notification_type_check
  CHECK (notification_type IN ('approval', 'deploy', 'reminder'));
