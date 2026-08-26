import { Tag } from '@navikt/ds-react'

export type SlackNotificationType = 'approval' | 'deploy'

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
