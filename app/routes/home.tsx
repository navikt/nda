import { redirect } from 'react-router'
import { getUserLandingPage } from '~/db/user-settings.server'
import { requireUser } from '~/lib/auth.server'
import type { Route } from './+types/home'

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Deployment Audit' },
    { name: 'description', content: 'Audit Nais deployments for godkjenningsstatus' },
  ]
}

export async function loader({ request }: Route.LoaderArgs) {
  const identity = await requireUser(request)

  let landingPage = 'my-teams'
  try {
    landingPage = await getUserLandingPage(identity.navIdent)
  } catch {
    // user_settings table may not exist yet
  }

  return redirect(`/${landingPage}`)
}
