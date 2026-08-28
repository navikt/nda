import { Tag } from '@navikt/ds-react'
import type { SlackNotificationType } from '~/lib/slack/notification-type'

export type { SlackNotificationType }

export function NotificationTypeTag({ notificationType }: { notificationType: SlackNotificationType }) {
  if (notificationType === 'deploy') {
    return (
      <Tag data-color="info" variant="moderate" size="xsmall">
        Deployment-varsel
      </Tag>
    )
  }

  if (notificationType === 'reminder') {
    return (
      <Tag data-color="danger" variant="moderate" size="xsmall">
        Purrings-varsel
      </Tag>
    )
  }

  return (
    <Tag data-color="warning" variant="moderate" size="xsmall">
      Godkjenningsvarsel
    </Tag>
  )
}
