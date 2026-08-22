import { useLoaderData } from 'react-router'
import { AdminPage } from '~/components/AdminPage'
import { pool } from '~/db/connection.server'
import { getAllDeployments } from '~/db/deployments.server'
import { requireAdmin } from '~/lib/auth.server'
import { isPendingStatus } from '~/lib/four-eyes-status'
import type { Route } from './+types/index'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Admin - NDA' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const allDeployments = await getAllDeployments()
  const pendingCount = allDeployments.filter(
    (d) => isPendingStatus(d.four_eyes_status ?? 'unknown') || d.four_eyes_status === 'error',
  ).length

  const diffResult = await pool.query('SELECT COUNT(*) as count FROM verification_diffs')
  const diffCount = parseInt(diffResult.rows[0].count, 10)

  const softDeletedResult = await pool.query<{ total: string }>(`
    SELECT (
      (SELECT COUNT(*) FROM user_github_accounts WHERE deleted_at IS NOT NULL) +
      (SELECT COUNT(*) FROM deployment_comments WHERE deleted_at IS NOT NULL AND comment_type NOT IN ('manual_approval', 'legacy_info')) +
      (SELECT COUNT(*) FROM dev_team_applications WHERE deleted_at IS NOT NULL) +
      (SELECT COUNT(*) FROM section_teams WHERE deleted_at IS NOT NULL) +
      (SELECT COUNT(*) FROM dev_team_nais_teams WHERE deleted_at IS NOT NULL) +
      (SELECT COUNT(*) FROM external_references WHERE deleted_at IS NOT NULL)
    )::text AS total
  `)
  const softDeletedCount = parseInt(softDeletedResult.rows[0].total, 10)

  const titleMismatchResult = await pool.query<{ count: string }>(`
    SELECT COUNT(*)::text AS count
    FROM deployments
    WHERE github_pr_data IS NOT NULL
      AND github_pr_data->>'title' IS NOT NULL
      AND github_pr_data->>'title' != ''
      AND title IS NOT NULL
      AND title != github_pr_data->>'title'
  `)
  const titleMismatchCount = parseInt(titleMismatchResult.rows[0].count, 10)

  const baselineNoApproverResult = await pool.query<{ count: string }>(`
    SELECT COUNT(*)::text AS count
    FROM deployments d
    WHERE d.four_eyes_status = 'baseline'
      AND NOT EXISTS (
        SELECT 1 FROM deployment_status_history dsh
          WHERE dsh.deployment_id = d.id
            AND dsh.change_source = 'baseline_approval'
            AND dsh.changed_by IS NOT NULL
      )
  `)
  const baselineNoApproverCount = parseInt(baselineNoApproverResult.rows[0].count, 10)

  return { pendingCount, diffCount, softDeletedCount, titleMismatchCount, baselineNoApproverCount }
}

export default function AdminRoute() {
  const loaderData = useLoaderData<typeof loader>()

  return <AdminPage {...loaderData} />
}
