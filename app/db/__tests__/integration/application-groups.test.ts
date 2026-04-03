/**
 * Integration test: Application group database queries.
 * Tests CRUD operations for application groups and verification propagation
 * against a real PostgreSQL instance.
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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

// ─── Helper ──────────────────────────────────────────────────────────────────

async function createGroup(name: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>('INSERT INTO application_groups (name) VALUES ($1) RETURNING id', [
    name,
  ])
  return rows[0].id
}

async function setAppGroup(appId: number, groupId: number | null): Promise<void> {
  await pool.query('UPDATE monitored_applications SET application_group_id = $1 WHERE id = $2', [groupId, appId])
}

// ─── Schema ──────────────────────────────────────────────────────────────────

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

// ─── CRUD functions ──────────────────────────────────────────────────────────

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
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    const app3 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'dev-gcp' })
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
    await addAppToGroup(group.id, appId)

    const siblings = await getSiblingApps(appId)
    expect(siblings).toEqual([])
  })

  it('deleteGroup should remove the group and unlink all apps', async () => {
    const { createApplicationGroup, addAppToGroup, deleteGroup, getGroupByAppId } = await import(
      '~/db/application-groups.server'
    )
    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)

    await deleteGroup(group.id)

    const group1 = await getGroupByAppId(app1)
    const group2 = await getGroupByAppId(app2)
    expect(group1).toBeNull()
    expect(group2).toBeNull()

    const { rows } = await pool.query('SELECT * FROM application_groups WHERE id = $1', [group.id])
    expect(rows).toHaveLength(0)
  })

  it('getAllGroups should return all groups with app counts', async () => {
    const { createApplicationGroup, addAppToGroup, getAllGroups } = await import('~/db/application-groups.server')
    const group1 = await createApplicationGroup('service-a')
    const group2 = await createApplicationGroup('service-b')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-a', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-a', environment: 'prod-fss' })
    const app3 = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc-b', environment: 'prod-gcp' })
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

// ─── Verification propagation ────────────────────────────────────────────────

describe('verification propagation', () => {
  it('should propagate approved status to sibling deployments with same commit SHA', async () => {
    const { createApplicationGroup, addAppToGroup } = await import('~/db/application-groups.server')
    const { propagateVerificationToSiblings } = await import('~/db/application-groups.server')

    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)

    const commitSha = 'abc123def456'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'approved',
      hasFourEyes: true,
    })
    const dep2 = await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
      hasFourEyes: false,
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'approved', commitSha, app1)
    expect(propagated).toBe(1)

    const { rows } = await pool.query('SELECT has_four_eyes, four_eyes_status FROM deployments WHERE id = $1', [dep2])
    expect(rows[0].has_four_eyes).toBe(true)
    expect(rows[0].four_eyes_status).toBe('approved')
  })

  it('should NOT propagate negative statuses', async () => {
    const { createApplicationGroup, addAppToGroup, propagateVerificationToSiblings } = await import(
      '~/db/application-groups.server'
    )

    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)

    const commitSha = 'abc123def456'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'unverified_commits',
      hasFourEyes: false,
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
      hasFourEyes: false,
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'unverified_commits', commitSha, app1)
    expect(propagated).toBe(0)
  })

  it('should NOT propagate to deployments with different commit SHA', async () => {
    const { createApplicationGroup, addAppToGroup, propagateVerificationToSiblings } = await import(
      '~/db/application-groups.server'
    )

    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)

    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'sha-one',
      fourEyesStatus: 'approved',
      hasFourEyes: true,
    })
    const dep2 = await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha: 'sha-two',
      fourEyesStatus: 'pending',
      hasFourEyes: false,
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'approved', 'sha-one', app1)
    expect(propagated).toBe(0)

    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [dep2])
    expect(rows[0].four_eyes_status).toBe('pending')
  })

  it('should NOT propagate to already-verified sibling deployments', async () => {
    const { createApplicationGroup, addAppToGroup, propagateVerificationToSiblings } = await import(
      '~/db/application-groups.server'
    )

    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'approved',
      hasFourEyes: true,
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'manually_approved',
      hasFourEyes: true,
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'approved', commitSha, app1)
    expect(propagated).toBe(0)
  })

  it('should NOT propagate when app is not in a group', async () => {
    const { propagateVerificationToSiblings } = await import('~/db/application-groups.server')

    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const dep = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'abc123',
      fourEyesStatus: 'approved',
      hasFourEyes: true,
    })

    const propagated = await propagateVerificationToSiblings(dep, 'approved', 'abc123', appId)
    expect(propagated).toBe(0)
  })

  it('should propagate manually_approved status', async () => {
    const { createApplicationGroup, addAppToGroup, propagateVerificationToSiblings } = await import(
      '~/db/application-groups.server'
    )

    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'manually_approved',
      hasFourEyes: true,
    })
    const dep2 = await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
      hasFourEyes: false,
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'manually_approved', commitSha, app1)
    expect(propagated).toBe(1)

    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [dep2])
    expect(rows[0].four_eyes_status).toBe('manually_approved')
  })

  it('should propagate to multiple siblings at once', async () => {
    const { createApplicationGroup, addAppToGroup, propagateVerificationToSiblings } = await import(
      '~/db/application-groups.server'
    )

    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    const app3 = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc', environment: 'dev-gcp' })
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)
    await addAppToGroup(group.id, app3)

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'approved',
      hasFourEyes: true,
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
      hasFourEyes: false,
    })
    await seedDeployment(pool, {
      monitoredAppId: app3,
      teamSlug: 'team-b',
      environment: 'dev-gcp',
      commitSha,
      fourEyesStatus: 'pending',
      hasFourEyes: false,
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'approved', commitSha, app1)
    expect(propagated).toBe(2)

    const { rows } = await pool.query(
      "SELECT id, four_eyes_status, has_four_eyes FROM deployments WHERE four_eyes_status = 'approved' ORDER BY id",
    )
    expect(rows).toHaveLength(3)
  })

  it.each([
    { status: 'implicitly_approved', label: 'implicitly_approved' },
    { status: 'no_changes', label: 'no_changes' },
    { status: 'approved_pr_with_unreviewed', label: 'approved_pr_with_unreviewed' },
  ])('should propagate $label status', async ({ status }) => {
    const { createApplicationGroup, addAppToGroup, propagateVerificationToSiblings } = await import(
      '~/db/application-groups.server'
    )

    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: status,
      hasFourEyes: true,
    })
    const dep2 = await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
      hasFourEyes: false,
    })

    const propagated = await propagateVerificationToSiblings(dep1, status, commitSha, app1)
    expect(propagated).toBe(1)

    const { rows } = await pool.query('SELECT has_four_eyes, four_eyes_status FROM deployments WHERE id = $1', [dep2])
    expect(rows[0].has_four_eyes).toBe(true)
    expect(rows[0].four_eyes_status).toBe(status)
  })

  it.each([
    { status: 'unverified_commits', label: 'unverified_commits' },
    { status: 'unauthorized_repository', label: 'unauthorized_repository' },
    { status: 'unauthorized_branch', label: 'unauthorized_branch' },
    { status: 'error', label: 'error' },
    { status: 'pending_baseline', label: 'pending_baseline' },
  ])('should NOT propagate $label status', async ({ status }) => {
    const { createApplicationGroup, addAppToGroup, propagateVerificationToSiblings } = await import(
      '~/db/application-groups.server'
    )

    const group = await createApplicationGroup('my-service')
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await addAppToGroup(group.id, app1)
    await addAppToGroup(group.id, app2)

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: status,
      hasFourEyes: false,
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
      hasFourEyes: false,
    })

    const propagated = await propagateVerificationToSiblings(dep1, status, commitSha, app1)
    expect(propagated).toBe(0)
  })
})
