import { BellIcon, CheckmarkCircleIcon, ExclamationmarkTriangleIcon, XMarkOctagonIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Detail, Hide, HStack, Show, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import styles from '../styles/common.module.css'

interface AppStats {
  total: number
  without_four_eyes: number
  pending_verification: number
}

export interface AppCardData {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  active_repo: string | null
  stats: AppStats
  alertCount: number
  siblingEnvironments?: string[]
}

function getStatusTag(appStats: AppStats) {
  if (appStats.without_four_eyes > 0) {
    const label = appStats.without_four_eyes === 1 ? 'mangel' : 'mangler'
    return (
      <Tag data-color="danger" variant="outline" size="small" icon={<XMarkOctagonIcon aria-hidden />}>
        {appStats.without_four_eyes} {label}
      </Tag>
    )
  }
  if (appStats.pending_verification > 0) {
    return (
      <Tag data-color="warning" variant="outline" size="small" icon={<ExclamationmarkTriangleIcon aria-hidden />}>
        {appStats.pending_verification} venter
      </Tag>
    )
  }
  if (appStats.total === 0) {
    return (
      <Tag data-color="warning" variant="outline" size="small" icon={<ExclamationmarkTriangleIcon aria-hidden />}>
        Ingen data
      </Tag>
    )
  }
  return (
    <Tag data-color="success" variant="outline" size="small" icon={<CheckmarkCircleIcon aria-hidden />}>
      OK
    </Tag>
  )
}

function getAppUrl(app: { team_slug: string; environment_name: string; app_name: string }) {
  return `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`
}

interface AppCardProps {
  app: AppCardData
  showEnvironment?: boolean
}

export function AppCard({ app, showEnvironment = true }: AppCardProps) {
  const appUrl = getAppUrl(app)
  const environments = app.siblingEnvironments
    ? [app.environment_name, ...app.siblingEnvironments]
    : [app.environment_name]

  return (
    <Box padding="space-16" background="raised" className={styles.stackedListItem}>
      <VStack gap="space-12">
        {/* First row: App name, environment (desktop), alert indicator, status tag */}
        <HStack gap="space-8" align="center" justify="space-between" wrap>
          <HStack gap="space-12" align="center" style={{ flex: 1 }}>
            <Link to={appUrl}>
              <BodyShort weight="semibold">{app.app_name}</BodyShort>
            </Link>
            {showEnvironment && (
              <Show above="md">
                <HStack gap="space-4">
                  {environments.map((env) => (
                    <Tag key={env} variant="neutral" size="xsmall">
                      {env}
                    </Tag>
                  ))}
                </HStack>
              </Show>
            )}
          </HStack>
          <HStack gap="space-8" align="center">
            {app.alertCount > 0 && (
              <Link to={`${appUrl}#varsler`} style={{ textDecoration: 'none' }}>
                <Tag data-color="danger" variant="moderate" size="xsmall" icon={<BellIcon aria-hidden />}>
                  {app.alertCount}
                </Tag>
              </Link>
            )}
            {app.stats.without_four_eyes > 0 ? (
              <Link to={`${appUrl}/deployments?status=not_approved&period=all`} style={{ textDecoration: 'none' }}>
                {getStatusTag(app.stats)}
              </Link>
            ) : (
              getStatusTag(app.stats)
            )}
          </HStack>
        </HStack>

        {/* Environment on mobile */}
        {showEnvironment && (
          <Hide above="md">
            <HStack gap="space-4">
              {environments.map((env) => (
                <Tag key={env} variant="neutral" size="xsmall">
                  {env}
                </Tag>
              ))}
            </HStack>
          </Hide>
        )}

        {/* Repository row */}
        <Detail textColor="subtle">
          {app.active_repo ? (
            <a href={`https://github.com/${app.active_repo}`} target="_blank" rel="noopener noreferrer">
              {app.active_repo}
            </a>
          ) : (
            '(ingen aktivt repo)'
          )}
        </Detail>
      </VStack>
    </Box>
  )
}
