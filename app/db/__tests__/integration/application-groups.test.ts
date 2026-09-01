import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { seedApp, seedDevTeam, seedSection, truncateAllTables } from './helpers'

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

async function linkAppToTeam(teamId: number, appId: number): Promise<void> {
  await pool.query(
    'INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [teamId, appId],
  )
}

async function setAppInactive(appId: number): Promise<void> {
  await pool.query('UPDATE monitored_applications SET is_active = false WHERE id = $1', [appId])
}

async function seedActiveRepo(appId: number, owner: string, repoName: string): Promise<void> {
  await pool.query(
    `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status)
     VALUES ($1, $2, $3, 'active')`,
    [appId, owner, repoName],
  )
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

describe('application-groups CRUD', () => {
  it('createApplicationGroup should return the new group', async () => {
    const { createApplicationGroup } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('my-service')

    expect(group.id).toBeGreaterThan(0)
    expect(group.name).toBe('my-service')
  })

  it('addAppToGroup should link an app', async () => {
    const { createApplicationGroup, addAppToGroup, getGroupWithApps } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('my-service')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(appId, 'navikt', 'shared-repo')

    await addAppToGroup(group.id, appId)

    const fetched = await getGroupWithApps(group.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.apps).toHaveLength(1)
    expect(fetched?.apps[0].id).toBe(appId)
  })

  it('removeAppFromGroup should unlink an app', async () => {
    const { createApplicationGroup, addAppToGroup, removeAppFromGroup, getGroupWithApps } = await import(
      '~/db/application-groups.server'
    )
    const group = await createApplicationGroup('my-service')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(appId, 'navikt', 'shared-repo')

    await addAppToGroup(group.id, appId)
    await removeAppFromGroup(appId)

    const fetched = await getGroupWithApps(group.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.apps).toHaveLength(0)
  })

  it('getGroupByAppId should return the group an app belongs to', async () => {
    const { createApplicationGroup, addAppToGroup, getGroupByAppId } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('my-service')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(appId, 'navikt', 'shared-repo')
    await addAppToGroup(group.id, appId)

    const result = await getGroupByAppId(appId)
    expect(result).not.toBeNull()
    expect(result?.id).toBe(group.id)
    expect(result?.name).toBe('my-service')
  })

  it('getGroupByAppId should return null for an ungrouped app', async () => {
    const { getGroupByAppId } = await import('~/db/application-groups.server')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })

    const result = await getGroupByAppId(appId)
    expect(result).toBeNull()
  })

  it('getSiblingApps should return other apps in the same group', async () => {
    const { createApplicationGroup, addAppToGroup, getSiblingApps } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(app1, 'navikt', 'shared-repo')
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedActiveRepo(app2, 'navikt', 'shared-repo')
    const app3 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'dev-gcp' })
    await seedActiveRepo(app3, 'navikt', 'shared-repo')
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)
    await addAppToGroup(group.id, app3)

    const siblings = await getSiblingApps(app1)
    expect(siblings).toHaveLength(2)
    expect(siblings.map((s) => s.id).sort()).toEqual([app2, app3].sort())
  })

  it('getSiblingApps should return empty array for ungrouped app', async () => {
    const { getSiblingApps } = await import('~/db/application-groups.server')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })

    const siblings = await getSiblingApps(appId)
    expect(siblings).toEqual([])
  })

  it('getSiblingApps should return empty array for sole app in group', async () => {
    const { createApplicationGroup, addAppToGroup, getSiblingApps } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('solo')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(appId, 'navikt', 'shared-repo')
    await addAppToGroup(group.id, appId)

    const siblings = await getSiblingApps(appId)
    expect(siblings).toEqual([])
  })

  it('deleteGroup should soft-delete the group and unlink all apps', async () => {
    const { createApplicationGroup, addAppToGroup, deleteGroup, getGroupByAppId, getAllGroups } = await import(
      '~/db/application-groups.server'
    )
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(app1, 'navikt', 'shared-repo')
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedActiveRepo(app2, 'navikt', 'shared-repo')
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)

    await deleteGroup(group.id, 'A123456')

    const group1 = await getGroupByAppId(app1)
    const group2 = await getGroupByAppId(app2)
    expect(group1).toBeNull()
    expect(group2).toBeNull()

    const { getGroupWithApps } = await import('~/db/application-groups.server')
    expect(await getGroupWithApps(group.id)).toBeNull()

    const { rows } = await pool.query<{ deleted_at: Date | null; deleted_by: string | null }>(
      'SELECT deleted_at, deleted_by FROM application_groups WHERE id = $1',
      [group.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).not.toBeNull()
    expect(rows[0].deleted_by).toBe('A123456')

    const all = await getAllGroups()
    expect(all.find((g) => g.id === group.id)).toBeUndefined()
  })

  it('getAllGroups should return all groups with app counts', async () => {
    const { createApplicationGroup, addAppToGroup, getAllGroups } = await import('~/db/application-groups.server')
    const group1 = await createApplicationGroup('service-a')
    const group2 = await createApplicationGroup('service-b')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-a', environment: 'prod-gcp' })
    await seedActiveRepo(app1, 'navikt', 'shared-repo')
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-a', environment: 'prod-fss' })
    await seedActiveRepo(app2, 'navikt', 'shared-repo')
    const app3 = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc-b', environment: 'prod-gcp' })
    await seedActiveRepo(app3, 'navikt', 'other-shared-repo')
    await addAppToGroup(group1.id, app1)
    await addAppToGroup(group1.id, app2)
    await addAppToGroup(group2.id, app3)

    const groups = await getAllGroups()
    expect(groups).toHaveLength(2)

    const g1 = groups.find((g) => g.id === group1.id)
    const g2 = groups.find((g) => g.id === group2.id)
    expect(g1).toBeDefined()
    expect(g2).toBeDefined()
    expect(g1?.app_count).toBe(2)
    expect(g2?.app_count).toBe(1)
  })
})

describe('application groups require a shared git repository', () => {
  it('addAppToGroup should reject an app whose active repo differs from an existing member', async () => {
    const { createApplicationGroup, addAppToGroup } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedActiveRepo(app1, 'navikt', 'repo-a')
    await seedActiveRepo(app2, 'navikt', 'repo-b')

    await addAppToGroup(group.id, app1)
    const added = await addAppToGroup(group.id, app2)

    expect(added).toBe(false)
    const { rows } = await pool.query('SELECT application_group_id FROM monitored_applications WHERE id = $1', [app2])
    expect(rows[0].application_group_id).toBeNull()
  })

  it('addAppToGroup should allow an app that shares an active repo with an existing member', async () => {
    const { createApplicationGroup, addAppToGroup } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedActiveRepo(app1, 'navikt', 'repo-a')
    await seedActiveRepo(app2, 'navikt', 'repo-a')

    await addAppToGroup(group.id, app1)
    const added = await addAppToGroup(group.id, app2)

    expect(added).toBe(true)
    const { rows } = await pool.query('SELECT application_group_id FROM monitored_applications WHERE id = $1', [app2])
    expect(rows[0].application_group_id).toBe(group.id)
  })

  it('addAppToGroup should reject an app with no registered active repo from joining a group that has one', async () => {
    const { createApplicationGroup, addAppToGroup } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedActiveRepo(app1, 'navikt', 'repo-a')

    await addAppToGroup(group.id, app1)
    const added = await addAppToGroup(group.id, app2)

    expect(added).toBe(false)
    const { rows } = await pool.query('SELECT application_group_id FROM monitored_applications WHERE id = $1', [app2])
    expect(rows[0].application_group_id).toBeNull()
  })

  it('addAppToGroup should reject an app with no registered active repo even when founding an empty group', async () => {
    const { createApplicationGroup, addAppToGroup } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })

    const added = await addAppToGroup(group.id, app1)

    expect(added).toBe(false)
    const { rows } = await pool.query('SELECT application_group_id FROM monitored_applications WHERE id = $1', [app1])
    expect(rows[0].application_group_id).toBeNull()
  })

  it('addAppToGroup should reject when the group is soft-deleted', async () => {
    const { createApplicationGroup, addAppToGroup, deleteGroup } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(app1, 'navikt', 'repo-a')
    await deleteGroup(group.id, 'Z990001')

    const added = await addAppToGroup(group.id, app1)

    expect(added).toBe(false)
  })

  it('addAppToGroup should reject when the group does not exist', async () => {
    const { addAppToGroup } = await import('~/db/application-groups.server')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(app1, 'navikt', 'repo-a')

    const added = await addAppToGroup(999999999, app1)

    expect(added).toBe(false)
  })

  it('addTeamAppToGroupConditional should reject an app whose active repo differs from an existing member', async () => {
    const { createApplicationGroup, addTeamAppToGroupConditional } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'section-a')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await linkAppToTeam(teamId, app1)
    await linkAppToTeam(teamId, app2)
    await seedActiveRepo(app1, 'navikt', 'repo-a')
    await seedActiveRepo(app2, 'navikt', 'repo-b')

    expect(await addTeamAppToGroupConditional(group.id, app1, teamId)).toBe(true)
    expect(await addTeamAppToGroupConditional(group.id, app2, teamId)).toBe(false)

    const { rows } = await pool.query('SELECT application_group_id FROM monitored_applications WHERE id = $1', [app2])
    expect(rows[0].application_group_id).toBeNull()
  })

  it('selectAppsSharingRepository should pick the largest subset sharing an active repo', async () => {
    const { selectAppsSharingRepository } = await import('~/db/application-groups.server')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc', environment: 'prod-gcp' })
    const app3 = await seedApp(pool, { teamSlug: 'team-c', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(app1, 'navikt', 'repo-a')
    await seedActiveRepo(app2, 'navikt', 'repo-a')
    await seedActiveRepo(app3, 'navikt', 'repo-b')

    const { matched, skipped } = await selectAppsSharingRepository([{ id: app1 }, { id: app2 }, { id: app3 }])

    expect(matched.map((a) => a.id).sort()).toEqual([app1, app2].sort())
    expect(skipped).toBe(1)
  })

  it('selectAppsSharingRepository should skip all candidates when none has a registered active repo', async () => {
    const { selectAppsSharingRepository } = await import('~/db/application-groups.server')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc', environment: 'prod-gcp' })

    const { matched, skipped } = await selectAppsSharingRepository([{ id: app1 }, { id: app2 }])

    expect(matched).toEqual([])
    expect(skipped).toBe(2)
  })

  it('selectAppsSharingRepository should return the input unchanged for fewer than two candidates', async () => {
    const { selectAppsSharingRepository } = await import('~/db/application-groups.server')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })

    const { matched, skipped } = await selectAppsSharingRepository([{ id: app1 }])

    expect(matched).toEqual([{ id: app1 }])
    expect(skipped).toBe(0)
  })
})

describe('getGroupContext', () => {
  it('should return group and siblings for a grouped app', async () => {
    const { createApplicationGroup, addAppToGroup, getGroupContext } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(app1, 'navikt', 'shared-repo')
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedActiveRepo(app2, 'navikt', 'shared-repo')
    const app3 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'dev-gcp' })
    await seedActiveRepo(app3, 'navikt', 'shared-repo')
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)
    await addAppToGroup(group.id, app3)

    const ctx = await getGroupContext(app1)
    expect(ctx.group).not.toBeNull()
    expect(ctx.group?.id).toBe(group.id)
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
    const { createApplicationGroup, addAppToGroup, getGroupContext } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('solo')
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(appId, 'navikt', 'shared-repo')
    await addAppToGroup(group.id, appId)

    const ctx = await getGroupContext(appId)
    expect(ctx.group).not.toBeNull()
    expect(ctx.group?.id).toBe(group.id)
    expect(ctx.siblings).toEqual([])
  })

  it('should treat soft-deleted group as ungrouped', async () => {
    const { createApplicationGroup, addAppToGroup, deleteGroup, getGroupContext } = await import(
      '~/db/application-groups.server'
    )
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(app1, 'navikt', 'shared-repo')
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedActiveRepo(app2, 'navikt', 'shared-repo')
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)

    await deleteGroup(group.id, 'A123456')

    const ctx = await getGroupContext(app1)
    expect(ctx.group).toBeNull()
    expect(ctx.siblings).toEqual([])
  })

  it('should match getSiblingApps ordering (environment_name, team_slug)', async () => {
    const { createApplicationGroup, addAppToGroup, getGroupContext } = await import('~/db/application-groups.server')
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(app1, 'navikt', 'shared-repo')
    const app2 = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(app2, 'navikt', 'shared-repo')
    const app3 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'dev-gcp' })
    await seedActiveRepo(app3, 'navikt', 'shared-repo')
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)
    await addAppToGroup(group.id, app3)

    const ctx = await getGroupContext(app1)
    expect(ctx.siblings[0].environment_name).toBe('dev-gcp')
    expect(ctx.siblings[1].environment_name).toBe('prod-gcp')
  })
})

describe('getGroupsForDevTeam', () => {
  it('returns groups containing at least one team app, marking is_team_app correctly', async () => {
    const { createApplicationGroup, addAppToGroup, getGroupsForDevTeam } = await import(
      '~/db/application-groups.server'
    )
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appTeam = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(appTeam, 'navikt', 'shared-repo')
    const appOther = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc', environment: 'prod-fss' })
    await seedActiveRepo(appOther, 'navikt', 'shared-repo')
    const group = await createApplicationGroup('svc')
    await addAppToGroup(group.id, appTeam)
    await addAppToGroup(group.id, appOther)
    await linkAppToTeam(teamId, appTeam)

    const groups = await getGroupsForDevTeam(teamId)
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe(group.id)
    const teamAppEntry = groups[0].apps.find((a) => a.id === appTeam)
    const otherEntry = groups[0].apps.find((a) => a.id === appOther)
    expect(teamAppEntry?.is_team_app).toBe(true)
    expect(otherEntry?.is_team_app).toBe(false)
  })

  it('excludes groups where no app belongs to the team', async () => {
    const { createApplicationGroup, addAppToGroup, getGroupsForDevTeam } = await import(
      '~/db/application-groups.server'
    )
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appOther = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(appOther, 'navikt', 'shared-repo')
    const group = await createApplicationGroup('svc')
    await addAppToGroup(group.id, appOther)

    const groups = await getGroupsForDevTeam(teamId)
    expect(groups).toHaveLength(0)
  })

  it('excludes soft-deleted groups', async () => {
    const { createApplicationGroup, addAppToGroup, deleteGroup, getGroupsForDevTeam } = await import(
      '~/db/application-groups.server'
    )
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const app = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(app, 'navikt', 'shared-repo')
    await linkAppToTeam(teamId, app)
    const group = await createApplicationGroup('svc')
    await addAppToGroup(group.id, app)
    await deleteGroup(group.id, 'Z990001')

    const groups = await getGroupsForDevTeam(teamId)
    expect(groups).toHaveLength(0)
  })
})

describe('getUngroupedTeamApps', () => {
  it('returns active ungrouped apps belonging to the team', async () => {
    const { getUngroupedTeamApps } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await linkAppToTeam(teamId, app1)
    await linkAppToTeam(teamId, app2)

    const ungrouped = await getUngroupedTeamApps(teamId)
    expect(ungrouped.map((a) => a.id).sort()).toEqual([app1, app2].sort())
  })

  it('excludes apps already in a group', async () => {
    const { createApplicationGroup, addAppToGroup, getUngroupedTeamApps } = await import(
      '~/db/application-groups.server'
    )
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(app1, 'navikt', 'shared-repo')
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await linkAppToTeam(teamId, app1)
    await linkAppToTeam(teamId, app2)
    const group = await createApplicationGroup('svc')
    await addAppToGroup(group.id, app1)

    const ungrouped = await getUngroupedTeamApps(teamId)
    expect(ungrouped).toHaveLength(1)
    expect(ungrouped[0].id).toBe(app2)
  })

  it('excludes inactive apps', async () => {
    const { getUngroupedTeamApps } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const app = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await linkAppToTeam(teamId, app)
    await setAppInactive(app)

    const ungrouped = await getUngroupedTeamApps(teamId)
    expect(ungrouped).toHaveLength(0)
  })

  it('excludes apps from other teams', async () => {
    const { getUngroupedTeamApps } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    await seedApp(pool, { teamSlug: 'team-b', appName: 'svc', environment: 'prod-gcp' })

    const ungrouped = await getUngroupedTeamApps(teamId)
    expect(ungrouped).toHaveLength(0)
  })
})

describe('verifyAllTeamApps', () => {
  it('returns true when all app IDs belong to the team', async () => {
    const { verifyAllTeamApps } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await linkAppToTeam(teamId, app1)
    await linkAppToTeam(teamId, app2)

    expect(await verifyAllTeamApps(teamId, [app1, app2])).toBe(true)
  })

  it('returns false when one app does not belong to the team', async () => {
    const { verifyAllTeamApps } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-b', appName: 'other', environment: 'prod-gcp' })
    await linkAppToTeam(teamId, app1)

    expect(await verifyAllTeamApps(teamId, [app1, app2])).toBe(false)
  })

  it('deduplicates app IDs before counting', async () => {
    const { verifyAllTeamApps } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const app = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await linkAppToTeam(teamId, app)

    expect(await verifyAllTeamApps(teamId, [app, app, app])).toBe(true)
  })

  it('returns true for empty list', async () => {
    const { verifyAllTeamApps } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    expect(await verifyAllTeamApps(teamId, [])).toBe(true)
  })
})

describe('isTeamApp', () => {
  it('returns true for an app belonging to the team', async () => {
    const { isTeamApp } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await linkAppToTeam(teamId, appId)

    expect(await isTeamApp(teamId, appId)).toBe(true)
  })

  it('returns false for an app belonging to a different team', async () => {
    const { isTeamApp } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc', environment: 'prod-gcp' })

    expect(await isTeamApp(teamId, appId)).toBe(false)
  })

  it('returns false when the app link is soft-deleted', async () => {
    const { isTeamApp } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await linkAppToTeam(teamId, appId)
    await pool.query(
      'UPDATE dev_team_applications SET deleted_at = now() WHERE dev_team_id = $1 AND monitored_app_id = $2',
      [teamId, appId],
    )

    expect(await isTeamApp(teamId, appId)).toBe(false)
  })
})

describe('isTeamGroup', () => {
  it('returns true when group contains at least one team app', async () => {
    const { createApplicationGroup, addAppToGroup, isTeamGroup } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(appId, 'navikt', 'shared-repo')
    await linkAppToTeam(teamId, appId)
    const group = await createApplicationGroup('svc')
    await addAppToGroup(group.id, appId)

    expect(await isTeamGroup(teamId, group.id)).toBe(true)
  })

  it('returns false when group contains no team apps', async () => {
    const { createApplicationGroup, addAppToGroup, isTeamGroup } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appOther = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc', environment: 'prod-gcp' })
    await seedActiveRepo(appOther, 'navikt', 'shared-repo')
    const group = await createApplicationGroup('svc')
    await addAppToGroup(group.id, appOther)

    expect(await isTeamGroup(teamId, group.id)).toBe(false)
  })

  it('returns false for a non-existent group', async () => {
    const { isTeamGroup } = await import('~/db/application-groups.server')
    const sectionId = await seedSection(pool, 'sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    expect(await isTeamGroup(teamId, 999999)).toBe(false)
  })
})
