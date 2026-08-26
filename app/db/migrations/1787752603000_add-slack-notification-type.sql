-- Distinguish approval (four-eyes review) notifications from deploy notifications
-- so the "Slack-kommunikasjon" history page can show both message types.

ALTER TABLE slack_notifications
ADD COLUMN IF NOT EXISTS notification_type TEXT NOT NULL DEFAULT 'approval';

COMMENT ON COLUMN slack_notifications.notification_type IS 'Type of notification: approval (four-eyes review) or deploy (new deployment)';
