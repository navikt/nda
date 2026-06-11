import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getGithubUserLookup, getGithubUserLookups } from '../../user-github-lookups.server'
import { truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})

async function seedAccount(githubUsername: string, navIdent: string, opts: { deleted?: boolean } = {}) {
  await pool.query(
    `INSERT INTO users (nav_ident, display_name, nav_email) VALUES ($1, 'Glad Fjord', 'glad.fjord@nav.no') ON CONFLICT DO NOTHING`,
    [navIdent],
  )
  await pool.query(
    `INSERT INTO user_github_accounts (github_username, nav_ident, display_github_username) VALUES (LOWER($1), $2, $1) ON CONFLICT DO NOTHING`,
    [githubUsername, navIdent],
  )
  if (opts.deleted) {
    await pool.query(
      `UPDATE user_github_accounts SET deleted_at = NOW(), deleted_by = $2 WHERE github_username = LOWER($1)`,
      [githubUsername, navIdent],
    )
  }
}

describe('getGithubUserLookup', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('returns null for unknown username', async () => {
    const result = await getGithubUserLookup('unknown')
    expect(result).toBeNull()
  })

  it('returns user data for known username', async () => {
    await seedAccount('GladFjord', 'Z990001')
    const result = await getGithubUserLookup('GladFjord')
    expect(result).not.toBeNull()
    expect(result?.github_username).toBe('gladfjord')
    expect(result?.nav_ident).toBe('Z990001')
    expect(result?.account_deleted_at).toBeNull()
  })

  it('is case-insensitive on input', async () => {
    await seedAccount('GladFjord', 'Z990001')
    const lower = await getGithubUserLookup('gladfjord')
    const upper = await getGithubUserLookup('GLADFJORD')
    const mixed = await getGithubUserLookup('GladFjord')
    expect(lower).not.toBeNull()
    expect(upper).not.toBeNull()
    expect(mixed).not.toBeNull()
  })

  it('returns soft-deleted rows with non-null account_deleted_at', async () => {
    await seedAccount('GladFjord', 'Z990001', { deleted: true })
    const result = await getGithubUserLookup('GladFjord')
    expect(result).not.toBeNull()
    expect(result?.account_deleted_at).not.toBeNull()
  })
})

describe('getGithubUserLookups', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('returns empty Map for empty input', async () => {
    const result = await getGithubUserLookups([])
    expect(result.size).toBe(0)
  })

  it('returns Map keyed by original identifier (preserves casing)', async () => {
    await seedAccount('GladFjord', 'Z990001')
    const result = await getGithubUserLookups(['GladFjord'])
    expect(result.has('GladFjord')).toBe(true)
    expect(result.has('gladfjord')).toBe(false)
  })

  it('is case-insensitive on lookup', async () => {
    await seedAccount('GladFjord', 'Z990001')
    const result = await getGithubUserLookups(['GLADFJORD'])
    expect(result.has('GLADFJORD')).toBe(true)
    expect(result.get('GLADFJORD')?.nav_ident).toBe('Z990001')
  })

  it('includes soft-deleted rows with account_deleted_at set', async () => {
    await seedAccount('GladFjord', 'Z990001', { deleted: true })
    await seedAccount('RaskElv', 'Z990002')
    const result = await getGithubUserLookups(['GladFjord', 'RaskElv'])
    expect(result.size).toBe(2)
    expect(result.get('GladFjord')?.account_deleted_at).not.toBeNull()
    expect(result.get('RaskElv')?.account_deleted_at).toBeNull()
  })

  it('returns only found usernames (unknown omitted from Map)', async () => {
    await seedAccount('GladFjord', 'Z990001')
    const result = await getGithubUserLookups(['GladFjord', 'unknown-user'])
    expect(result.size).toBe(1)
    expect(result.has('GladFjord')).toBe(true)
    expect(result.has('unknown-user')).toBe(false)
  })
})
