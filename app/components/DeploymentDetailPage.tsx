import {
  CheckmarkCircleIcon,
  ClockIcon,
  ExclamationmarkTriangleIcon,
  MinusCircleIcon,
  XMarkOctagonIcon,
} from '@navikt/aksel-icons'
import { BodyShort, Box, Button, CopyButton, Detail, Heading, HGrid, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import {
  type FourEyesStatus,
  getFourEyesStatusLabel,
  isApprovedStatus,
  isNotApprovedStatus,
  isPendingStatus,
} from '~/lib/four-eyes-status'

export type DeploymentDetail = {
  id: number
  commit_sha: string
  commit_message: string
  deployer_username: string | null
  deploy_started_at: string
  four_eyes_status: FourEyesStatus
  approval_source: string | null
  github_pr_number: number | null
  github_pr_url: string | null
  detected_github_owner: string
  detected_github_repo_name: string
  github_pr_data?: {
    title: string
    creator?: { username: string }
    merger?: { username: string }
    reviewers?: { username: string; state: string; submitted_at?: string }[]
  }
}

function getStatusIcon(status: FourEyesStatus) {
  if (isApprovedStatus(status)) return <CheckmarkCircleIcon aria-hidden />
  if (isPendingStatus(status)) return <ClockIcon aria-hidden />
  if (isNotApprovedStatus(status)) return <XMarkOctagonIcon aria-hidden />
  if (status === 'error' || status === 'repository_mismatch') return <ExclamationmarkTriangleIcon aria-hidden />
  return <MinusCircleIcon aria-hidden />
}

function getStatusColor(status: FourEyesStatus): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (isApprovedStatus(status)) return 'success'
  if (isPendingStatus(status)) return 'warning'
  if (isNotApprovedStatus(status) || status === 'error' || status === 'repository_mismatch') return 'danger'
  return 'neutral'
}

export function DeploymentDetailPage({
  deployment,
  previousId,
  nextId,
  isAdmin = false,
}: {
  deployment: DeploymentDetail
  previousId: number | null
  nextId: number | null
  isAdmin?: boolean
}) {
  const statusColor = getStatusColor(deployment.four_eyes_status)

  return (
    <VStack gap="space-32">
      <HStack gap="space-16" align="center" justify="space-between" wrap>
        <VStack gap="space-4">
          <HStack gap="space-8" align="center">
            <Heading level="1" size="medium">
              Deployment #{deployment.id}
            </Heading>
            <Tag variant="moderate" data-color={statusColor} icon={getStatusIcon(deployment.four_eyes_status)}>
              {getFourEyesStatusLabel(deployment.four_eyes_status)}
            </Tag>
          </HStack>
          <Detail textColor="subtle">{new Date(deployment.deploy_started_at).toLocaleString('no-NO')}</Detail>
        </VStack>

        <HStack gap="space-8">
          <Button variant="tertiary" size="small" disabled={!previousId}>
            ← Forrige
          </Button>
          <Button variant="tertiary" size="small" disabled={!nextId}>
            Neste →
          </Button>
        </HStack>
      </HStack>

      <HGrid gap="space-16" columns={{ xs: 1, md: 2, lg: 4 }}>
        <Box padding="space-16" borderRadius="8" background="sunken">
          <VStack gap="space-4">
            <Detail textColor="subtle">Deployer</Detail>
            {deployment.deployer_username ? (
              <Link to={`/users/${deployment.deployer_username}`}>
                <BodyShort weight="semibold">{deployment.deployer_username}</BodyShort>
              </Link>
            ) : (
              <BodyShort>(ukjent)</BodyShort>
            )}
          </VStack>
        </Box>

        <Box padding="space-16" borderRadius="8" background="sunken">
          <VStack gap="space-4">
            <Detail textColor="subtle">Commit</Detail>
            <HStack gap="space-8" align="center">
              <BodyShort style={{ fontFamily: 'monospace' }}>{deployment.commit_sha.substring(0, 7)}</BodyShort>
              <CopyButton copyText={deployment.commit_sha} size="xsmall" />
            </HStack>
          </VStack>
        </Box>

        <Box padding="space-16" borderRadius="8" background="sunken">
          <VStack gap="space-4">
            <Detail textColor="subtle">Repository</Detail>
            <BodyShort>
              {deployment.detected_github_owner}/{deployment.detected_github_repo_name}
            </BodyShort>
          </VStack>
        </Box>

        {deployment.github_pr_number && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">Pull Request</Detail>
              <BodyShort weight="semibold">#{deployment.github_pr_number}</BodyShort>
            </VStack>
          </Box>
        )}
      </HGrid>

      <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-12">
          <Heading level="2" size="small">
            Commit
          </Heading>
          <BodyShort style={{ whiteSpace: 'pre-wrap' }}>{deployment.commit_message}</BodyShort>
        </VStack>
      </Box>

      {deployment.github_pr_data && (
        <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-16">
            <Heading level="2" size="small">
              Pull Request
            </Heading>
            <BodyShort weight="semibold">{deployment.github_pr_data.title}</BodyShort>

            <HStack gap="space-24" wrap>
              {deployment.github_pr_data.creator && (
                <VStack gap="space-4">
                  <Detail textColor="subtle">Opprettet av</Detail>
                  <Link to={`/users/${deployment.github_pr_data.creator.username}`}>
                    {deployment.github_pr_data.creator.username}
                  </Link>
                </VStack>
              )}
              {deployment.github_pr_data.merger && (
                <VStack gap="space-4">
                  <Detail textColor="subtle">Merget av</Detail>
                  <Link to={`/users/${deployment.github_pr_data.merger.username}`}>
                    {deployment.github_pr_data.merger.username}
                  </Link>
                </VStack>
              )}
            </HStack>

            {deployment.github_pr_data.reviewers && deployment.github_pr_data.reviewers.length > 0 && (
              <VStack gap="space-8">
                <Detail textColor="subtle">Godkjent av</Detail>
                <HStack gap="space-8" wrap>
                  {deployment.github_pr_data.reviewers
                    .filter((reviewer) => reviewer.state === 'APPROVED')
                    .map((reviewer) => (
                      <Tag
                        key={reviewer.username}
                        size="small"
                        variant="moderate"
                        data-color="success"
                        icon={<CheckmarkCircleIcon aria-hidden />}
                      >
                        {reviewer.username}
                      </Tag>
                    ))}
                </HStack>
              </VStack>
            )}
          </VStack>
        </Box>
      )}

      {isAdmin && deployment.four_eyes_status !== 'approved' && (
        <Box padding="space-20" borderRadius="8" background="raised" borderColor="warning-subtle" borderWidth="1">
          <VStack gap="space-16">
            <Heading level="2" size="small">
              Admin-handlinger
            </Heading>
            <HStack gap="space-8">
              <Button variant="secondary" size="small">
                Re-verifiser
              </Button>
              <Button variant="primary" size="small">
                Godkjenn manuelt
              </Button>
            </HStack>
          </VStack>
        </Box>
      )}
    </VStack>
  )
}
