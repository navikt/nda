import { LinkBrokenIcon, LinkIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Button, Detail, Hide, HStack, Show, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { MethodTag, StatusTag } from '~/components/deployment-tags'
import { ErrorReasonWithLink } from '~/components/ErrorReasonWithLink'
import { ExternalLink } from '~/components/ExternalLink'
import { UserName } from '~/components/UserName'
import type { FourEyesStatus } from '~/lib/four-eyes-status'
import type { UserLookupMap } from '~/lib/user-display'
import styles from '~/styles/common.module.css'

interface DeploymentData {
  id: number
  created_at: string | Date
  title: string | null
  deployer_username: string | null
  commit_sha: string | null
  detected_github_owner: string | null
  detected_github_repo_name: string | null
  github_pr_number: number | null
  github_pr_url: string | null
  github_pr_data: {
    creator?: { username?: string } | null
    merged_by?: { username?: string } | null
    [key: string]: unknown
  } | null
  four_eyes_status: string
  has_goal_link?: boolean
  team_slug: string
  environment_name: string
  app_name: string
}

interface DeploymentRowProps {
  deployment: DeploymentData
  userMappings: UserLookupMap
  errorReason?: string
  showEnv?: boolean
  showApp?: boolean
  currentEnv?: string
  searchParams?: URLSearchParams
}

export function DeploymentRow({
  deployment,
  userMappings,
  errorReason,
  showEnv,
  showApp,
  currentEnv,
  searchParams,
}: DeploymentRowProps) {
  const searchStr = searchParams?.toString()
  const detailUrl = `/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}/deployments/${deployment.id}${searchStr ? `?${searchStr}` : ''}`

  return (
    <Box padding="space-20" background="raised" className={styles.stackedListItem}>
      <VStack gap="space-12">
        {/* First row: Time, Title (on desktop), Tags (right-aligned) */}
        <HStack gap="space-8" align="center" justify="space-between">
          <HStack gap="space-8" align="center" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <BodyShort weight="semibold" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {new Date(deployment.created_at).toLocaleString('no-NO', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </BodyShort>
            {showEnv && deployment.environment_name !== currentEnv && (
              <Tag variant="neutral" size="xsmall">
                {deployment.environment_name}
              </Tag>
            )}
            {showApp && (
              <Tag variant="neutral" size="xsmall">
                {deployment.app_name}
              </Tag>
            )}
            {/* Title on desktop - inline with time */}
            <Show above="md">
              {deployment.title && (
                <BodyShort className={styles.truncateText} style={{ flex: 1, minWidth: 0 }}>
                  {deployment.title}
                </BodyShort>
              )}
            </Show>
          </HStack>
          <HStack gap="space-8" style={{ flexShrink: 0 }}>
            <MethodTag
              github_pr_number={deployment.github_pr_number}
              four_eyes_status={deployment.four_eyes_status as FourEyesStatus}
            />
            <StatusTag four_eyes_status={deployment.four_eyes_status as FourEyesStatus} />
            {deployment.has_goal_link ? (
              <Tag variant="info" size="xsmall" icon={<LinkIcon aria-hidden />}>
                Koblet
              </Tag>
            ) : (
              <Tag variant="neutral" size="xsmall" icon={<LinkBrokenIcon aria-hidden />}>
                Mangler
              </Tag>
            )}
          </HStack>
        </HStack>

        {/* Title on mobile - separate line */}
        <Hide above="md">
          {deployment.title && <BodyShort className={styles.truncateText}>{deployment.title}</BodyShort>}
        </Hide>

        {/* Second row: Details and View button */}
        <HStack gap="space-16" align="center" justify="space-between" wrap>
          <HStack gap="space-16" wrap>
            <Detail textColor="subtle">
              <UserName username={deployment.deployer_username} userMappings={userMappings} />
            </Detail>
            {deployment.github_pr_data?.creator?.username &&
              deployment.github_pr_data.creator.username !== deployment.deployer_username && (
                <Detail textColor="subtle">
                  PR: <UserName username={deployment.github_pr_data.creator.username} userMappings={userMappings} />
                </Detail>
              )}
            {deployment.github_pr_data?.merged_by?.username &&
              deployment.github_pr_data.merged_by.username !== deployment.deployer_username && (
                <Detail textColor="subtle">
                  Merge:{' '}
                  <UserName username={deployment.github_pr_data.merged_by.username} userMappings={userMappings} />
                </Detail>
              )}
            <Detail textColor="subtle">
              {deployment.commit_sha ? (
                <ExternalLink
                  href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                  style={{ fontFamily: 'monospace' }}
                >
                  {deployment.commit_sha.substring(0, 7)}
                </ExternalLink>
              ) : (
                '(ukjent)'
              )}
            </Detail>
            {deployment.github_pr_number && (
              <Detail textColor="subtle">
                {deployment.github_pr_url ? (
                  <ExternalLink href={deployment.github_pr_url}>#{deployment.github_pr_number}</ExternalLink>
                ) : (
                  <>#{deployment.github_pr_number}</>
                )}
              </Detail>
            )}
          </HStack>
          <Button as={Link} to={detailUrl} variant="tertiary" size="small">
            Vis
          </Button>
        </HStack>

        {/* Error reason for deployments with error status */}
        {errorReason && (
          <ErrorReasonWithLink
            errorReason={errorReason}
            githubOwner={deployment.detected_github_owner}
            githubRepoName={deployment.detected_github_repo_name}
          />
        )}
      </VStack>
    </Box>
  )
}
