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

  return (
    <Tag data-color="warning" variant="moderate" size="xsmall">
      Godkjenningsvarsel
    </Tag>
  )
}

export function ConfigChangeTag() {
  return (
    <Tag data-color="neutral" variant="strong" size="xsmall">
      Konfigurasjon
    </Tag>
  )
}
