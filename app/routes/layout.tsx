import { ChevronDownIcon, MenuHamburgerIcon, MoonIcon, PersonIcon, SunIcon } from '@navikt/aksel-icons'
import {
  ActionMenu,
  Alert,
  BodyShort,
  Box,
  CopyButton,
  Detail,
  Heading,
  Hide,
  HStack,
  InternalHeader,
  Page,
  Show,
  Spacer,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { isRouteErrorResponse, Link, Outlet, useLocation, useNavigate, useRouteError } from 'react-router'
import { Breadcrumbs } from '~/components/Breadcrumbs'
import { SearchDialog } from '~/components/SearchDialog'
import { getUserMappingByNavIdent } from '~/db/user-mappings.server'
import { useTheme } from '~/hooks/useTheme'
import { getUserSections, requireUser } from '~/lib/auth.server'
import styles from '../styles/common.module.css'
import type { Route } from './+types/layout'

export async function loader({ request }: Route.LoaderArgs) {
  const identity = await requireUser(request)

  // Resolve user's display name and section memberships in parallel
  const [userMapping, sections] = await Promise.all([
    getUserMappingByNavIdent(identity.navIdent),
    getUserSections(identity.entraGroups),
  ])

  return {
    user: {
      navIdent: identity.navIdent,
      displayName: userMapping?.display_name || identity.name || identity.navIdent,
      email: userMapping?.nav_email || identity.email || null,
      githubUsername: userMapping?.github_username || null,
      role: identity.role,
      sections,
    },
  }
}

export default function Layout({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const [_searchQuery, setSearchQuery] = useState('')

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/'
    }
    return location.pathname.startsWith(path)
  }

  // Only show admin nav item for admin users
  const navItems = user.role === 'admin' ? [{ path: '/admin', label: 'Admin' }] : []

  // Clear search on navigation
  const prevPathRef = useRef(location.pathname)
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      setSearchQuery('')
      prevPathRef.current = location.pathname
    }
  })

  return (
    <div className={styles.layoutContainer}>
      <InternalHeader>
        {/* Mobile: Hamburger menu on the left */}
        <ActionMenu>
          <Hide above="md" asChild>
            <ActionMenu.Trigger>
              <InternalHeader.Button>
                <MenuHamburgerIcon title="Meny" style={{ fontSize: '1.5rem' }} />
              </InternalHeader.Button>
            </ActionMenu.Trigger>
          </Hide>
          <ActionMenu.Content>
            <ActionMenu.Group label="Navigasjon">
              <ActionMenu.Item
                onSelect={() => navigate('/search')}
                className={isActive('/search') ? styles.navLinkActive : undefined}
              >
                Søk
              </ActionMenu.Item>
              {navItems.map((item) => (
                <ActionMenu.Item
                  key={item.path}
                  onSelect={() => navigate(item.path)}
                  className={isActive(item.path) ? styles.navLinkActive : undefined}
                >
                  {item.label}
                </ActionMenu.Item>
              ))}
            </ActionMenu.Group>
          </ActionMenu.Content>
        </ActionMenu>

        <InternalHeader.Title as={Link} to="/">
          Deployment Audit
        </InternalHeader.Title>

        {/* Global search dialog */}
        <Show above="md" asChild>
          <HStack align="center" style={{ alignSelf: 'center', paddingInline: 'var(--ax-space-20)' }}>
            <SearchDialog />
          </HStack>
        </Show>

        <Spacer />

        {/* Desktop: Inline navigation */}
        {navItems.map((item) => (
          <Show key={item.path} above="md" asChild>
            <InternalHeader.Title
              as={Link}
              to={item.path}
              className={isActive(item.path) ? styles.navLinkActive : styles.navLink}
            >
              {item.label}
            </InternalHeader.Title>
          </Show>
        ))}

        {/* User menu */}
        {user ? (
          <ActionMenu>
            <ActionMenu.Trigger>
              <InternalHeader.Button
                style={{
                  paddingRight: 'var(--ax-space-16)',
                  paddingLeft: 'var(--ax-space-16)',
                  gap: 'var(--ax-space-8)',
                }}
              >
                <BodyShort size="small">{user.displayName}</BodyShort>
                <ChevronDownIcon title="Brukermeny" />
              </InternalHeader.Button>
            </ActionMenu.Trigger>
            <ActionMenu.Content align="end">
              <ActionMenu.Label>
                <dl style={{ margin: 0 }}>
                  <BodyShort as="dt" size="small" weight="semibold">
                    {user.displayName}
                  </BodyShort>
                  <Detail as="dd" style={{ margin: 0 }}>
                    {user.navIdent}
                  </Detail>
                </dl>
              </ActionMenu.Label>
              <ActionMenu.Item
                onSelect={() => navigate(`/users/${user.githubUsername || user.navIdent}`)}
                icon={<PersonIcon aria-hidden style={{ fontSize: '1.5rem' }} />}
              >
                Min profil
              </ActionMenu.Item>
              <ActionMenu.Divider />
              {user.sections.length > 0 && (
                <>
                  <ActionMenu.Group label="Seksjoner">
                    {user.sections.map((section) => (
                      <ActionMenu.Item key={section.slug} onSelect={() => navigate(`/sections/${section.slug}`)}>
                        {section.name}
                        {section.role === 'admin' && (
                          <Detail as="span" textColor="subtle" style={{ marginLeft: 'var(--ax-space-8)' }}>
                            admin
                          </Detail>
                        )}
                      </ActionMenu.Item>
                    ))}
                  </ActionMenu.Group>
                  <ActionMenu.Divider />
                </>
              )}
              <ActionMenu.Group label="Tema">
                <ActionMenu.Item
                  onSelect={() => setTheme('light')}
                  disabled={theme === 'light'}
                  icon={<SunIcon aria-hidden style={{ fontSize: '1.5rem' }} />}
                >
                  Lyst tema
                </ActionMenu.Item>
                <ActionMenu.Item
                  onSelect={() => setTheme('dark')}
                  disabled={theme === 'dark'}
                  icon={<MoonIcon aria-hidden style={{ fontSize: '1.5rem' }} />}
                >
                  Mørkt tema
                </ActionMenu.Item>
              </ActionMenu.Group>
            </ActionMenu.Content>
          </ActionMenu>
        ) : (
          <InternalHeader.Button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? (
              <MoonIcon title="Bytt til mørkt tema" style={{ fontSize: '1.5rem' }} />
            ) : (
              <SunIcon title="Bytt til lyst tema" style={{ fontSize: '1.5rem' }} />
            )}
          </InternalHeader.Button>
        )}
      </InternalHeader>

      <Page>
        <VStack gap="space-32">
          <Breadcrumbs />
          <Page.Block as="main" width="2xl" gutters>
            <Outlet />
          </Page.Block>
        </VStack>
      </Page>
    </div>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  const location = useLocation()

  let title = 'Noe gikk galt'
  let message = 'En uventet feil oppstod.'
  let stack: string | undefined
  let statusCode: number | undefined

  if (isRouteErrorResponse(error)) {
    statusCode = error.status
    title = error.status === 404 ? 'Siden ble ikke funnet' : `Feil ${error.status}`
    message = error.status === 404 ? 'Siden du leter etter finnes ikke.' : error.statusText || message
  } else if (error instanceof Error) {
    message = error.message
    stack = error.stack
  }

  const fullError = [
    `URL: ${location.pathname}`,
    `Tidspunkt: ${new Date().toISOString()}`,
    statusCode ? `Status: ${statusCode}` : null,
    `Feil: ${message}`,
    stack ? `\nStack trace:\n${stack}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className={styles.layoutContainer}>
      <InternalHeader>
        <InternalHeader.Title as={Link} to="/">
          Deployment Audit
        </InternalHeader.Title>
      </InternalHeader>

      <Page>
        <VStack gap="space-32">
          <Breadcrumbs />
          <Page.Block as="main" width="2xl" gutters>
            <VStack gap="space-24">
              <Alert variant="error">
                <VStack gap="space-8">
                  <Heading size="small" level="1">
                    {title}
                  </Heading>
                  <BodyShort>{message}</BodyShort>
                </VStack>
              </Alert>

              {stack && (
                <VStack gap="space-8">
                  <HStack gap="space-8" align="center">
                    <Heading size="xsmall" level="2">
                      Stack trace
                    </Heading>
                    <CopyButton copyText={fullError} size="small" text="Kopier" activeText="Kopiert!" />
                  </HStack>
                  <Box background="neutral-moderate" padding="space-16" borderRadius="8">
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.8rem' }}>
                      <code>{stack}</code>
                    </pre>
                  </Box>
                </VStack>
              )}
            </VStack>
          </Page.Block>
        </VStack>
      </Page>
    </div>
  )
}
