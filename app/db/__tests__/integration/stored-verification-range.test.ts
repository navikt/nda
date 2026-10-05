import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { closePool } from '~/db/connection.server'
import {
  getLatestVerificationRanges,
  getLatestVerificationRun,
  saveVerificationRun,
} from '~/db/github-data/verification-runs.server'
import { storeVerificationResult } from '~/lib/verification/store-data.server'
import type { VerificationResult } from '~/lib/verification/types'
import { seedApp, seedDeployment, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

it('reads only requested deployments and the latest run, never an older available interval', async () => {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
  const ids: number[] = []
  for (let index = 0; index < 5; index++) {
    ids.push(await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team-a', environment: 'prod-gcp' }))
  }
  const range = { baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) }
  const save = (id: number, result: unknown) =>
    saveVerificationRun(id, { status: 'approved', result }, { prSnapshotIds: [], commitSnapshotIds: [] })
  const earlierId = await save(ids[0], { comparisonRange: range })
  const laterId = await save(ids[0], {})
  await pool.query("UPDATE verification_runs SET run_at = '2026-01-01T00:00:00Z' WHERE id = ANY($1)", [
    [earlierId, laterId],
  ])
  await save(ids[1], { comparisonRange: range })
  await save(ids[2], { comparisonRange: range })
  await save(ids[2], { comparisonRange: { ...range, baseSha: 'short' } })
  await save(ids[4], { comparisonRange: range })
  expect(await getLatestVerificationRanges(ids.slice(0, 4))).toEqual({
    [ids[0]]: null,
    [ids[1]]: range,
    [ids[2]]: null,
  })
  expect(await getLatestVerificationRanges([])).toEqual({})
})

afterEach(async () => {
  await truncateAllTables(pool)
})

afterAll(async () => {
  await closePool()
  await pool.end()
})

it('persists the input interval as JSONB while leaving earlier results unchanged', async () => {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
  const headSha = 'b'.repeat(40)
  const baseSha = 'a'.repeat(40)
  const deploymentId = await seedDeployment(pool, {
    monitoredAppId: appId,
    teamSlug: 'team-a',
    environment: 'prod-gcp',
    commitSha: headSha,
  })
  const result: VerificationResult = {
    hasFourEyes: false,
    status: 'unverified_commits',
    deployedPr: null,
    unverifiedCommits: [],
    approvalDetails: { method: null, approvers: [], reason: 'Ikke godkjent' },
    verifiedAt: new Date('2026-01-02T00:00:00Z'),
    schemaVersion: 5,
  }
  const snapshotIds = { prSnapshotIds: [], commitSnapshotIds: [] }
  const legacyRunId = await saveVerificationRun(deploymentId, { status: result.status, result }, snapshotIds)
  const { rows: before } = await pool.query('SELECT result FROM verification_runs WHERE id = $1', [legacyRunId])
  const { verificationRunId } = await storeVerificationResult(deploymentId, result, snapshotIds, {
    commitSha: headSha,
    previousDeployment: { id: 1, commitSha: baseSha, createdAt: '2026-01-01T00:00:00Z' },
  })
  const { rows: stored } = await pool.query('SELECT result FROM verification_runs WHERE id = $1', [verificationRunId])
  expect(stored[0].result).toEqual({ ...before[0].result, comparisonRange: { baseSha, headSha } })
  const { rows: after } = await pool.query('SELECT result FROM verification_runs WHERE id = $1', [legacyRunId])
  expect(after).toEqual(before)
  expect(after[0].result).not.toHaveProperty('comparisonRange')
  const latest = await getLatestVerificationRun(deploymentId)
  expect(latest?.result).toEqual(stored[0].result)
  const { verificationRunId: missingRunId } = await storeVerificationResult(deploymentId, result, snapshotIds, {
    commitSha: headSha,
    previousDeployment: null,
  })
  const { rows: missing } = await pool.query('SELECT result FROM verification_runs WHERE id = $1', [missingRunId])
  expect(missing[0].result.comparisonRange).toBeNull()
})
