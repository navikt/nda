import { CheckmarkIcon, ExclamationmarkTriangleIcon, XMarkIcon } from '@navikt/aksel-icons'
import { Tag } from '@navikt/ds-react'
import {
  type FourEyesStatus,
  isApprovedStatus,
  isLegacyStatus,
  isNotApprovedStatus,
  isPendingStatus,
  STATUS_DISPLAY,
} from '~/lib/four-eyes-status'

interface DeploymentTagProps {
  github_pr_number: number | null
  four_eyes_status: FourEyesStatus
}

export function MethodTag({
  github_pr_number,
  four_eyes_status,
}: Pick<DeploymentTagProps, 'github_pr_number' | 'four_eyes_status'>) {
  if (github_pr_number) {
    return (
      <Tag data-color="info" variant="outline" size="small">
        Pull Request
      </Tag>
    )
  }
  if (isLegacyStatus(four_eyes_status)) {
    return (
      <Tag data-color="neutral" variant="outline" size="small">
        Legacy
      </Tag>
    )
  }
  if (isPendingStatus(four_eyes_status)) {
    return (
      <Tag data-color="neutral" variant="outline" size="small">
        Ukjent
      </Tag>
    )
  }
  return (
    <Tag data-color="warning" variant="outline" size="small">
      Direct Push
    </Tag>
  )
}

export function StatusTag({ four_eyes_status }: Pick<DeploymentTagProps, 'four_eyes_status'>) {
  const display = STATUS_DISPLAY[four_eyes_status]

  const icon = isApprovedStatus(four_eyes_status) ? (
    <CheckmarkIcon aria-hidden />
  ) : isLegacyStatus(four_eyes_status) ? undefined : isNotApprovedStatus(four_eyes_status) ? (
    four_eyes_status === 'approved_pr_with_unreviewed' ? (
      <ExclamationmarkTriangleIcon aria-hidden />
    ) : (
      <XMarkIcon aria-hidden />
    )
  ) : undefined

  return (
    <Tag data-color={display.tagVariant} variant="outline" size="small" icon={icon}>
      {display.tagLabel}
    </Tag>
  )
}
