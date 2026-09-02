import { AdminPage } from '~/components/AdminPage'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/index'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Admin - NDA' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  return null
}

export default function AdminRoute() {
  return <AdminPage />
}
