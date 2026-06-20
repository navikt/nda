import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getSectionDashboardStats, getSectionOverallStats } from '../../dashboard-stats.server'
import { removeNaisTeamFromDevTeam, setDevTeamNaisTeams } from '../../dev-teams.server'
import { getSectionWithTeams, setSectionTeams } from '../../sections.server'
import { seedApp, seedDeployment, seedDevTeam, seedSection, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await truncateAllTables(pool)
})

describe('section_teams soft delete', () => {
  it('soft-deletes removed team_slugs and records deletedBy', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')

    await setSectionTeams(sectionId, ['team-a', 'team-b'], 'A111111')
    await setSectionTeams(sectionId, ['team-a'], 'A999999')

    const { rows } = await pool.query(
      `SELECT team_slug, deleted_at, deleted_by FROM section_teams
       WHERE section_id = $1 ORDER BY team_slug`,
      [sectionId],
    )
    expect(rows).toHaveLength(2)
    const byTeam = new Map(rows.map((r) => [r.team_slug, r]))
    expect(byTeam.get('team-a').deleted_at).toBeNull()
    expect(byTeam.get('team-b').deleted_at).not.toBeNull()
    expect(byTeam.get('team-b').deleted_by).toBe('A999999')
  })

  it('preserves untouched active rows (no xmin bump)', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')

    await setSectionTeams(sectionId, ['team-a', 'team-b'], 'A111111')
    const before = await pool.query(
      `SELECT team_slug, xmin::text AS xmin FROM section_teams
       WHERE section_id = $1 ORDER BY team_slug`,
      [sectionId],
    )

    await setSectionTeams(sectionId, ['team-a', 'team-b'], 'A999999')
    const after = await pool.query(
      `SELECT team_slug, xmin::text AS xmin FROM section_teams
       WHERE section_id = $1 ORDER BY team_slug`,
      [sectionId],
    )
    expect(after.rows).toEqual(before.rows)
  })

  it('undeletes a soft-deleted team_slug in place when re-added', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')

    await setSectionTeams(sectionId, ['team-a', 'team-b'], 'A111111')
    await setSectionTeams(sectionId, ['team-a'], 'A999999')
    await setSectionTeams(sectionId, ['team-a', 'team-b'], 'A111111')

    const { rows } = await pool.query(
      `SELECT team_slug, deleted_at, deleted_by FROM section_teams
       WHERE section_id = $1 ORDER BY team_slug`,
      [sectionId],
    )
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.deleted_at).toBeNull()
      expect(r.deleted_by).toBeNull()
    }
  })

  it('getSectionWithTeams excludes soft-deleted slugs', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')

    await setSectionTeams(sectionId, ['team-a', 'team-b'], 'A111111')
    await setSectionTeams(sectionId, ['team-a'], 'A999999')

    const sec = await getSectionWithTeams('sec')
    expect(sec?.team_slugs).toEqual(['team-a'])
  })

  it('concurrent setSectionTeams calls for the same section serialize via advisory lock', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')

    await Promise.all([
      setSectionTeams(sectionId, ['team-a'], 'A111111'),
      setSectionTeams(sectionId, ['team-b'], 'A222222'),
    ])

    const { rows } = await pool.query(
      `SELECT team_slug FROM section_teams
       WHERE section_id = $1 AND deleted_at IS NULL`,
      [sectionId],
    )
    expect(rows).toHaveLength(1)
    expect(['team-a', 'team-b']).toContain(rows[0].team_slug)
  })

  it('soft-deleted row preserves the original (section_id, team_slug) for audit', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')

    await setSectionTeams(sectionId, ['team-a'], 'A111111')
    await setSectionTeams(sectionId, [], 'A999999')

    const { rows } = await pool.query(
      `SELECT section_id, team_slug, deleted_at, deleted_by FROM section_teams
       WHERE section_id = $1 AND team_slug = 'team-a'`,
      [sectionId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).not.toBeNull()
    expect(rows[0].deleted_by).toBe('A999999')
  })

  it('getSectionOverallStats excludes deployments from soft-deleted section_teams links', async () => {
    const sectionId = await seedSection(pool, 'sec-stats', 'Sec stats')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app1', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      fourEyesStatus: 'approved_pr',
    })

    await setSectionTeams(sectionId, ['team-a'], 'A111111')
    const before = await getSectionOverallStats(sectionId)
    expect(before.total_deployments).toBe(1)

    await setSectionTeams(sectionId, [], 'A999999')
    const after = await getSectionOverallStats(sectionId)
    expect(after.total_deployments).toBe(0)
  })
})

describe('dev_team_nais_teams soft delete', () => {
  async function setup() {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const devTeamId = await seedDevTeam(pool, 'dt', 'Dev Team', sectionId)
    return devTeamId
  }

  it('soft-deletes removed nais_team_slugs and records deletedBy', async () => {
    const devTeamId = await setup()

    await setDevTeamNaisTeams(devTeamId, ['nais-a', 'nais-b'], 'A111111')
    await setDevTeamNaisTeams(devTeamId, ['nais-a'], 'A999999')

    const { rows } = await pool.query(
      `SELECT nais_team_slug, deleted_at, deleted_by FROM dev_team_nais_teams
       WHERE dev_team_id = $1 ORDER BY nais_team_slug`,
      [devTeamId],
    )
    expect(rows).toHaveLength(2)
    const byTeam = new Map(rows.map((r) => [r.nais_team_slug, r]))
    expect(byTeam.get('nais-a').deleted_at).toBeNull()
    expect(byTeam.get('nais-b').deleted_at).not.toBeNull()
    expect(byTeam.get('nais-b').deleted_by).toBe('A999999')
  })

  it('preserves untouched active rows (no xmin bump)', async () => {
    const devTeamId = await setup()

    await setDevTeamNaisTeams(devTeamId, ['nais-a', 'nais-b'], 'A111111')
    const before = await pool.query(
      `SELECT nais_team_slug, xmin::text AS xmin FROM dev_team_nais_teams
       WHERE dev_team_id = $1 ORDER BY nais_team_slug`,
      [devTeamId],
    )

    await setDevTeamNaisTeams(devTeamId, ['nais-a', 'nais-b'], 'A999999')
    const after = await pool.query(
      `SELECT nais_team_slug, xmin::text AS xmin FROM dev_team_nais_teams
       WHERE dev_team_id = $1 ORDER BY nais_team_slug`,
      [devTeamId],
    )
    expect(after.rows).toEqual(before.rows)
  })

  it('undeletes a soft-deleted nais_team_slug in place when re-added', async () => {
    const devTeamId = await setup()

    await setDevTeamNaisTeams(devTeamId, ['nais-a', 'nais-b'], 'A111111')
    await setDevTeamNaisTeams(devTeamId, ['nais-a'], 'A999999')
    await setDevTeamNaisTeams(devTeamId, ['nais-a', 'nais-b'], 'A111111')

    const { rows } = await pool.query(
      `SELECT nais_team_slug, deleted_at, deleted_by FROM dev_team_nais_teams
       WHERE dev_team_id = $1 ORDER BY nais_team_slug`,
      [devTeamId],
    )
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.deleted_at).toBeNull()
      expect(r.deleted_by).toBeNull()
    }
  })

  it('concurrent setDevTeamNaisTeams calls for the same dev team serialize via advisory lock', async () => {
    const devTeamId = await setup()

    await Promise.all([
      setDevTeamNaisTeams(devTeamId, ['nais-a'], 'A111111'),
      setDevTeamNaisTeams(devTeamId, ['nais-b'], 'A222222'),
    ])

    const { rows } = await pool.query(
      `SELECT nais_team_slug FROM dev_team_nais_teams
       WHERE dev_team_id = $1 AND deleted_at IS NULL`,
      [devTeamId],
    )
    expect(rows).toHaveLength(1)
    expect(['nais-a', 'nais-b']).toContain(rows[0].nais_team_slug)
  })

  it('getSectionDashboardStats excludes deployments from soft-deleted dev_team_nais_teams links', async () => {
    const sectionId = await seedSection(pool, 'sec-dt', 'Sec dt')
    const devTeamId = await seedDevTeam(pool, 'dt-stats', 'Dev Team Stats', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-a', appName: 'app1', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'nais-a',
      environment: 'prod',
      fourEyesStatus: 'approved_pr',
    })

    await setDevTeamNaisTeams(devTeamId, ['nais-a'], 'A111111')
    const before = await getSectionDashboardStats(sectionId)
    const beforeRow = before.find((r) => r.dev_team_id === devTeamId)
    expect(beforeRow?.total_deployments).toBe(1)

    await setDevTeamNaisTeams(devTeamId, [], 'A999999')
    const after = await getSectionDashboardStats(sectionId)
    const afterRow = after.find((r) => r.dev_team_id === devTeamId)
    expect(afterRow?.total_deployments).toBe(0)
  })
})

describe('removeNaisTeamFromDevTeam', () => {
  it('soft-deletes a single nais-team link and records deleted_by', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const devTeamId = await seedDevTeam(pool, 'dt', 'DT', sectionId)

    await setDevTeamNaisTeams(devTeamId, ['nais-a', 'nais-b'], 'A111111')
    await removeNaisTeamFromDevTeam(devTeamId, 'nais-b', 'A999999')

    const { rows } = await pool.query(
      `SELECT nais_team_slug, deleted_at, deleted_by FROM dev_team_nais_teams
       WHERE dev_team_id = $1 ORDER BY nais_team_slug`,
      [devTeamId],
    )
    expect(rows).toHaveLength(2)
    const bySlug = new Map(rows.map((r) => [r.nais_team_slug, r]))
    expect(bySlug.get('nais-a').deleted_at).toBeNull()
    expect(bySlug.get('nais-b').deleted_at).not.toBeNull()
    expect(bySlug.get('nais-b').deleted_by).toBe('A999999')
  })

  it('is a no-op when called on an already-deleted link', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const devTeamId = await seedDevTeam(pool, 'dt', 'DT', sectionId)

    await setDevTeamNaisTeams(devTeamId, ['nais-a'], 'A111111')
    await removeNaisTeamFromDevTeam(devTeamId, 'nais-a', 'A222222')

    const { rows: before } = await pool.query(
      `SELECT deleted_at, deleted_by FROM dev_team_nais_teams
       WHERE dev_team_id = $1 AND nais_team_slug = 'nais-a'`,
      [devTeamId],
    )
    expect(before[0].deleted_by).toBe('A222222')

    await removeNaisTeamFromDevTeam(devTeamId, 'nais-a', 'A333333')

    const { rows: after } = await pool.query(
      `SELECT deleted_at, deleted_by FROM dev_team_nais_teams
       WHERE dev_team_id = $1 AND nais_team_slug = 'nais-a'`,
      [devTeamId],
    )
    expect(after[0].deleted_by).toBe('A222222')
  })
})
