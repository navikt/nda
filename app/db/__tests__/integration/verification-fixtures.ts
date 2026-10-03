import type { Pool } from 'pg'
import { saveVerificationRun } from '~/db/github-data.server'
import { getMonorepoComparisonBase } from '~/db/verification-diff.server'
import { seedDeployment } from './helpers'

export async function seedDeploymentWithVerification(
  pool: Pool,
  opts: Parameters<typeof seedDeployment>[1],
): Promise<number> {
  const id = await seedDeployment(pool, opts)
  if (opts.commitSha && opts.githubOwner && opts.githubRepo) {
    const { rows } = await pool.query<{ github_repo_id: string }>(
      `SELECT github_repo_id FROM application_repositories
       WHERE monitored_app_id = $1 AND github_owner = $2 AND github_repo_name = $3
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [opts.monitoredAppId, opts.githubOwner, opts.githubRepo],
    )
    if (rows[0]?.github_repo_id) {
      const base = await getMonorepoComparisonBase(id, rows[0].github_repo_id, opts.commitSha)
      await saveVerificationRun(
        id,
        {
          status: opts.fourEyesStatus ?? 'pending',
          result: {
            comparisonRange: { baseSha: base?.commit_sha ?? null, headSha: opts.commitSha },
            isSameAppRedeploy: base?.is_same_app_redeploy ?? false,
          },
        },
        { prSnapshotIds: [], commitSnapshotIds: [] },
      )
    }
  }
  return id
}
