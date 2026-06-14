import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { upsertUserGithubAccount } from '../../user-github-accounts.server'
import { getUsersWithoutGithub, upsertUser } from '../../user-github-lookups.server'
import { truncateAllTables } from './helpers'

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

describe('getUsersWithoutGithub', () => {
  it('returns user with no GitHub account', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })

    const result = await getUsersWithoutGithub()

    expect(result).toHaveLength(1)
    expect(result[0].nav_ident).toBe('Z990001')
    expect(result[0].display_name).toBe('Glad Fjord')
  })

  it('excludes user with active GitHub account', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await upsertUserGithubAccount({ githubUsername: 'gladfjord', navIdent: 'Z990001' })

    const result = await getUsersWithoutGithub()

    expect(result).toHaveLength(0)
  })

  it('returns user with only soft-deleted GitHub account', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await upsertUserGithubAccount({ githubUsername: 'gladfjord', navIdent: 'Z990001' })
    await pool.query(
      `UPDATE user_github_accounts SET deleted_at = NOW(), deleted_by = 'Z990099' WHERE github_username = 'gladfjord'`,
    )

    const result = await getUsersWithoutGithub()

    expect(result).toHaveLength(1)
    expect(result[0].nav_ident).toBe('Z990001')
  })

  it('excludes soft-deleted users', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await pool.query(`UPDATE users SET deleted_at = NOW(), deleted_by = 'Z990099' WHERE nav_ident = 'Z990001'`)

    const result = await getUsersWithoutGithub()

    expect(result).toHaveLength(0)
  })

  it('returns multiple users without GitHub accounts', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await upsertUser({ navIdent: 'Z990002', displayName: 'Rask Elv', navEmail: 'rask.elv@nav.no' })
    await upsertUser({ navIdent: 'Z990003', displayName: 'Stille Skog', navEmail: 'stille.skog@nav.no' })
    await upsertUserGithubAccount({ githubUsername: 'stilleskog', navIdent: 'Z990003' })

    const result = await getUsersWithoutGithub()

    expect(result).toHaveLength(2)
    expect(result.map((u) => u.nav_ident)).toEqual(expect.arrayContaining(['Z990001', 'Z990002']))
    expect(result.map((u) => u.nav_ident)).not.toContain('Z990003')
  })
})
