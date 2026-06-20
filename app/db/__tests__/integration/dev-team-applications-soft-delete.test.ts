import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  addAppToDevTeam,
  getAvailableAppsForDevTeam,
  getDevTeamApplications,
  getDevTeamsForApp,
  removeAppFromDevTeam,
  setDevTeamApplications,
} from '../../dev-teams.server'
import { seedApp, seedDevTeam, seedSection, truncateAllTables } from './helpers'

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

async function setup() {
  const sectionId = await seedSection(pool, 'sec', 'Sec')
  const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
  const app1 = await seedApp(pool, { teamSlug: 'nais-team', appName: 'app1', environment: 'dev' })
  const app2 = await seedApp(pool, { teamSlug: 'nais-team', appName: 'app2', environment: 'dev' })
  return { teamId, app1, app2 }
}

describe('dev_team_applications soft delete', () => {
  it('setDevTeamApplications soft-deletes removed links and records deletedBy', async () => {
    const { teamId, app1, app2 } = await setup()

    await setDevTeamApplications(teamId, [app1, app2], 'A111111')
    await setDevTeamApplications(teamId, [app1], 'A999999')

    const active = await getDevTeamApplications(teamId)
    expect(active.map((a) => a.monitored_app_id).sort()).toEqual([app1])

    const { rows } = await pool.query(
      `SELECT monitored_app_id, deleted_at, deleted_by
       FROM dev_team_applications
       WHERE dev_team_id = $1
       ORDER BY monitored_app_id`,
      [teamId],
    )
    expect(rows).toHaveLength(2)
    const byApp = new Map(rows.map((r) => [r.monitored_app_id, r]))
    expect(byApp.get(app1).deleted_at).toBeNull()
    expect(byApp.get(app2).deleted_at).not.toBeNull()
    expect(byApp.get(app2).deleted_by).toBe('A999999')
  })

  it('setDevTeamApplications preserves untouched active links (no audit churn)', async () => {
    const { teamId, app1, app2 } = await setup()

    await setDevTeamApplications(teamId, [app1, app2], 'A111111')
    await setDevTeamApplications(teamId, [app1, app2], 'A999999')

    const { rows } = await pool.query(
      `SELECT deleted_at, deleted_by FROM dev_team_applications WHERE dev_team_id = $1`,
      [teamId],
    )
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.deleted_at).toBeNull()
      expect(r.deleted_by).toBeNull()
    }
  })

  it('setDevTeamApplications undeletes a previously soft-deleted link in place', async () => {
    const { teamId, app1, app2 } = await setup()

    await setDevTeamApplications(teamId, [app1, app2], 'A111111')
    await setDevTeamApplications(teamId, [app1], 'A999999')
    await setDevTeamApplications(teamId, [app1, app2], 'A111111')

    const active = await getDevTeamApplications(teamId)
    expect(active.map((a) => a.monitored_app_id).sort((a, b) => a - b)).toEqual([app1, app2].sort((a, b) => a - b))

    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM dev_team_applications WHERE dev_team_id = $1`, [
      teamId,
    ])
    expect(rows[0].n).toBe(2)

    const { rows: app2Rows } = await pool.query(
      `SELECT deleted_at, deleted_by FROM dev_team_applications
       WHERE dev_team_id = $1 AND monitored_app_id = $2`,
      [teamId, app2],
    )
    expect(app2Rows[0].deleted_at).toBeNull()
    expect(app2Rows[0].deleted_by).toBeNull()
  })

  it('addAppToDevTeam undeletes a soft-deleted link', async () => {
    const { teamId, app1 } = await setup()

    await setDevTeamApplications(teamId, [app1], 'A111111')
    await setDevTeamApplications(teamId, [], 'A999999')

    await addAppToDevTeam(teamId, app1)

    const active = await getDevTeamApplications(teamId)
    expect(active.map((a) => a.monitored_app_id)).toEqual([app1])
  })

  it('addAppToDevTeam is idempotent on an active link', async () => {
    const { teamId, app1 } = await setup()

    await addAppToDevTeam(teamId, app1)
    await addAppToDevTeam(teamId, app1)

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM dev_team_applications WHERE dev_team_id = $1 AND monitored_app_id = $2`,
      [teamId, app1],
    )
    expect(rows[0].n).toBe(1)
  })

  it('getDevTeamApplications excludes soft-deleted links', async () => {
    const { teamId, app1, app2 } = await setup()

    await setDevTeamApplications(teamId, [app1, app2], 'A111111')
    await setDevTeamApplications(teamId, [app1], 'A999999')

    const active = await getDevTeamApplications(teamId)
    expect(active.map((a) => a.monitored_app_id)).toEqual([app1])
  })

  it('getAvailableAppsForDevTeam treats soft-deleted links as not linked', async () => {
    const { teamId, app1, app2 } = await setup()

    await setDevTeamApplications(teamId, [app1, app2], 'A111111')
    await setDevTeamApplications(teamId, [app1], 'A999999')

    const available = await getAvailableAppsForDevTeam(teamId)
    const linked = new Map(available.map((a) => [a.id, a.is_linked]))
    expect(linked.get(app1)).toBe(true)
    expect(linked.get(app2)).toBe(false)
  })

  it('getDevTeamsForApp excludes teams whose only link to the app is soft-deleted', async () => {
    const { teamId, app1 } = await setup()

    await setDevTeamApplications(teamId, [app1], 'A111111')
    expect((await getDevTeamsForApp(app1, 'nais-team')).map((t) => t.id)).toContain(teamId)

    await setDevTeamApplications(teamId, [], 'A999999')

    const teams = await getDevTeamsForApp(app1, 'nais-team')
    expect(teams.map((t) => t.id)).not.toContain(teamId)
  })

  it('soft-deleted row preserves the original (dev_team_id, monitored_app_id) for audit', async () => {
    const { teamId, app1 } = await setup()

    await setDevTeamApplications(teamId, [app1], 'A111111')
    await setDevTeamApplications(teamId, [], 'A999999')

    const { rows } = await pool.query(
      `SELECT dev_team_id, monitored_app_id, deleted_at, deleted_by
       FROM dev_team_applications
       WHERE dev_team_id = $1 AND monitored_app_id = $2`,
      [teamId, app1],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).not.toBeNull()
    expect(rows[0].deleted_by).toBe('A999999')
  })

  it('setDevTeamApplications does not bump xmin for unchanged active rows', async () => {
    const { teamId, app1, app2 } = await setup()

    await setDevTeamApplications(teamId, [app1, app2], 'A111111')
    const before = await pool.query(
      `SELECT monitored_app_id, xmin::text AS xmin
       FROM dev_team_applications WHERE dev_team_id = $1 ORDER BY monitored_app_id`,
      [teamId],
    )

    await setDevTeamApplications(teamId, [app1, app2], 'A999999')
    const after = await pool.query(
      `SELECT monitored_app_id, xmin::text AS xmin
       FROM dev_team_applications WHERE dev_team_id = $1 ORDER BY monitored_app_id`,
      [teamId],
    )
    expect(after.rows).toEqual(before.rows)
  })

  it('addAppToDevTeam does not bump xmin for an already-active link', async () => {
    const { teamId, app1 } = await setup()

    await addAppToDevTeam(teamId, app1)
    const before = await pool.query(
      `SELECT xmin::text AS xmin FROM dev_team_applications
       WHERE dev_team_id = $1 AND monitored_app_id = $2`,
      [teamId, app1],
    )

    await addAppToDevTeam(teamId, app1)
    const after = await pool.query(
      `SELECT xmin::text AS xmin FROM dev_team_applications
       WHERE dev_team_id = $1 AND monitored_app_id = $2`,
      [teamId, app1],
    )
    expect(after.rows[0].xmin).toBe(before.rows[0].xmin)
  })

  it('concurrent setDevTeamApplications calls for the same team serialize via advisory lock', async () => {
    const { teamId, app1, app2 } = await setup()

    await Promise.all([
      setDevTeamApplications(teamId, [app1], 'A111111'),
      setDevTeamApplications(teamId, [app2], 'A222222'),
    ])

    const active = await getDevTeamApplications(teamId)
    expect(active).toHaveLength(1)
    expect([app1, app2]).toContain(active[0].monitored_app_id)
  })
})

describe('removeAppFromDevTeam', () => {
  it('soft-deletes a single link with correct deleted_by', async () => {
    const { teamId, app1, app2 } = await setup()

    await setDevTeamApplications(teamId, [app1, app2], 'A111111')
    await removeAppFromDevTeam(teamId, app2, 'A999999')

    const active = await getDevTeamApplications(teamId)
    expect(active.map((a) => a.monitored_app_id)).toEqual([app1])

    const { rows } = await pool.query(
      `SELECT monitored_app_id, deleted_at, deleted_by
       FROM dev_team_applications
       WHERE dev_team_id = $1 ORDER BY monitored_app_id`,
      [teamId],
    )
    expect(rows).toHaveLength(2)
    const byApp = new Map(rows.map((r) => [r.monitored_app_id, r]))
    expect(byApp.get(app1).deleted_at).toBeNull()
    expect(byApp.get(app2).deleted_at).not.toBeNull()
    expect(byApp.get(app2).deleted_by).toBe('A999999')
  })

  it('is a no-op when called on an already-deleted link', async () => {
    const { teamId, app1 } = await setup()

    await setDevTeamApplications(teamId, [app1], 'A111111')
    await removeAppFromDevTeam(teamId, app1, 'A222222')

    const { rows: before } = await pool.query(
      `SELECT deleted_by FROM dev_team_applications
       WHERE dev_team_id = $1 AND monitored_app_id = $2`,
      [teamId, app1],
    )
    expect(before[0].deleted_by).toBe('A222222')

    await removeAppFromDevTeam(teamId, app1, 'A333333')

    const { rows: after } = await pool.query(
      `SELECT deleted_by FROM dev_team_applications
       WHERE dev_team_id = $1 AND monitored_app_id = $2`,
      [teamId, app1],
    )
    expect(after[0].deleted_by).toBe('A222222')
  })

  it('does not affect other links on the same team', async () => {
    const { teamId, app1, app2 } = await setup()

    await setDevTeamApplications(teamId, [app1, app2], 'A111111')
    await removeAppFromDevTeam(teamId, app1, 'A999999')

    const active = await getDevTeamApplications(teamId)
    expect(active.map((a) => a.monitored_app_id)).toEqual([app2])
  })
})
