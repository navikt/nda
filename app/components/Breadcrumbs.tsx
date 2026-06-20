import { ChevronRightIcon, HouseIcon } from '@navikt/aksel-icons'
import { Box, Detail, HStack } from '@navikt/ds-react'
import { Link, useLocation, useMatches } from 'react-router'
import { formatBoardLabel } from '~/lib/board-periods'

interface BreadcrumbConfig {
  label: string
  labelKey?: string
}

const breadcrumbConfig: Record<string, BreadcrumbConfig> = {
  '/': { label: 'Hjem' },
  '/my-teams': { label: 'Mine team' },
  '/sections': { label: 'Seksjoner' },
  '/admin': { label: 'Admin' },
  '/admin/users': { label: 'Brukermappinger' },
  '/admin/sync-jobs': { label: 'Sync Jobs' },
  '/admin/audit-reports': { label: 'Leveranserapport' },
}

const dynamicBreadcrumbs: Array<{
  pattern: RegExp
  getLabel: (matches: ReturnType<typeof useMatches>, pathname: string) => string
  parent: string
  getParentLabel?: (matches: ReturnType<typeof useMatches>, pathname: string) => string
}> = [
  {
    pattern: /^\/admin\/sync-jobs\/(\d+)$/,
    getLabel: (_matches, pathname) => {
      const jobId = pathname.split('/')[3]
      return `Jobb #${jobId}`
    },
    parent: '/admin/sync-jobs',
  },
  {
    pattern: /^\/team\/([^/]+)$/,
    getLabel: (_matches, pathname) => {
      const team = pathname.split('/')[2]
      return team || 'Team'
    },
    parent: '/',
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)$/,
    getLabel: (_matches, pathname) => {
      const env = pathname.split('/')[4]
      return env || 'Environment'
    },
    parent: '/team/:team',
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)$/,
    getLabel: (_matches, pathname) => {
      const appName = pathname.split('/')[6]
      return appName || 'Applikasjon'
    },
    parent: '/team/:team/env/:env',
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)\/admin$/,
    getLabel: () => 'Administrasjon',
    parent: '/team/:team/env/:env/app/:app',
    getParentLabel: (_matches, pathname) => {
      const appName = pathname.split('/')[6]
      return appName || 'Applikasjon'
    },
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)\/slack$/,
    getLabel: () => 'Slack',
    parent: '/team/:team/env/:env/app/:app',
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)\/admin\/verification-diff$/,
    getLabel: () => 'Verifiseringsavvik',
    parent: '/team/:team/env/:env/app/:app/admin',
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)\/admin\/status-history$/,
    getLabel: () => 'Statusoverganger',
    parent: '/team/:team/env/:env/app/:app/admin',
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)\/admin\/sync-job\/(\d+)$/,
    getLabel: (_matches, pathname) => {
      const jobId = pathname.split('/')[8]
      return `Jobb #${jobId}`
    },
    parent: '/team/:team/env/:env/app/:app/admin',
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)\/admin\/verification-diff\/(\d+)$/,
    getLabel: (_matches, pathname) => {
      const deploymentId = pathname.split('/')[8]
      return deploymentId || 'Deployment'
    },
    parent: '/team/:team/env/:env/app/:app/admin/verification-diff',
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)\/deployments$/,
    getLabel: () => 'Deployments',
    parent: '/team/:team/env/:env/app/:app',
    getParentLabel: (_matches, pathname) => {
      const appName = pathname.split('/')[6]
      return appName || 'Applikasjon'
    },
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)\/deployments\/(\d+)$/,
    getLabel: (matches) => {
      const match = matches.find((m) => m.pathname.match(/^\/team\/[^/]+\/env\/[^/]+\/app\/[^/]+\/deployments\/\d+$/))
      const data = match?.data as { deployment?: { commit_sha?: string } } | undefined
      const sha = data?.deployment?.commit_sha
      return sha ? sha.substring(0, 7) : 'Deployment'
    },
    parent: '/team/:team/env/:env/app/:app/deployments',
    getParentLabel: (_matches, pathname) => {
      const appName = pathname.split('/')[6]
      return appName || 'Applikasjon'
    },
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)\/deployments\/(\d+)\/debug-verify$/,
    getLabel: () => 'Debug Verifisering',
    parent: '/team/:team/env/:env/app/:app/deployments/:id',
  },
  {
    pattern: /^\/users\/([^/]+)$/,
    getLabel: (_matches, pathname) => {
      const username = pathname.split('/')[2]
      return username || 'Bruker'
    },
    parent: '/admin/users',
  },
  {
    pattern: /^\/sections\/([^/]+)$/,
    getLabel: (matches) => {
      const match = matches.find((m) => (m.data as Record<string, unknown>)?.section)
      const section = (match?.data as Record<string, { name?: string }>)?.section
      return section?.name || 'Seksjon'
    },
    parent: '/sections',
  },
  {
    pattern: /^\/sections\/([^/]+)\/edit$/,
    getLabel: () => 'Rediger',
    parent: '/sections/:slug',
  },
  {
    pattern: /^\/sections\/([^/]+)\/teams\/([^/]+)$/,
    getLabel: (matches) => {
      const match = matches.find((m) => (m.data as Record<string, unknown>)?.devTeam)
      const devTeam = (match?.data as Record<string, { name?: string }>)?.devTeam
      return devTeam?.name || 'Team'
    },
    parent: '/sections/:slug',
  },
  {
    pattern: /^\/sections\/([^/]+)\/teams\/([^/]+)\/(\d+)$/,
    getLabel: (matches) => {
      const match = matches.find((m) => (m.data as Record<string, unknown>)?.board)
      const data = match?.data as Record<string, { name?: string; period_label?: string; title?: string } | undefined>
      const board = data?.board
      const devTeam = data?.devTeam
      if (board?.period_label && devTeam?.name) {
        return formatBoardLabel({ teamName: devTeam.name, periodLabel: board.period_label })
      }
      return board?.title || 'Tavle'
    },
    parent: '/sections/:slug/teams/:team',
  },
  {
    pattern: /^\/sections\/([^/]+)\/teams\/([^/]+)\/boards$/,
    getLabel: () => 'Tidligere tavler',
    parent: '/sections/:slug/teams/:team',
  },
  {
    pattern: /^\/sections\/([^/]+)\/teams\/([^/]+)\/dashboard$/,
    getLabel: () => 'Dashboard',
    parent: '/sections/:slug/teams/:team',
  },
  {
    pattern: /^\/sections\/([^/]+)\/teams\/([^/]+)\/admin$/,
    getLabel: () => 'Administrer',
    parent: '/sections/:slug/teams/:team',
  },
]

interface Crumb {
  path: string | null
  label: string
}

function buildBreadcrumbs(pathname: string, matches: ReturnType<typeof useMatches>): Crumb[] {
  const crumbs: Crumb[] = []

  if (pathname !== '/') {
    crumbs.push({ path: '/', label: 'Hjem' })
  }

  if (breadcrumbConfig[pathname]) {
    const segments = pathname.split('/').filter(Boolean)
    let currentPath = ''

    for (const segment of segments) {
      currentPath += `/${segment}`
      const config = breadcrumbConfig[currentPath]
      if (config) {
        crumbs.push({ path: currentPath, label: config.label })
      }
    }
    return crumbs
  }

  function addSemanticCrumbs(pathname: string, includeApp = true, includeDeployments = false, deploymentId?: string) {
    const semanticMatch = pathname.match(/^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)/)
    if (semanticMatch) {
      const [, team, env, app] = semanticMatch
      const teamPath = `/team/${team}`
      const envPath = `/team/${team}/env/${env}`
      const appPath = `/team/${team}/env/${env}/app/${app}`
      crumbs.push({ path: teamPath, label: team })
      crumbs.push({ path: envPath, label: env })
      if (includeApp) {
        crumbs.push({ path: appPath, label: app })
      }
      if (includeDeployments) {
        crumbs.push({ path: `${appPath}/deployments`, label: 'Deployments' })
      }
      if (deploymentId) {
        crumbs.push({ path: `${appPath}/deployments/${deploymentId}`, label: deploymentId })
      }
    }
  }

  function addSectionCrumbs(includeTeam = false) {
    const sectionMatch = pathname.match(/^\/sections\/([^/]+)/)
    if (!sectionMatch) return
    const sectionSlug = sectionMatch[1]
    const sectionPath = `/sections/${sectionSlug}`

    const sectionData = matches.find(
      (m) => (m.data as Record<string, unknown>)?.section || (m.data as Record<string, unknown>)?.sectionName,
    )
    const sectionName =
      (sectionData?.data as Record<string, { name?: string }>)?.section?.name ||
      (sectionData?.data as Record<string, string>)?.sectionName ||
      sectionSlug

    crumbs.push({ path: '/sections', label: 'Seksjoner' })
    crumbs.push({ path: sectionPath, label: sectionName })

    if (includeTeam) {
      const teamMatch = pathname.match(/^\/sections\/[^/]+\/teams\/([^/]+)/)
      if (teamMatch) {
        const teamSlug = teamMatch[1]
        const teamPath = `/sections/${sectionSlug}/teams/${teamSlug}`
        const teamData = matches.find((m) => (m.data as Record<string, unknown>)?.devTeam)
        const teamName = (teamData?.data as Record<string, { name?: string }>)?.devTeam?.name || teamSlug
        crumbs.push({ path: teamPath, label: teamName })
      }
    }
  }

  for (const dynamic of dynamicBreadcrumbs) {
    if (dynamic.pattern.test(pathname)) {
      if (dynamic.parent === '/team/:team/env/:env/app/:app/deployments/:id') {
        const match = pathname.match(/\/deployments\/(\d+)/)
        addSemanticCrumbs(pathname, true, true, match?.[1])
      }
      // Handle: /team/:team/env/:env/app/:app/admin/verification-diff/:id
      else if (dynamic.parent === '/team/:team/env/:env/app/:app/admin/verification-diff') {
        const semanticMatch = pathname.match(/^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)/)
        if (semanticMatch) {
          const [, team, env, app] = semanticMatch
          const teamPath = `/team/${team}`
          const envPath = `/team/${team}/env/${env}`
          const appPath = `/team/${team}/env/${env}/app/${app}`
          crumbs.push({ path: teamPath, label: team })
          crumbs.push({ path: envPath, label: env })
          crumbs.push({ path: appPath, label: app })
          crumbs.push({ path: `${appPath}/admin`, label: 'Administrasjon' })
          crumbs.push({ path: `${appPath}/admin/verification-diff`, label: 'Verifiseringsavvik' })
        }
      }
      // Handle: /team/:team/env/:env/app/:app/admin
      else if (dynamic.parent === '/team/:team/env/:env/app/:app/admin') {
        const semanticMatch = pathname.match(/^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)/)
        if (semanticMatch) {
          const [, team, env, app] = semanticMatch
          const teamPath = `/team/${team}`
          const envPath = `/team/${team}/env/${env}`
          const appPath = `/team/${team}/env/${env}/app/${app}`
          crumbs.push({ path: teamPath, label: team })
          crumbs.push({ path: envPath, label: env })
          crumbs.push({ path: appPath, label: app })
          crumbs.push({ path: `${appPath}/admin`, label: 'Administrasjon' })
        }
      }
      // Semantic URL structure: /team/:team/env/:env/app/:app/deployments/:id
      else if (dynamic.parent === '/team/:team/env/:env/app/:app/deployments') {
        addSemanticCrumbs(pathname, true, true)
      } else if (dynamic.parent === '/team/:team/env/:env/app/:app') {
        addSemanticCrumbs(pathname, true)
      } else if (dynamic.parent === '/team/:team/env/:env') {
        const semanticMatch = pathname.match(/^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)/)
        if (semanticMatch) {
          const [, team, env] = semanticMatch
          const teamPath = `/team/${team}`
          const envPath = `/team/${team}/env/${env}`
          crumbs.push({ path: teamPath, label: team })
          crumbs.push({ path: envPath, label: env })
        }
      } else if (dynamic.parent === '/team/:team') {
        const envMatch = pathname.match(/^\/team\/([^/]+)\/env\/([^/]+)$/)
        if (envMatch) {
          const [, team] = envMatch
          crumbs.push({ path: `/team/${team}`, label: team })
        }
      }
      // Section hierarchy: /sections/:slug/teams/:team
      else if (dynamic.parent === '/sections/:slug/teams/:team') {
        addSectionCrumbs(true)
      } else if (dynamic.parent === '/sections/:slug') {
        addSectionCrumbs(false)
      } else if (dynamic.parent && dynamic.parent !== '/' && breadcrumbConfig[dynamic.parent]) {
        const parentSegments = dynamic.parent.split('/').filter(Boolean)
        let parentPath = ''
        for (const seg of parentSegments) {
          parentPath += `/${seg}`
          if (breadcrumbConfig[parentPath]) {
            crumbs.push({ path: parentPath, label: breadcrumbConfig[parentPath].label })
          }
        }
      }

      crumbs.push({ path: pathname, label: dynamic.getLabel(matches, pathname) })
      return crumbs
    }
  }

  return crumbs
}

export function Breadcrumbs() {
  const location = useLocation()
  const matches = useMatches()

  const crumbs =
    location.pathname === '/' ? [{ path: '/', label: 'Hjem' }] : buildBreadcrumbs(location.pathname, matches)

  if (crumbs.length === 0) {
    return null
  }

  return (
    <Box paddingInline={{ xs: 'space-16', md: 'space-24' }} paddingBlock="space-12" background="sunken">
      <HStack justify="space-between" align="center">
        <nav aria-label="Brødsmuler">
          <HStack gap="space-4" align="center" wrap>
            {crumbs.map((crumb, index) => {
              const isLast = index === crumbs.length - 1
              const isHome = crumb.path === '/'
              const isClickable = crumb.path !== null

              return (
                <HStack key={crumb.path ?? crumb.label} gap="space-4" align="center">
                  {index > 0 && <ChevronRightIcon aria-hidden fontSize="1rem" />}
                  {isLast ? (
                    <Detail aria-current="page">
                      {isHome ? <HouseIcon aria-label="Hjem" /> : crumb.label.toLowerCase()}
                    </Detail>
                  ) : isClickable && crumb.path ? (
                    <Link to={crumb.path} style={{ textDecoration: 'none' }}>
                      <Detail className="breadcrumb-link">
                        {isHome ? <HouseIcon aria-label="Hjem" fontSize="1rem" /> : crumb.label.toLowerCase()}
                      </Detail>
                    </Link>
                  ) : (
                    <Detail textColor="subtle">{crumb.label.toLowerCase()}</Detail>
                  )}
                </HStack>
              )
            })}
          </HStack>
        </nav>
        <Detail textColor="subtle">{__BUILD_VERSION__}</Detail>
      </HStack>
    </Box>
  )
}
