import { ChevronRightIcon, HouseIcon } from '@navikt/aksel-icons'
import { Box, Detail, HStack } from '@navikt/ds-react'
import { Link, useLocation, useMatches } from 'react-router'

interface BreadcrumbConfig {
  label: string
  labelKey?: string // Key to look for in loader data for dynamic label
}

// Static breadcrumb configuration
const breadcrumbConfig: Record<string, BreadcrumbConfig> = {
  '/': { label: 'Hjem' },
  '/my-teams': { label: 'Mine team' },
  '/sections': { label: 'Seksjoner' },
  '/apps/add': { label: 'Legg til applikasjon' },
  '/admin': { label: 'Admin' },
  '/admin/users': { label: 'Brukermappinger' },
  '/admin/sync-jobs': { label: 'Sync Jobs' },
  '/admin/audit-reports': { label: 'Leveranserapport' },
}

// Pattern-based config for dynamic routes
const dynamicBreadcrumbs: Array<{
  pattern: RegExp
  getLabel: (matches: ReturnType<typeof useMatches>, pathname: string) => string
  parent: string
  getParentLabel?: (matches: ReturnType<typeof useMatches>, pathname: string) => string
}> = [
  // Admin sync job detail: /admin/sync-jobs/:jobId
  {
    pattern: /^\/admin\/sync-jobs\/(\d+)$/,
    getLabel: (_matches, pathname) => {
      const jobId = pathname.split('/')[3]
      return `Jobb #${jobId}`
    },
    parent: '/admin/sync-jobs',
  },
  // Team page: /team/:team
  {
    pattern: /^\/team\/([^/]+)$/,
    getLabel: (_matches, pathname) => {
      const team = pathname.split('/')[2]
      return team || 'Team'
    },
    parent: '/',
  },
  // Team/env page: /team/:team/env/:env
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)$/,
    getLabel: (_matches, pathname) => {
      const env = pathname.split('/')[4]
      return env || 'Environment'
    },
    parent: '/team/:team',
  },
  // New semantic URL structure: /team/:team/env/:env/app/:app
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
  // Section overview: /sections/:slug
  {
    pattern: /^\/sections\/([^/]+)$/,
    getLabel: (matches) => {
      const match = matches.find((m) => (m.data as Record<string, unknown>)?.section)
      const section = (match?.data as Record<string, { name?: string }>)?.section
      return section?.name || 'Seksjon'
    },
    parent: '/sections',
  },
  // Section edit: /sections/:slug/edit
  {
    pattern: /^\/sections\/([^/]+)\/edit$/,
    getLabel: () => 'Rediger',
    parent: '/sections/:slug',
  },
  // Team page: /sections/:slug/teams/:team
  {
    pattern: /^\/sections\/([^/]+)\/teams\/([^/]+)$/,
    getLabel: (matches) => {
      const match = matches.find((m) => (m.data as Record<string, unknown>)?.devTeam)
      const devTeam = (match?.data as Record<string, { name?: string }>)?.devTeam
      return devTeam?.name || 'Team'
    },
    parent: '/sections/:slug',
  },
  // Board page: /sections/:slug/teams/:team/:boardId
  {
    pattern: /^\/sections\/([^/]+)\/teams\/([^/]+)\/(\d+)$/,
    getLabel: (matches) => {
      const match = matches.find((m) => (m.data as Record<string, unknown>)?.board)
      const board = (match?.data as Record<string, { title?: string }>)?.board
      return board?.title || 'Tavle'
    },
    parent: '/sections/:slug/teams/:team',
  },
  // Boards list: /sections/:slug/teams/:team/boards
  {
    pattern: /^\/sections\/([^/]+)\/teams\/([^/]+)\/boards$/,
    getLabel: () => 'Tidligere tavler',
    parent: '/sections/:slug/teams/:team',
  },
  // Dashboard: /sections/:slug/teams/:team/dashboard
  {
    pattern: /^\/sections\/([^/]+)\/teams\/([^/]+)\/dashboard$/,
    getLabel: () => 'Dashboard',
    parent: '/sections/:slug/teams/:team',
  },
]

interface Crumb {
  path: string | null // null = not clickable
  label: string
}

function buildBreadcrumbs(pathname: string, matches: ReturnType<typeof useMatches>): Crumb[] {
  const crumbs: Crumb[] = []

  // Always start with home (but we'll show icon instead of "Hjem")
  if (pathname !== '/') {
    crumbs.push({ path: '/', label: 'Hjem' })
  }

  // Check static config first
  if (breadcrumbConfig[pathname]) {
    // Build path segments
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

  // Helper to add team/env/app crumbs with team and env clickable
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

  // Helper to add section hierarchy crumbs
  function addSectionCrumbs(includeTeam = false) {
    const sectionMatch = pathname.match(/^\/sections\/([^/]+)/)
    if (!sectionMatch) return
    const sectionSlug = sectionMatch[1]
    const sectionPath = `/sections/${sectionSlug}`

    // Get section name from loader data
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

  // Check dynamic patterns
  for (const dynamic of dynamicBreadcrumbs) {
    if (dynamic.pattern.test(pathname)) {
      // Add parent breadcrumbs first
      // Handle: /team/:team/env/:env/app/:app/deployments/:id/debug-verify
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
        // App page with team/env as parent
        const semanticMatch = pathname.match(/^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)/)
        if (semanticMatch) {
          const [, team, env] = semanticMatch
          const teamPath = `/team/${team}`
          const envPath = `/team/${team}/env/${env}`
          crumbs.push({ path: teamPath, label: team })
          crumbs.push({ path: envPath, label: env })
        }
      } else if (dynamic.parent === '/team/:team') {
        // Team/env page or app page with team as parent
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
        // Add static parent (but not home, that's already added)
        const parentSegments = dynamic.parent.split('/').filter(Boolean)
        let parentPath = ''
        for (const seg of parentSegments) {
          parentPath += `/${seg}`
          if (breadcrumbConfig[parentPath]) {
            crumbs.push({ path: parentPath, label: breadcrumbConfig[parentPath].label })
          }
        }
      }

      // Add current dynamic crumb
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
