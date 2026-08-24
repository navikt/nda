import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getBaselineMoveContext, moveBaselineToDeployment } from '~/db/deployments.server'
import { seedApp, seedDeployment, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})
afterEach(async () => {
  await truncateAllTables(pool)
})

const TECH_LEAD = 'Z990001'

async function seedFlyttApp(auditStartYear: number | null = null): Promise<number> {
  return seedApp(pool, { teamSlug: 'team-flytt', appName: 'app-flytt', environment: 'prod-gcp', auditStartYear })
}

async function seedRepoDeployment(
  appId: number,
  opts: {
    createdAt: Date
    fourEyesStatus: string
    commitSha?: string
    githubRepo?: string
    githubPrData?: Record<string, unknown> | null
  },
): Promise<number> {
  return seedDeployment(pool, {
    monitoredAppId: appId,
    teamSlug: 'team-flytt',
    environment: 'prod-gcp',
    githubOwner: 'navikt',
    githubRepo: opts.githubRepo ?? 'app-repo',
    commitSha: opts.commitSha ?? `sha-${opts.createdAt.getTime()}`,
    createdAt: opts.createdAt,
    fourEyesStatus: opts.fourEyesStatus,
    githubPrData: opts.githubPrData ?? null,
  })
}

async function getStatus(deploymentId: number): Promise<string> {
  const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [deploymentId])
  return rows[0].four_eyes_status
}

async function getHistory(deploymentId: number) {
  const { rows } = await pool.query(
    `SELECT from_status, to_status, changed_by, change_source, details
     FROM deployment_status_history WHERE deployment_id = $1 ORDER BY id`,
    [deploymentId],
  )
  return rows
}

describe('moveBaselineToDeployment', () => {
  it('moves baseline to an earlier deployment and demotes the later proposed baseline', async () => {
    const appId = await seedFlyttApp()
    const earlier = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-01-05T10:00:00Z'),
      fourEyesStatus: 'unverified_commits',
      githubPrData: { title: 'gammel leveranse' },
    })
    const proposed = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const result = await moveBaselineToDeployment(earlier, TECH_LEAD, 'Crawlet historikk viste feil første deploy')

    expect(result).toEqual({ moved: true, demotedCount: 1 })
    expect(await getStatus(earlier)).toBe('baseline')
    expect(await getStatus(proposed)).toBe('pending')

    const { rows } = await pool.query(
      'SELECT github_pr_number, github_pr_url, github_pr_data FROM deployments WHERE id = $1',
      [earlier],
    )
    expect(rows[0]).toEqual({ github_pr_number: null, github_pr_url: null, github_pr_data: null })

    const earlierHistory = await getHistory(earlier)
    expect(earlierHistory).toHaveLength(1)
    expect(earlierHistory[0]).toMatchObject({
      from_status: 'unverified_commits',
      to_status: 'baseline',
      changed_by: TECH_LEAD,
      change_source: 'baseline_approval',
    })
    expect(earlierHistory[0].details).toMatchObject({
      reason: 'Crawlet historikk viste feil første deploy',
      demoted_deployment_ids: [proposed],
    })

    const proposedHistory = await getHistory(proposed)
    expect(proposedHistory).toHaveLength(1)
    expect(proposedHistory[0]).toMatchObject({
      from_status: 'pending_baseline',
      to_status: 'pending',
      changed_by: TECH_LEAD,
      change_source: 'baseline_move',
    })
    expect(proposedHistory[0].details).toMatchObject({ new_baseline_deployment_id: earlier })
  })

  it('demotes every later baseline anchor, including an approved baseline', async () => {
    const appId = await seedFlyttApp()
    const earlier = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-01-05T10:00:00Z'),
      fourEyesStatus: 'pending',
    })
    const approvedBaseline = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'baseline',
    })
    const proposed = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-03-01T10:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const result = await moveBaselineToDeployment(earlier, TECH_LEAD, 'Flytter til reell første deploy')

    expect(result).toEqual({ moved: true, demotedCount: 2 })
    expect(await getStatus(earlier)).toBe('baseline')
    expect(await getStatus(approvedBaseline)).toBe('pending')
    expect(await getStatus(proposed)).toBe('pending')
  })

  it('refuses when no later baseline anchor exists', async () => {
    const appId = await seedFlyttApp()
    const target = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-01-05T10:00:00Z'),
      fourEyesStatus: 'pending',
    })
    await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'approved',
    })

    const result = await moveBaselineToDeployment(target, TECH_LEAD, 'Begrunnelse')

    expect(result).toEqual({ moved: false, reason: 'no_later_anchor' })
    expect(await getStatus(target)).toBe('pending')
    expect(await getHistory(target)).toHaveLength(0)
  })

  it('ignores baseline anchors from a different repository', async () => {
    const appId = await seedFlyttApp()
    const target = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-01-05T10:00:00Z'),
      fourEyesStatus: 'pending',
    })
    const otherRepoAnchor = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'pending_baseline',
      githubRepo: 'annet-repo',
    })

    const result = await moveBaselineToDeployment(target, TECH_LEAD, 'Begrunnelse')

    expect(result).toEqual({ moved: false, reason: 'no_later_anchor' })
    expect(await getStatus(otherRepoAnchor)).toBe('pending_baseline')
  })

  it('refuses a target that is already baseline', async () => {
    const appId = await seedFlyttApp()
    const target = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-01-05T10:00:00Z'),
      fourEyesStatus: 'baseline',
    })
    await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const result = await moveBaselineToDeployment(target, TECH_LEAD, 'Begrunnelse')

    expect(result).toEqual({ moved: false, reason: 'already_baseline' })
  })

  it('refuses a legacy target', async () => {
    const appId = await seedFlyttApp()
    const target = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-01-05T10:00:00Z'),
      fourEyesStatus: 'legacy',
    })
    await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const result = await moveBaselineToDeployment(target, TECH_LEAD, 'Begrunnelse')

    expect(result).toEqual({ moved: false, reason: 'legacy_status' })
    expect(await getStatus(target)).toBe('legacy')
  })

  it('refuses a target without a usable commit SHA', async () => {
    const appId = await seedFlyttApp()
    const target = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-01-05T10:00:00Z'),
      fourEyesStatus: 'pending',
      commitSha: 'refs/heads/main',
    })
    await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const result = await moveBaselineToDeployment(target, TECH_LEAD, 'Begrunnelse')

    expect(result).toEqual({ moved: false, reason: 'invalid_commit_sha' })
  })

  it('refuses a target before the audit start year', async () => {
    const appId = await seedFlyttApp(2026)
    const target = await seedRepoDeployment(appId, {
      createdAt: new Date('2025-06-01T10:00:00Z'),
      fourEyesStatus: 'pending',
    })
    await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const result = await moveBaselineToDeployment(target, TECH_LEAD, 'Begrunnelse')

    expect(result).toEqual({ moved: false, reason: 'outside_audit_window' })
  })

  it('records the transition as baseline_move when an attributed baseline approval already exists', async () => {
    const appId = await seedFlyttApp()
    const target = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-01-05T10:00:00Z'),
      fourEyesStatus: 'pending',
    })
    const proposed = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })
    await pool.query(
      `INSERT INTO deployment_status_history (deployment_id, from_status, to_status, changed_by, change_source)
       VALUES ($1, 'baseline', 'baseline', 'Z990002', 'baseline_approval')`,
      [target],
    )

    const result = await moveBaselineToDeployment(target, TECH_LEAD, 'Begrunnelse')

    expect(result).toEqual({ moved: true, demotedCount: 1 })
    expect(await getStatus(target)).toBe('baseline')
    expect(await getStatus(proposed)).toBe('pending')

    const history = await getHistory(target)
    expect(history).toHaveLength(2)
    expect(history[1]).toMatchObject({
      from_status: 'pending',
      to_status: 'baseline',
      changed_by: TECH_LEAD,
      change_source: 'baseline_move',
    })
  })
})

describe('getBaselineMoveContext', () => {
  it('reports an eligible target with its later anchors', async () => {
    const appId = await seedFlyttApp()
    const target = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-01-05T10:00:00Z'),
      fourEyesStatus: 'unverified_commits',
    })
    const anchor = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const context = await getBaselineMoveContext(target)

    expect(context?.eligible).toBe(true)
    expect(context?.anchors).toHaveLength(1)
    expect(context?.anchors[0]).toMatchObject({ id: anchor, four_eyes_status: 'pending_baseline' })
  })

  it('reports an ineligible target when no later anchor exists', async () => {
    const appId = await seedFlyttApp()
    await seedRepoDeployment(appId, {
      createdAt: new Date('2026-01-05T10:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })
    const latest = await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'pending',
    })

    const context = await getBaselineMoveContext(latest)

    expect(context).toEqual({ eligible: false, anchors: [] })
  })

  it('reports an ineligible target outside the audit window even with a later anchor', async () => {
    const appId = await seedFlyttApp(2026)
    const target = await seedRepoDeployment(appId, {
      createdAt: new Date('2025-06-01T10:00:00Z'),
      fourEyesStatus: 'pending',
    })
    await seedRepoDeployment(appId, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const context = await getBaselineMoveContext(target)

    expect(context?.eligible).toBe(false)
    expect(context?.anchors).toHaveLength(1)
  })

  it('returns null for an unknown deployment', async () => {
    expect(await getBaselineMoveContext(999999)).toBeNull()
  })
})
