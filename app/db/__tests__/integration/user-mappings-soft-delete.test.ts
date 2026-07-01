import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { searchDeployments } from '../../deployments.server'
import {
  getActiveGithubAccountByNavIdent,
  getAllUsersWithAccounts,
  getGithubUserLookup,
  getGithubUserLookups,
  getUnmappedDeployers,
  getUserBySlackMemberId,
  softDeleteGithubAccount,
  upsertUser,
  upsertUserAndGithubAccount,
} from '../../user-github-lookups.server'
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

describe('user_github_accounts soft delete', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('soft-deletes by setting deleted_at and deleted_by', async () => {
    await upsertUserAndGithubAccount({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
    })
    await softDeleteGithubAccount('gladfjord', 'Z990002')

    const { rows } = await pool.query(
      'SELECT deleted_at, deleted_by FROM user_github_accounts WHERE github_username = $1',
      ['gladfjord'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).not.toBeNull()
    expect(rows[0].deleted_by).toBe('Z990002')
  })

  it('getGithubUserLookup still returns soft-deleted mapping (audit history)', async () => {
    await upsertUserAndGithubAccount({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
    })
    await softDeleteGithubAccount('gladfjord', 'Z990002')

    const lookup = await getGithubUserLookup('gladfjord')
    expect(lookup?.display_name).toBe('Glad Fjord')
    expect(lookup?.account_deleted_at).not.toBeNull()
  })

  it('getGithubUserLookups still returns soft-deleted mappings', async () => {
    await upsertUserAndGithubAccount({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990003',
    })
    await softDeleteGithubAccount('gladfjord', null)

    const lookups = await getGithubUserLookups(['gladfjord'])
    expect(lookups.get('gladfjord')?.display_name).toBe('Glad Fjord')
    expect(lookups.get('gladfjord')?.account_deleted_at).not.toBeNull()
  })

  it('getGithubUserLookup resolves case-insensitively for GitHub usernames', async () => {
    await upsertUserAndGithubAccount({
      githubUsername: 'GladFjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
    })

    const byMixedCase = await getGithubUserLookup('GladFjord')
    expect(byMixedCase?.display_name).toBe('Glad Fjord')

    const byUpperCase = await getGithubUserLookup('GLADFJORD')
    expect(byUpperCase?.display_name).toBe('Glad Fjord')
  })

  it('getGithubUserLookups resolves case-insensitively for GitHub usernames', async () => {
    await upsertUserAndGithubAccount({
      githubUsername: 'GladFjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990002',
    })

    const lookups = await getGithubUserLookups(['GLADFJORD', 'GladFjord'])
    expect(lookups.get('GLADFJORD')?.display_name).toBe('Glad Fjord')
    expect(lookups.get('GladFjord')?.display_name).toBe('Glad Fjord')
  })

  it('getAllUsersWithAccounts excludes soft-deleted accounts', async () => {
    await upsertUserAndGithubAccount({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
    })
    await upsertUserAndGithubAccount({
      githubUsername: 'raskelv',
      displayName: 'Rask Elv',
      navIdent: 'Z990002',
    })
    await softDeleteGithubAccount('raskelv', null)

    const all = await getAllUsersWithAccounts()
    expect(all.map((m) => m.github_username).sort()).toEqual(['gladfjord'])
  })

  it('getActiveGithubAccountByNavIdent excludes soft-deleted accounts (current-state lookup)', async () => {
    await upsertUserAndGithubAccount({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
    })
    await softDeleteGithubAccount('gladfjord', null)

    expect(await getActiveGithubAccountByNavIdent('Z990001')).toBeNull()
  })

  it('getUserBySlackMemberId excludes soft-deleted accounts from current-state lookup', async () => {
    await upsertUserAndGithubAccount({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
      slackMemberId: 'U001GLAD',
    })
    await softDeleteGithubAccount('gladfjord', null)

    expect(await getUserBySlackMemberId('U001GLAD')).toEqual({ nav_ident: 'Z990001', github_username: null })
  })

  it('getUnmappedDeployers treats soft-deleted as missing mapping', async () => {
    await seedDeploy(pool, 'gladfjord')
    await upsertUserAndGithubAccount({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
    })

    expect(await getUnmappedDeployers()).toEqual([])

    await softDeleteGithubAccount('gladfjord', null)
    const unmapped = await getUnmappedDeployers()
    expect(unmapped.map((u) => u.github_username)).toEqual(['gladfjord'])
  })

  it('upsertUserAndGithubAccount undeletes a soft-deleted github account', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord' })
    await upsertUserAndGithubAccount({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
    })
    await softDeleteGithubAccount('gladfjord', 'Z990002')

    await upsertUserAndGithubAccount({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
    })

    const { rows } = await pool.query<{ deleted_at: Date | null; nav_ident: string }>(
      'SELECT deleted_at, nav_ident FROM user_github_accounts WHERE github_username = $1',
      ['gladfjord'],
    )
    expect(rows[0].deleted_at).toBeNull()
    expect(rows[0].nav_ident).toBe('Z990001')
  })

  it('softDeleteGithubAccount is idempotent (re-deleting does not change deleted_at/by)', async () => {
    await upsertUserAndGithubAccount({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
    })
    await softDeleteGithubAccount('gladfjord', 'Z990011')

    const { rows: first } = await pool.query<{ deleted_at: Date; deleted_by: string }>(
      'SELECT deleted_at, deleted_by FROM user_github_accounts WHERE github_username = $1',
      ['gladfjord'],
    )

    await softDeleteGithubAccount('gladfjord', 'Z990012')

    const { rows: second } = await pool.query<{ deleted_at: Date; deleted_by: string }>(
      'SELECT deleted_at, deleted_by FROM user_github_accounts WHERE github_username = $1',
      ['gladfjord'],
    )

    expect(second[0].deleted_at.getTime()).toBe(first[0].deleted_at.getTime())
    expect(second[0].deleted_by).toBe('Z990011')
  })

  it('searchDeployments excludes soft-deleted mappings from user search', async () => {
    await seedDeploy(pool, 'gladfjord')
    await upsertUserAndGithubAccount({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
      slackMemberId: 'U001GLAD',
    })

    expect((await searchDeployments('Glad Fjord')).some((r) => r.type === 'user')).toBe(true)
    expect((await searchDeployments('Z990001')).some((r) => r.type === 'user')).toBe(true)
    expect((await searchDeployments('U001GLAD')).some((r) => r.type === 'user')).toBe(true)

    await softDeleteGithubAccount('gladfjord', 'Z990002')

    expect((await searchDeployments('Glad Fjord')).some((r) => r.type === 'user')).toBe(false)
    expect((await searchDeployments('Z990001')).some((r) => r.type === 'user')).toBe(false)
    expect((await searchDeployments('U001GLAD')).some((r) => r.type === 'user')).toBe(false)

    const byUsername = await searchDeployments('gladfjord')
    expect(byUsername.some((r) => r.type === 'user' && r.url === '/users/gladfjord')).toBe(true)
  })
})

describe('getUnmappedDeployers audit_start_year filtering', () => {
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

    const unmapped = await getUnmappedDeployers()
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

    const unmapped = await getUnmappedDeployers()
    expect(unmapped.map((u) => u.github_username)).toContain('new-deployer')
  })

  it('only counts deployments within audit window', async () => {
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

    const unmapped = await getUnmappedDeployers()
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

    const unmapped = await getUnmappedDeployers()
    expect(unmapped.map((u) => u.github_username)).not.toContain('inactive-deployer')
  })
})
