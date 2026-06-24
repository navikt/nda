import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  redirect,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from 'react-router'

import type { Route } from './+types/root'
import '@navikt/ds-css'
import { Page, Theme } from '@navikt/ds-react'
import { ThemeProvider } from './hooks/useTheme'
import { serializeAdminElevation } from './lib/admin-elevation.server'
import { getUserIdentity } from './lib/auth.server'
import { getTheme, setThemeCookie, type ThemeValue } from './lib/theme.server'
import styles from './styles/common.module.css'

export async function loader({ request, context }: Route.LoaderArgs) {
  const theme = await getTheme(request)
  return { theme, cspNonce: context.cspNonce }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()

  if (formData.get('intent') === 'toggleAdminMode') {
    const user = await getUserIdentity(request)
    if (!user?.isActualAdmin) {
      return data({ ok: false }, { status: 403 })
    }
    const elevate = formData.get('elevate') === 'true'
    const headers = { 'Set-Cookie': await serializeAdminElevation(elevate) }
    // When dropping elevation, redirect home: revalidating an admin-gated route
    // the user can no longer access would otherwise throw 403.
    if (!elevate) {
      return redirect('/', { headers })
    }
    return data({ ok: true }, { headers })
  }

  const theme = formData.get('theme') as ThemeValue
  if (theme !== 'light' && theme !== 'dark') {
    return data({ error: 'Invalid theme' }, { status: 400 })
  }
  return data(
    { theme },
    {
      headers: { 'Set-Cookie': await setThemeCookie(theme) },
    },
  )
}

export const links: Route.LinksFunction = () => [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useLoaderData<typeof loader>() as { theme: ThemeValue; cspNonce?: string } | undefined
  const nonce = data?.cspNonce
  return (
    <html lang="no">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  )
}

export default function App() {
  const { theme } = useLoaderData<typeof loader>()
  return (
    <ThemeProvider initialTheme={theme}>
      <Theme theme={theme}>
        <Outlet />
      </Theme>
    </ThemeProvider>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'Oops!'
  let details = 'An unexpected error occurred.'
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Error'
    details = error.status === 404 ? 'The requested page could not be found.' : error.statusText || details
  } else if (error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <Theme theme="light">
      <Page>
        <Page.Block as="main" width="xl" gutters>
          <h1>{message}</h1>
          <p>{details}</p>
          {stack && (
            <pre className={styles.errorStack}>
              <code>{stack}</code>
            </pre>
          )}
        </Page.Block>
      </Page>
    </Theme>
  )
}
