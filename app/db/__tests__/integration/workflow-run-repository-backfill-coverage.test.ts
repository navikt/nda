import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closePool } from '~/db/connection.server'
import { getWorkflowRunRepositoryBackfillCoverage } from '~/db/workflow-run-repository-backfill-coverage.server'
import { seedApp, seedApplicationRepository, seedDeployment, seedRepository, truncateAllTables } from './helpers'

const REPOSITORY_GITHUB_ID = '987654321'
const DEPLOYMENT_SHA = 'a'.repeat(40)

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await closePool()
  await pool.end()
})

afterEach(async () => {
  await truncateAllTables(pool)
})

async function seedLegacyDeployment(options: {
  monitoredAppId: number
  runId?: number
  triggerUrl?: string | null
  commitSha?: string
}): Promise<void> {
  const deploymentId = await seedDeployment(pool, {
    monitoredAppId: options.monitoredAppId,
    teamSlug: 'team-repo-backfill',
    environment: 'prod-gcp',
    commitSha: options.commitSha ?? DEPLOYMENT_SHA,
    githubOwner: 'navikt',
    githubRepo: 'repo-backfill',
    createdAt: new Date('2026-03-27T11:00:00.000Z'),
  })
  await pool.query('UPDATE deployments SET trigger_url = $1 WHERE id = $2', [
    options.triggerUrl === undefined
      ? options.runId
        ? `https://github.com/navikt/repo-backfill/actions/runs/${options.runId}`
        : null
      : options.triggerUrl,
    deploymentId,
  ])
}

async function seedWorkflowRun(runId: number, payload: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO github_workflow_runs_raw_snapshots
       (github_repo_id, owner, repo, run_id, api_version, data)
     VALUES ($1, 'navikt', 'repo-backfill', $2, '2022-11-28', $3)`,
    [REPOSITORY_GITHUB_ID, runId, JSON.stringify(payload)],
  )
}

function workflowRun(overrides: Record<string, unknown> = {}) {
  return {
    repository: { id: Number(REPOSITORY_GITHUB_ID) },
    head_repository: { id: Number(REPOSITORY_GITHUB_ID) },
    head_sha: DEPLOYMENT_SHA,
    event: 'push',
    ...overrides,
  }
}

describe('getWorkflowRunRepositoryBackfillCoverage', () => {
  it('counts strict workflow-run matches and separates missing or conflicting evidence without writes', async () => {
    const { rows: indexRows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname = 'idx_deployments_legacy_repository_lookup'`,
    )
    expect(indexRows).toHaveLength(1)
    expect(indexRows[0]?.indexdef).toContain('WHERE (repository_id IS NULL)')

    const appId = await seedApp(pool, {
      teamSlug: 'team-repo-backfill',
      appName: 'repo-backfill-app',
      environment: 'prod-gcp',
    })
    const repositoryId = await seedRepository(pool, {
      githubRepoId: REPOSITORY_GITHUB_ID,
      githubOwner: 'navikt',
      githubRepoName: 'repo-backfill',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-backfill',
      githubRepoId: REPOSITORY_GITHUB_ID,
    })
    const seed = (options: Omit<Parameters<typeof seedLegacyDeployment>[0], 'monitoredAppId'>) =>
      seedLegacyDeployment({ ...options, monitoredAppId: appId })

    await seed({ runId: 1, triggerUrl: 'https://github.com/NAVIKT/REPO-BACKFILL/actions/runs/1' })
    await seedWorkflowRun(1, workflowRun())

    await seed({ runId: 2 })
    await seed({ runId: 3 })
    await seedWorkflowRun(3, workflowRun({ head_sha: 'b'.repeat(40) }))

    await seed({ runId: 4 })
    await seedWorkflowRun(4, workflowRun({ repository: { id: 123 }, head_repository: { id: 123 } }))

    await seed({ runId: 5 })
    await seedWorkflowRun(5, workflowRun({ event: 'workflow_dispatch' }))

    await seed({ runId: 6 })
    await seedWorkflowRun(6, workflowRun({ head_repository: { id: 123 } }))

    await seed({ triggerUrl: null })
    await seed({ triggerUrl: 'https://example.com/navikt/repo-backfill/actions/runs/7' })
    await seed({ triggerUrl: `https://github.com/navikt/repo-backfill/actions/runs/${'9'.repeat(40)}` })
    await seed({ triggerUrl: 'https://github.com/navikt/another-repo/actions/runs/8' })

    const result = await getWorkflowRunRepositoryBackfillCoverage()

    expect(result).toEqual([
      {
        repositoryId,
        githubOwner: 'navikt',
        githubRepoName: 'repo-backfill',
        totalLegacyDeployments: 10,
        eligible: 1,
        noTriggerUrl: 1,
        invalidTriggerUrl: 2,
        triggerUrlMismatch: 1,
        missingSnapshot: 1,
        repositoryMismatch: 1,
        shaMismatch: 1,
        unsupportedEvent: 1,
        headRepositoryMismatch: 1,
      },
    ])
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM deployments WHERE repository_id IS NULL')
    expect(rows[0].count).toBe(10)
  })
})
