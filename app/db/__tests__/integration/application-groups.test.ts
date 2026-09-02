import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { seedApp, truncateAllTables } from './helpers'

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

async function createGroup(name: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>('INSERT INTO application_groups (name) VALUES ($1) RETURNING id', [
    name,
  ])
  return rows[0].id
}

async function setAppGroup(appId: number, groupId: number | null): Promise<void> {
  await pool.query('UPDATE monitored_applications SET application_group_id = $1 WHERE id = $2', [groupId, appId])
}

async function softDeleteGroup(groupId: number, deletedBy: string): Promise<void> {
  await pool.query('UPDATE application_groups SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1', [
    groupId,
    deletedBy,
  ])
}

describe('application_groups schema', () => {
  it('should create an application group', async () => {
    const groupId = await createGroup('my-service')

    const { rows } = await pool.query('SELECT * FROM application_groups WHERE id = $1', [groupId])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('my-service')
    expect(rows[0].created_at).toBeDefined()
  })

  it('should link a monitored application to a group', async () => {
    const groupId = await createGroup('my-service')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })

    await setAppGroup(appId, groupId)

    const { rows } = await pool.query('SELECT application_group_id FROM monitored_applications WHERE id = $1', [appId])
    expect(rows[0].application_group_id).toBe(groupId)
  })

  it('should set application_group_id to NULL when group is deleted', async () => {
    const groupId = await createGroup('my-service')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await setAppGroup(appId, groupId)

    await pool.query('DELETE FROM application_groups WHERE id = $1', [groupId])

    const { rows } = await pool.query('SELECT application_group_id FROM monitored_applications WHERE id = $1', [appId])
    expect(rows[0].application_group_id).toBeNull()
  })

  it('should allow multiple apps in the same group', async () => {
    const groupId = await createGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })

    await setAppGroup(app1, groupId)
    await setAppGroup(app2, groupId)

    const { rows } = await pool.query(
      'SELECT id FROM monitored_applications WHERE application_group_id = $1 ORDER BY id',
      [groupId],
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.id)).toEqual([app1, app2])
  })
})

describe('getGroupByAppId', () => {
  it('should return the group an app belongs to', async () => {
    const { getGroupByAppId } = await import('~/db/application-groups.server')
    const groupId = await createGroup('my-service')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await setAppGroup(appId, groupId)

    const result = await getGroupByAppId(appId)
    expect(result).not.toBeNull()
    expect(result?.id).toBe(groupId)
    expect(result?.name).toBe('my-service')
  })

  it('should return null for an ungrouped app', async () => {
    const { getGroupByAppId } = await import('~/db/application-groups.server')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })

    const result = await getGroupByAppId(appId)
    expect(result).toBeNull()
  })
})

describe('getGroupWithApps', () => {
  it('should return the group and its apps', async () => {
    const { getGroupWithApps } = await import('~/db/application-groups.server')
    const groupId = await createGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await setAppGroup(app1, groupId)
    await setAppGroup(app2, groupId)

    const result = await getGroupWithApps(groupId)
    expect(result).not.toBeNull()
    expect(result?.name).toBe('my-service')
    expect(result?.apps.map((a) => a.id).sort()).toEqual([app1, app2].sort())
  })

  it('should return null for a soft-deleted group', async () => {
    const { getGroupWithApps } = await import('~/db/application-groups.server')
    const groupId = await createGroup('my-service')
    await softDeleteGroup(groupId, 'A123456')

    const result = await getGroupWithApps(groupId)
    expect(result).toBeNull()
  })

  it('should return null for a non-existent group', async () => {
    const { getGroupWithApps } = await import('~/db/application-groups.server')
    const result = await getGroupWithApps(999999)
    expect(result).toBeNull()
  })
})

describe('getSiblingApps', () => {
  it('should return other apps in the same group', async () => {
    const { getSiblingApps } = await import('~/db/application-groups.server')
    const groupId = await createGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    const app3 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'dev-gcp' })
    await setAppGroup(app1, groupId)
    await setAppGroup(app2, groupId)
    await setAppGroup(app3, groupId)

    const siblings = await getSiblingApps(app1)
    expect(siblings).toHaveLength(2)
    expect(siblings.map((s) => s.id).sort()).toEqual([app2, app3].sort())
  })

  it('should return empty array for ungrouped app', async () => {
    const { getSiblingApps } = await import('~/db/application-groups.server')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })

    const siblings = await getSiblingApps(appId)
    expect(siblings).toEqual([])
  })

  it('should return empty array for sole app in group', async () => {
    const { getSiblingApps } = await import('~/db/application-groups.server')
    const groupId = await createGroup('solo')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await setAppGroup(appId, groupId)

    const siblings = await getSiblingApps(appId)
    expect(siblings).toEqual([])
  })

  it('should treat soft-deleted group as ungrouped', async () => {
    const { getSiblingApps } = await import('~/db/application-groups.server')
    const groupId = await createGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await setAppGroup(app1, groupId)
    await setAppGroup(app2, groupId)

    await softDeleteGroup(groupId, 'A123456')

    const siblings = await getSiblingApps(app1)
    expect(siblings).toEqual([])
  })
})

describe('getGroupContext', () => {
  it('should return group and siblings for a grouped app', async () => {
    const { getGroupContext } = await import('~/db/application-groups.server')
    const groupId = await createGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    const app3 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'dev-gcp' })
    await setAppGroup(app1, groupId)
    await setAppGroup(app2, groupId)
    await setAppGroup(app3, groupId)

    const ctx = await getGroupContext(app1)
    expect(ctx.group).not.toBeNull()
    expect(ctx.group?.id).toBe(groupId)
    expect(ctx.group?.name).toBe('my-service')
    expect(ctx.siblings).toHaveLength(2)
    expect(ctx.siblings.map((s) => s.id).sort()).toEqual([app2, app3].sort())
  })

  it('should return null group and empty siblings for ungrouped app', async () => {
    const { getGroupContext } = await import('~/db/application-groups.server')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })

    const ctx = await getGroupContext(appId)
    expect(ctx.group).toBeNull()
    expect(ctx.siblings).toEqual([])
  })

  it('should return empty siblings for sole app in group', async () => {
    const { getGroupContext } = await import('~/db/application-groups.server')
    const groupId = await createGroup('solo')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await setAppGroup(appId, groupId)

    const ctx = await getGroupContext(appId)
    expect(ctx.group).not.toBeNull()
    expect(ctx.group?.id).toBe(groupId)
    expect(ctx.siblings).toEqual([])
  })

  it('should treat soft-deleted group as ungrouped', async () => {
    const { getGroupContext } = await import('~/db/application-groups.server')
    const groupId = await createGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await setAppGroup(app1, groupId)
    await setAppGroup(app2, groupId)

    await softDeleteGroup(groupId, 'A123456')

    const ctx = await getGroupContext(app1)
    expect(ctx.group).toBeNull()
    expect(ctx.siblings).toEqual([])
  })

  it('should match getSiblingApps ordering (environment_name, team_slug)', async () => {
    const { getGroupContext } = await import('~/db/application-groups.server')
    const groupId = await createGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc', environment: 'prod-gcp' })
    const app3 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'dev-gcp' })
    await setAppGroup(app1, groupId)
    await setAppGroup(app2, groupId)
    await setAppGroup(app3, groupId)

    const ctx = await getGroupContext(app1)
    expect(ctx.siblings[0].environment_name).toBe('dev-gcp')
    expect(ctx.siblings[1].environment_name).toBe('prod-gcp')
  })
})

describe('getAppIdsByGroupIds', () => {
  it('returns app ids grouped by group id', async () => {
    const { getAppIdsByGroupIds } = await import('~/db/application-groups.server')
    const group1 = await createGroup('svc-a')
    const group2 = await createGroup('svc-b')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-a', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-a', environment: 'prod-fss' })
    const app3 = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc-b', environment: 'prod-gcp' })
    await setAppGroup(app1, group1)
    await setAppGroup(app2, group1)
    await setAppGroup(app3, group2)

    const result = await getAppIdsByGroupIds([group1, group2])
    expect(result.get(group1)?.sort()).toEqual([app1, app2].sort())
    expect(result.get(group2)).toEqual([app3])
  })

  it('returns an empty map for an empty list of group ids', async () => {
    const { getAppIdsByGroupIds } = await import('~/db/application-groups.server')
    const result = await getAppIdsByGroupIds([])
    expect(result.size).toBe(0)
  })

  it('excludes apps belonging to a soft-deleted group', async () => {
    const { getAppIdsByGroupIds } = await import('~/db/application-groups.server')
    const groupId = await createGroup('svc-a')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-a', environment: 'prod-gcp' })
    await setAppGroup(appId, groupId)

    await softDeleteGroup(groupId, 'A123456')

    const result = await getAppIdsByGroupIds([groupId])
    expect(result.has(groupId)).toBe(false)
  })
})
