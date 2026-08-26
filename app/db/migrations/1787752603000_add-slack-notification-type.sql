-- Distinguish approval (four-eyes review) notifications from deploy notifications
-- so the "Slack-kommunikasjon" history page can show both message types.

ALTER TABLE slack_notifications
ADD COLUMN IF NOT EXISTS notification_type TEXT NOT NULL DEFAULT 'approval';

ALTER TABLE slack_notifications DROP CONSTRAINT IF EXISTS slack_notifications_notification_type_check;
ALTER TABLE slack_notifications ADD CONSTRAINT slack_notifications_notification_type_check
  CHECK (notification_type IN ('approval', 'deploy'));

COMMENT ON COLUMN slack_notifications.notification_type IS 'Type of notification: approval (four-eyes review) or deploy (new deployment)';
