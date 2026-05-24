import {
  CheckmarkCircleIcon,
  ClockIcon,
  ExclamationmarkTriangleIcon,
  MinusCircleIcon,
  XMarkOctagonIcon,
} from '@navikt/aksel-icons'
import { BodyShort, Box, Button, CopyButton, Detail, Heading, HGrid, HStack, Tag, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { Link } from 'react-router'
import {
  type FourEyesStatus,
  getFourEyesStatusLabel,
  isApprovedStatus,
  isNotApprovedStatus,
  isPendingStatus,
} from '~/lib/four-eyes-status'

type DeploymentDetail = {
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
  if (isApprovedStatus(status)) {
    return <CheckmarkCircleIcon aria-hidden />
  }
  if (isPendingStatus(status)) {
    return <ClockIcon aria-hidden />
  }
  if (isNotApprovedStatus(status)) {
    return <XMarkOctagonIcon aria-hidden />
  }
  if (status === 'error') {
    return <ExclamationmarkTriangleIcon aria-hidden />
  }
  return <MinusCircleIcon aria-hidden />
}

function getStatusColor(status: FourEyesStatus): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (isApprovedStatus(status)) {
    return 'success'
  }
  if (isPendingStatus(status)) {
    return 'warning'
  }
  if (isNotApprovedStatus(status) || status === 'error') {
    return 'danger'
  }
  return 'neutral'
}

function DeploymentDetailPage({
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
      {/* Header with navigation */}
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

      {/* Overview Cards */}
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

      {/* Commit message */}
      <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-12">
          <Heading level="2" size="small">
            Commit
          </Heading>
          <BodyShort style={{ whiteSpace: 'pre-wrap' }}>{deployment.commit_message}</BodyShort>
        </VStack>
      </Box>

      {/* PR Data (if available) */}
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
                    .filter((r) => r.state === 'APPROVED')
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

      {/* Admin actions */}
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

const meta: Meta<typeof DeploymentDetailPage> = {
  title: 'Pages/DeploymentDetail',
  component: DeploymentDetailPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DeploymentDetailPage>

const baseDeployment: DeploymentDetail = {
  id: 123,
  commit_sha: 'abc123def456789012345678901234567890abcd',
  commit_message:
    'feat: Add new feature for pension calculation\n\nThis commit adds support for the new calculation model.',
  deployer_username: 'john-doe',
  deploy_started_at: '2026-02-08T10:30:00Z',
  four_eyes_status: 'approved',
  approval_source: 'pr_approval',
  github_pr_number: 42,
  github_pr_url: 'https://github.com/navikt/pensjon-pen/pull/42',
  detected_github_owner: 'navikt',
  detected_github_repo_name: 'pensjon-pen',
  github_pr_data: {
    title: 'feat: Add new feature for pension calculation',
    creator: { username: 'john-doe' },
    merger: { username: 'jane-smith' },
    reviewers: [
      { username: 'jane-smith', state: 'APPROVED', submitted_at: '2026-02-08T09:45:00Z' },
      { username: 'bob-wilson', state: 'APPROVED', submitted_at: '2026-02-08T10:15:00Z' },
    ],
  },
}

export const Approved: Story = {
  name: 'Godkjent',
  args: {
    deployment: baseDeployment,
    previousId: 122,
    nextId: 124,
    isAdmin: false,
  },
}

export const NotApproved: Story = {
  name: 'Ikke godkjent',
  args: {
    deployment: {
      ...baseDeployment,
      four_eyes_status: 'unverified_commits',
      approval_source: null,
    },
    previousId: 122,
    nextId: 124,
    isAdmin: true,
  },
}

export const Pending: Story = {
  name: 'Venter verifisering',
  args: {
    deployment: {
      ...baseDeployment,
      four_eyes_status: 'pending',
      approval_source: null,
    },
    previousId: null,
    nextId: 124,
    isAdmin: true,
  },
}

export const DirectPush: Story = {
  name: 'Direct Push (ingen PR)',
  args: {
    deployment: {
      ...baseDeployment,
      four_eyes_status: 'direct_push',
      github_pr_number: null,
      github_pr_url: null,
      github_pr_data: undefined,
      commit_message: 'hotfix: Emergency fix for production bug',
    },
    previousId: 122,
    nextId: null,
    isAdmin: true,
  },
}

export const ManuallyApproved: Story = {
  name: 'Manuelt godkjent',
  args: {
    deployment: {
      ...baseDeployment,
      four_eyes_status: 'manually_approved',
      approval_source: 'manual',
    },
    previousId: 122,
    nextId: 124,
    isAdmin: false,
  },
}
