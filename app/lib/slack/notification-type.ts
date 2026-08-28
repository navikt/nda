export const SLACK_NOTIFICATION_TYPES = ['approval', 'deploy', 'reminder'] as const

export type SlackNotificationType = (typeof SLACK_NOTIFICATION_TYPES)[number]
