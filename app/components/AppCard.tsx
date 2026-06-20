import {
  BellIcon,
  CheckmarkCircleIcon,
  ClockDashedIcon,
  ExclamationmarkTriangleIcon,
  LayersIcon,
  LinkBrokenIcon,
  PersonGroupIcon,
  XMarkOctagonIcon,
} from '@navikt/aksel-icons'
import { BodyShort, Box, Detail, Hide, HStack, Show, Tag, VStack } from '@navikt/ds-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import styles from '../styles/common.module.css'
import { ExternalLink } from './ExternalLink'

interface AppStats {
  total: number
  without_four_eyes: number
  pending_verification: number
  missing_goal_links?: number
  unmapped_deployers?: number
  baseline_action_count?: number
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
  groupName?: string
  groupApps?: { app_name: string; environment_name: string }[]
}

interface IssueBadgeProps {
  to?: string
  icon: ReactNode
  color: 'danger' | 'warning' | 'success' | 'neutral'
  variant?: 'outline' | 'moderate'
  children: ReactNode
}

function IssueBadge({ to, icon, color, variant = 'outline', children }: IssueBadgeProps) {
  const tag = (
    <Tag data-color={color} variant={variant} size="xsmall" icon={icon}>
      {children}
    </Tag>
  )
  if (to) {
    return (
      <Link to={to} style={{ textDecoration: 'none', display: 'flex' }}>
        {tag}
      </Link>
    )
  }
  return tag
}

function getStatusBadge(appStats: AppStats, links: { failedTo?: string; pendingTo?: string; okTo?: string }) {
  if (appStats.without_four_eyes > 0) {
    const label = appStats.without_four_eyes === 1 ? 'mangel' : 'mangler'
    return (
      <IssueBadge to={links.failedTo} icon={<XMarkOctagonIcon aria-hidden />} color="danger">
        {appStats.without_four_eyes} {label}
      </IssueBadge>
    )
  }
  if (appStats.pending_verification > 0) {
    return (
      <IssueBadge to={links.pendingTo} icon={<ExclamationmarkTriangleIcon aria-hidden />} color="warning">
        {appStats.pending_verification} venter
      </IssueBadge>
    )
  }
  if (appStats.total === 0) {
    return (
      <IssueBadge icon={<ExclamationmarkTriangleIcon aria-hidden />} color="warning">
        Ingen data
      </IssueBadge>
    )
  }
  return (
    <IssueBadge to={links.okTo} icon={<CheckmarkCircleIcon aria-hidden />} color="success">
      OK
    </IssueBadge>
  )
}

function getAppUrl(app: { team_slug: string; environment_name: string; app_name: string }) {
  return `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`
}

interface AppCardProps {
  app: AppCardData
  showEnvironment?: boolean
  appendSearchParams?: string
}

export function AppCard({ app, showEnvironment = true, appendSearchParams }: AppCardProps) {
  const appUrl = getAppUrl(app)
  const environments = app.siblingEnvironments
    ? [app.environment_name, ...app.siblingEnvironments]
    : [app.environment_name]
  const extraParams = appendSearchParams ? `&${appendSearchParams}` : ''
  const groupParam = app.groupName ? '&group=true' : ''

  const uniqueAppNames = app.groupApps ? [...new Set(app.groupApps.map((a) => a.app_name))] : []
  const hasDistinctNames = uniqueAppNames.length > 1
  const displayName = app.groupName ?? app.app_name

  return (
    <Box padding="space-16" background="raised" className={styles.stackedListItem}>
      <VStack gap="space-12">
        {/* First row: App/group name, environment (desktop), alert indicator, status tag */}
        <HStack gap="space-8" align="center" justify="space-between" wrap>
          <HStack gap="space-12" align="center" style={{ flex: 1 }}>
            <HStack gap="space-8" align="center">
              {app.groupName && (
                <LayersIcon aria-hidden fontSize="1.2em" style={{ color: 'var(--ax-text-neutral-subtle)' }} />
              )}
              <Link to={appUrl}>
                <BodyShort weight="semibold">{displayName}</BodyShort>
              </Link>
            </HStack>
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
              <IssueBadge to={`${appUrl}#varsler`} icon={<BellIcon aria-hidden />} color="danger" variant="moderate">
                {app.alertCount}
              </IssueBadge>
            )}
            {(app.stats.unmapped_deployers ?? 0) > 0 && (
              <IssueBadge
                to={`${appUrl}/deployments?period=all${groupParam}`}
                icon={<PersonGroupIcon aria-hidden />}
                color="warning"
              >
                {app.stats.unmapped_deployers} {app.stats.unmapped_deployers === 1 ? 'umappet' : 'umappede'}
              </IssueBadge>
            )}
            {(app.stats.missing_goal_links ?? 0) > 0 && (
              <IssueBadge
                to={`${appUrl}/deployments?goal=missing&period=all${groupParam}${extraParams}`}
                icon={<LinkBrokenIcon aria-hidden />}
                color="warning"
              >
                {app.stats.missing_goal_links} uten opphav
              </IssueBadge>
            )}
            {(app.stats.baseline_action_count ?? 0) > 0 && (
              <IssueBadge
                to={`${appUrl}/deployments?status=baseline_action&period=all${groupParam}`}
                icon={<ClockDashedIcon aria-hidden />}
                color="warning"
              >
                Trenger baseline
              </IssueBadge>
            )}
            {getStatusBadge(app.stats, {
              failedTo:
                app.stats.without_four_eyes > 0
                  ? `${appUrl}/deployments?status=not_approved&period=all${groupParam}${extraParams}`
                  : undefined,
              pendingTo:
                app.stats.pending_verification > 0
                  ? `${appUrl}/deployments?status=pending&period=all${groupParam}${extraParams}`
                  : undefined,
              okTo: `${appUrl}/deployments?period=all${groupParam}${extraParams}`,
            })}
          </HStack>
        </HStack>

        {/* Member app names when group has distinct names */}
        {hasDistinctNames && <Detail textColor="subtle">{uniqueAppNames.join(' · ')}</Detail>}

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
            <ExternalLink href={`https://github.com/${app.active_repo}`}>{app.active_repo}</ExternalLink>
          ) : (
            '(ingen aktivt repo)'
          )}
        </Detail>
      </VStack>
    </Box>
  )
}
