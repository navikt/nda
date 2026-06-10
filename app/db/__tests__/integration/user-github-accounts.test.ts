import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { populateGithubAccountsFromMappings, upsertUserGithubAccount } from '../../user-github-accounts.server'
import { upsertUser, upsertUserMapping } from '../../user-mappings.server'
import { truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})

describe('user_github_accounts', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('upsertUserGithubAccount creates a new row', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    const account = await upsertUserGithubAccount({
      githubUsername: 'GladFjord',
      navIdent: 'Z990001',
    })
    expect(account.github_username).toBe('gladfjord')
    expect(account.display_github_username).toBe('GladFjord')
    expect(account.nav_ident).toBe('Z990001')
    expect(account.deleted_at).toBeNull()
  })

  it('upsertUserGithubAccount is idempotent', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await upsertUserGithubAccount({ githubUsername: 'gladfjord', navIdent: 'Z990001' })
    const second = await upsertUserGithubAccount({ githubUsername: 'gladfjord', navIdent: 'Z990001' })
    expect(second.github_username).toBe('gladfjord')

    const { rows } = await pool.query('SELECT COUNT(*) AS c FROM user_github_accounts WHERE github_username = $1', [
      'gladfjord',
    ])
    expect(rows[0].c).toBe('1')
  })

  it('upsertUserGithubAccount normalizes github_username to lowercase', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    const account = await upsertUserGithubAccount({ githubUsername: 'GladFjord', navIdent: 'Z990001' })
    expect(account.github_username).toBe('gladfjord')
  })

  it('upsertUserGithubAccount restores soft-deleted row', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await upsertUserGithubAccount({ githubUsername: 'gladfjord', navIdent: 'Z990001' })
    await pool.query(
      `UPDATE user_github_accounts SET deleted_at = NOW(), deleted_by = 'Z990099' WHERE github_username = 'gladfjord'`,
    )

    const restored = await upsertUserGithubAccount({ githubUsername: 'gladfjord', navIdent: 'Z990001' })
    expect(restored.deleted_at).toBeNull()
    expect(restored.deleted_by).toBeNull()
  })

  it('populateGithubAccountsFromMappings seeds from user_mappings', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await upsertUser({ navIdent: 'Z990002', displayName: 'Rask Elv', navEmail: 'rask.elv@nav.no' })
    await upsertUserMapping({
      githubUsername: 'gladfjord',
      navIdent: 'Z990001',
      displayName: 'Glad Fjord',
      navEmail: 'glad.fjord@nav.no',
    })
    await upsertUserMapping({
      githubUsername: 'raskelv',
      navIdent: 'Z990002',
      displayName: 'Rask Elv',
      navEmail: 'rask.elv@nav.no',
    })
    // Mapping without nav_ident — not counted in eligible set
    await upsertUserMapping({ githubUsername: 'oktocat' })

    const result = await populateGithubAccountsFromMappings()
    expect(result.inserted).toBe(2)
    expect(result.skipped).toBe(0) // oktocat has no nav_ident so not eligible

    const { rows } = await pool.query('SELECT github_username FROM user_github_accounts ORDER BY github_username')
    expect(rows.map((r: { github_username: string }) => r.github_username)).toEqual(['gladfjord', 'raskelv'])
  })

  it('populateGithubAccountsFromMappings skips mappings without matching users row', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await upsertUserMapping({
      githubUsername: 'gladfjord',
      navIdent: 'Z990001',
      displayName: 'Glad Fjord',
      navEmail: 'glad.fjord@nav.no',
    })
    // Mapping with nav_ident but no users row
    await pool.query(
      `INSERT INTO user_mappings (github_username, nav_ident, display_name) VALUES ('oktocat', 'Z990099', 'Ukjent')`,
    )

    const result = await populateGithubAccountsFromMappings()
    expect(result.inserted).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('dual-write: upsertUserMapping writes to user_github_accounts when all fields present', async () => {
    await upsertUserMapping({
      githubUsername: 'GladFjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
      navEmail: 'glad.fjord@nav.no',
    })

    await expect
      .poll(
        async () => {
          const { rows } = await pool.query('SELECT github_username, nav_ident FROM user_github_accounts')
          return rows
        },
        { timeout: 2000 },
      )
      .toHaveLength(1)

    const { rows } = await pool.query('SELECT github_username, nav_ident FROM user_github_accounts')
    expect(rows[0].github_username).toBe('gladfjord')
    expect(rows[0].nav_ident).toBe('Z990001')
  })

  it('dual-write: upsertUserMapping does not write to user_github_accounts when nav_email missing', async () => {
    await upsertUserMapping({ githubUsername: 'gladfjord', navIdent: 'Z990001', displayName: 'Glad Fjord' })

    // Poll briefly to confirm the table stays empty (no dual-write without nav_email)
    await expect
      .poll(
        async () => {
          const { rows } = await pool.query('SELECT COUNT(*) AS c FROM user_github_accounts')
          return Number(rows[0].c)
        },
        { timeout: 500, interval: 50 },
      )
      .toBe(0)
  })
})
