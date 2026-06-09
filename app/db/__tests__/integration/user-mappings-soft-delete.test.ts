import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { searchDeployments } from '../../deployments.server'
import {
  deleteUserMapping,
  getAllUserMappings,
  getUnmappedUsers,
  getUserMapping,
  getUserMappingByNavIdent,
  getUserMappingBySlackId,
  getUserMappings,
  upsertUserMapping,
} from '../../user-mappings.server'
import { seedApp, seedDeployment, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})

async function seedDeploy(pool: Pool, deployer: string) {
  const app = await pool.query<{ id: number }>(
    `INSERT INTO monitored_applications (team_slug, app_name, environment_name, is_active, audit_start_year, default_branch)
     VALUES ('t', $1, 'dev', true, 2025, 'main') RETURNING id`,
    [`a-${deployer}`],
  )
  await pool.query(
    `INSERT INTO deployments (
       monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name,
       commit_sha, created_at, four_eyes_status, deployer_username
     ) VALUES ($1, $2, 't', $3, 'dev', $4, NOW(), 'pending', $5)`,
    [app.rows[0].id, `nd-${deployer}-${Date.now()}`, `a-${deployer}`, `sha-${deployer}`, deployer],
  )
}

describe('user_mappings soft delete', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('soft-deletes by setting deleted_at and deleted_by', async () => {
    await upsertUserMapping({ githubUsername: 'octocat', displayName: 'Octo Cat', navIdent: 'Z990001' })
    await deleteUserMapping('octocat', 'Z990002')

    const { rows } = await pool.query('SELECT deleted_at, deleted_by FROM user_mappings WHERE github_username = $1', [
      'octocat',
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).not.toBeNull()
    expect(rows[0].deleted_by).toBe('Z990002')
  })

  it('getUserMapping still returns soft-deleted mapping (audit history)', async () => {
    await upsertUserMapping({ githubUsername: 'octocat', displayName: 'Octo Cat' })
    await deleteUserMapping('octocat', 'Z990002')

    const mapping = await getUserMapping('octocat')
    expect(mapping?.display_name).toBe('Octo Cat')
    expect(mapping?.deleted_at).not.toBeNull()
  })

  it('getUserMappings still returns soft-deleted mappings', async () => {
    await upsertUserMapping({ githubUsername: 'octocat', displayName: 'Octo Cat' })
    await deleteUserMapping('octocat', null)

    const mappings = await getUserMappings(['octocat'])
    expect(mappings.get('octocat')?.display_name).toBe('Octo Cat')
  })

  it('getUserMapping resolves case-insensitively for GitHub usernames', async () => {
    await upsertUserMapping({ githubUsername: 'OctoCat', displayName: 'Octo Cat', navIdent: 'Z990001' })

    const byMixedCase = await getUserMapping('OctoCat')
    expect(byMixedCase?.display_name).toBe('Octo Cat')

    const byUpperCase = await getUserMapping('OCTOCAT')
    expect(byUpperCase?.display_name).toBe('Octo Cat')
  })

  it('getUserMappings resolves case-insensitively for GitHub usernames', async () => {
    await upsertUserMapping({ githubUsername: 'OctoCat', displayName: 'Octo Cat' })

    const mappings = await getUserMappings(['OCTOCAT', 'OctoCat'])
    expect(mappings.get('OCTOCAT')?.display_name).toBe('Octo Cat')
    expect(mappings.get('OctoCat')?.display_name).toBe('Octo Cat')
  })

  it('getAllUserMappings excludes soft-deleted', async () => {
    await upsertUserMapping({ githubUsername: 'alive', displayName: 'Alive' })
    await upsertUserMapping({ githubUsername: 'dead', displayName: 'Dead' })
    await deleteUserMapping('dead', null)

    const all = await getAllUserMappings()
    expect(all.map((m) => m.github_username).sort()).toEqual(['alive'])
  })

  it('getUserMappingByNavIdent still returns user when only github account is soft-deleted', async () => {
    await upsertUserMapping({ githubUsername: 'octocat', navIdent: 'Z990001' })
    await deleteUserMapping('octocat', null)

    // User row in `users` table is still active — only the GitHub account is soft-deleted.
    // getUserMappingByNavIdent finds users by nav_ident, not by github account.
    const user = await getUserMappingByNavIdent('Z990001')
    expect(user).not.toBeNull()
    expect(user?.github_username).toBeNull()
    expect(user?.nav_ident).toBe('Z990001')
  })

  it('getUserMappingBySlackId excludes soft-deleted (current-state lookup)', async () => {
    await upsertUserMapping({ githubUsername: 'octocat', slackMemberId: 'U001' })
    await deleteUserMapping('octocat', null)

    expect(await getUserMappingBySlackId('U001')).toBeNull()
  })

  it('getUnmappedUsers treats soft-deleted as missing mapping', async () => {
    await seedDeploy(pool, 'octocat')
    await upsertUserMapping({ githubUsername: 'octocat', displayName: 'Octo Cat' })

    expect(await getUnmappedUsers()).toEqual([])

    await deleteUserMapping('octocat', null)
    const unmapped = await getUnmappedUsers()
    expect(unmapped.map((u) => u.github_username)).toEqual(['octocat'])
  })

  it('upsertUserMapping undeletes a soft-deleted row and updates fields', async () => {
    await upsertUserMapping({ githubUsername: 'octocat', displayName: 'Octo Cat', navIdent: 'Z990001' })
    await deleteUserMapping('octocat', 'Z990002')

    const restored = await upsertUserMapping({ githubUsername: 'octocat', displayName: 'Octo Cat 2' })

    expect(restored.deleted_at).toBeNull()
    expect(restored.deleted_by).toBeNull()
    expect(restored.display_name).toBe('Octo Cat 2')
    // Pre-existing nav_ident is preserved by COALESCE merge semantics.
    expect(restored.nav_ident).toBe('Z990001')

    expect((await getAllUserMappings()).length).toBe(1)
  })

  it('deleteUserMapping is idempotent (re-deleting does not change deleted_at/by)', async () => {
    await upsertUserMapping({ githubUsername: 'octocat' })
    await deleteUserMapping('octocat', 'A111111')

    const { rows: first } = await pool.query<{ deleted_at: Date; deleted_by: string }>(
      'SELECT deleted_at, deleted_by FROM user_mappings WHERE github_username = $1',
      ['octocat'],
    )

    // Second delete with a different actor should be a no-op (WHERE deleted_at IS NULL guards).
    await deleteUserMapping('octocat', 'B222222')

    const { rows: second } = await pool.query<{ deleted_at: Date; deleted_by: string }>(
      'SELECT deleted_at, deleted_by FROM user_mappings WHERE github_username = $1',
      ['octocat'],
    )

    expect(second[0].deleted_at.getTime()).toBe(first[0].deleted_at.getTime())
    expect(second[0].deleted_by).toBe('A111111')
  })

  it('searchDeployments excludes soft-deleted mappings from user search', async () => {
    await seedDeploy(pool, 'octocat')
    await upsertUserMapping({
      githubUsername: 'octocat',
      displayName: 'Octo Cat',
      navIdent: 'Z990001',
      navEmail: 'octo.cat@nav.no',
      slackMemberId: 'U001OCTO',
    })

    // Active mapping is discoverable by every joined field.
    expect((await searchDeployments('Octo Cat')).some((r) => r.type === 'user')).toBe(true)
    expect((await searchDeployments('Z990001')).some((r) => r.type === 'user')).toBe(true)
    expect((await searchDeployments('octo.cat')).some((r) => r.type === 'user')).toBe(true)
    expect((await searchDeployments('U001OCTO')).some((r) => r.type === 'user')).toBe(true)

    await deleteUserMapping('octocat', 'Z990002')

    // Soft-deleted mapping no longer matches via mapping fields.
    expect((await searchDeployments('Octo Cat')).some((r) => r.type === 'user')).toBe(false)
    expect((await searchDeployments('Z990001')).some((r) => r.type === 'user')).toBe(false)
    expect((await searchDeployments('octo.cat')).some((r) => r.type === 'user')).toBe(false)
    expect((await searchDeployments('U001OCTO')).some((r) => r.type === 'user')).toBe(false)

    // Direct deployer_username search still finds the deployment activity.
    const byUsername = await searchDeployments('octocat')
    expect(byUsername.some((r) => r.type === 'user' && r.url === '/users/octocat')).toBe(true)
  })
})

describe('getUnmappedUsers audit_start_year filtering', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('excludes deployers whose only deployments are before audit_start_year', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 't',
      appName: 'app1',
      environment: 'prod',
      auditStartYear: 2026,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 't',
      environment: 'prod',
      deployerUsername: 'old-deployer',
      createdAt: new Date('2025-06-01'),
    })

    const unmapped = await getUnmappedUsers()
    expect(unmapped.map((u) => u.github_username)).not.toContain('old-deployer')
  })

  it('includes deployers with deployments after audit_start_year', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 't',
      appName: 'app1',
      environment: 'prod',
      auditStartYear: 2026,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 't',
      environment: 'prod',
      deployerUsername: 'new-deployer',
      createdAt: new Date('2026-03-15'),
    })

    const unmapped = await getUnmappedUsers()
    expect(unmapped.map((u) => u.github_username)).toContain('new-deployer')
  })

  it('only counts deployments within audit window', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 't',
      appName: 'app1',
      environment: 'prod',
      auditStartYear: 2026,
    })
    // 2 before audit window, 1 after
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 't',
      environment: 'prod',
      deployerUsername: 'mixed-deployer',
      createdAt: new Date('2025-01-01'),
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 't',
      environment: 'prod',
      deployerUsername: 'mixed-deployer',
      createdAt: new Date('2025-11-15'),
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 't',
      environment: 'prod',
      deployerUsername: 'mixed-deployer',
      createdAt: new Date('2026-02-01'),
    })

    const unmapped = await getUnmappedUsers()
    const mixed = unmapped.find((u) => u.github_username === 'mixed-deployer')
    expect(mixed).toBeDefined()
    expect(mixed?.deployment_count).toBe(1)
  })

  it('excludes deployers on inactive apps', async () => {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO monitored_applications (team_slug, app_name, environment_name, is_active, audit_start_year, default_branch)
       VALUES ('t', 'inactive-app', 'prod', false, NULL, 'main') RETURNING id`,
    )
    await seedDeployment(pool, {
      monitoredAppId: rows[0].id,
      teamSlug: 't',
      environment: 'prod',
      deployerUsername: 'inactive-deployer',
      createdAt: new Date('2026-03-15'),
    })

    const unmapped = await getUnmappedUsers()
    expect(unmapped.map((u) => u.github_username)).not.toContain('inactive-deployer')
  })
})
