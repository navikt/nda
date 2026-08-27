export const SLACK_CONFIG_SETTING_KEYS = ['slack_notifications_enabled', 'slack_deploy_notify_enabled'] as const

export type SlackConfigSettingKey = (typeof SLACK_CONFIG_SETTING_KEYS)[number]

export const SLACK_CHANNEL_INVITE_HINT =
  'Kanal-ID (f.eks. C01234567) eller kanalnavn (f.eks. #min-kanal). NDA-appen i Slack må inviteres som medlem i kanalen for å kunne sende meldinger dit (/invite @nda).'
