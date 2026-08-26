export const SLACK_CONFIG_SETTING_KEYS = ['slack_notifications_enabled', 'slack_deploy_notify_enabled'] as const

export type SlackConfigSettingKey = (typeof SLACK_CONFIG_SETTING_KEYS)[number]
