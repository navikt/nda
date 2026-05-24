import { redirect } from 'react-router'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/title-mismatches-redirect'

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  return redirect('/admin/data-mismatches', 301)
}
