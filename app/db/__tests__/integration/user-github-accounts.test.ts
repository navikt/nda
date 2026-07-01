import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { upsertUserGithubAccount } from '../../user-github-accounts.server'
import { upsertUser, upsertUserAndGithubAccount } from '../../user-github-lookups.server'
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
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord' })
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
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord' })
    await upsertUserGithubAccount({ githubUsername: 'gladfjord', navIdent: 'Z990001' })
    const second = await upsertUserGithubAccount({ githubUsername: 'gladfjord', navIdent: 'Z990001' })
    expect(second.github_username).toBe('gladfjord')

    const { rows } = await pool.query('SELECT COUNT(*) AS c FROM user_github_accounts WHERE github_username = $1', [
      'gladfjord',
    ])
    expect(rows[0].c).toBe('1')
  })

  it('upsertUserGithubAccount normalizes github_username to lowercase', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord' })
    const account = await upsertUserGithubAccount({ githubUsername: 'GladFjord', navIdent: 'Z990001' })
    expect(account.github_username).toBe('gladfjord')
  })

  it('upsertUserGithubAccount restores soft-deleted row', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord' })
    await upsertUserGithubAccount({ githubUsername: 'gladfjord', navIdent: 'Z990001' })
    await pool.query(
      `UPDATE user_github_accounts SET deleted_at = NOW(), deleted_by = 'Z990099' WHERE github_username = 'gladfjord'`,
    )

    const restored = await upsertUserGithubAccount({ githubUsername: 'gladfjord', navIdent: 'Z990001' })
    expect(restored.deleted_at).toBeNull()
    expect(restored.deleted_by).toBeNull()
  })

  it('upsertUserAndGithubAccount writes to user_github_accounts when all fields are present', async () => {
    await upsertUserAndGithubAccount({
      githubUsername: 'GladFjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
    })

    const { rows } = await pool.query('SELECT github_username, nav_ident FROM user_github_accounts')
    expect(rows).toHaveLength(1)
    expect(rows[0].github_username).toBe('gladfjord')
    expect(rows[0].nav_ident).toBe('Z990001')
  })
})
