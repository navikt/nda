import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/microsoft-graph.server', () => ({
  searchGraphUsers: vi.fn(),
}))

import { searchGraphUsers } from '~/lib/microsoft-graph.server'
import {
  getActiveGithubAccountByNavIdent,
  getAllUsersWithAccounts,
  getGithubUserLookup,
  getGithubUserLookups,
  getOrCreateUserFromGraph,
  getUnmappedDeployers,
  getUserByIdentifier,
  getUserBySlackMemberId,
  getUsersByIdentifiers,
} from '../../user-github-lookups.server'
import { seedApp, seedDeployment, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})

async function seedAccount(githubUsername: string, navIdent: string, opts: { deleted?: boolean } = {}) {
  await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ($1, 'Glad Fjord') ON CONFLICT DO NOTHING`, [
    navIdent,
  ])
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

describe('getActiveGithubAccountByNavIdent', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('returns null when no active account exists', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Glad Fjord')`)
    const result = await getActiveGithubAccountByNavIdent('Z990001')
    expect(result).toBeNull()
  })

  it('returns null when all accounts are soft-deleted', async () => {
    await seedAccount('GladFjord', 'Z990001', { deleted: true })
    const result = await getActiveGithubAccountByNavIdent('Z990001')
    expect(result).toBeNull()
  })

  it('returns active account for known nav_ident', async () => {
    await seedAccount('GladFjord', 'Z990001')
    const result = await getActiveGithubAccountByNavIdent('Z990001')
    expect(result).not.toBeNull()
    expect(result?.github_username).toBe('gladfjord')
  })

  it('is case-insensitive on nav_ident input', async () => {
    await seedAccount('GladFjord', 'Z990001')
    expect(await getActiveGithubAccountByNavIdent('z990001')).not.toBeNull()
    expect(await getActiveGithubAccountByNavIdent('Z990001')).not.toBeNull()
  })

  it('returns newest active account when multiple exist', async () => {
    await pool.query(
      `INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Glad Fjord') ON CONFLICT DO NOTHING`,
    )
    await pool.query(
      `INSERT INTO user_github_accounts (github_username, nav_ident, created_at) VALUES ('old-account', 'Z990001', NOW() - INTERVAL '1 day') ON CONFLICT DO NOTHING`,
    )
    await pool.query(
      `INSERT INTO user_github_accounts (github_username, nav_ident, created_at) VALUES ('new-account', 'Z990001', NOW()) ON CONFLICT DO NOTHING`,
    )
    const result = await getActiveGithubAccountByNavIdent('Z990001')
    expect(result?.github_username).toBe('new-account')
  })
})

describe('getUserBySlackMemberId', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('returns null for unknown slack_member_id', async () => {
    const result = await getUserBySlackMemberId('U_UNKNOWN')
    expect(result).toBeNull()
  })

  it('returns user with github_username when account is linked', async () => {
    await pool.query(
      `INSERT INTO users (nav_ident, display_name, slack_member_id) VALUES ('Z990001', 'Glad Fjord', 'U_GLADFJORD')`,
    )
    await pool.query(`INSERT INTO user_github_accounts (github_username, nav_ident) VALUES ('gladfjord', 'Z990001')`)
    const result = await getUserBySlackMemberId('U_GLADFJORD')
    expect(result?.nav_ident).toBe('Z990001')
    expect(result?.github_username).toBe('gladfjord')
  })

  it('returns user with null github_username when no GitHub account is linked', async () => {
    await pool.query(
      `INSERT INTO users (nav_ident, display_name, slack_member_id) VALUES ('Z990001', 'Glad Fjord', 'U_GLADFJORD')`,
    )
    const result = await getUserBySlackMemberId('U_GLADFJORD')
    expect(result?.nav_ident).toBe('Z990001')
    expect(result?.github_username).toBeNull()
  })

  it('returns null for soft-deleted user', async () => {
    await pool.query(
      `INSERT INTO users (nav_ident, display_name, slack_member_id, deleted_at) VALUES ('Z990001', 'Glad Fjord', 'U_GLADFJORD', NOW())`,
    )
    const result = await getUserBySlackMemberId('U_GLADFJORD')
    expect(result).toBeNull()
  })
})

describe('getUserByIdentifier', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('returns null for unknown GitHub username', async () => {
    expect(await getUserByIdentifier('unknownuser')).toBeNull()
  })

  it('returns null for unknown NAV-ident', async () => {
    expect(await getUserByIdentifier('Z990001')).toBeNull()
  })

  it('looks up user by GitHub username (case-insensitive)', async () => {
    await seedAccount('GladFjord', 'Z990001')
    const result = await getUserByIdentifier('GLADFJORD')
    expect(result?.nav_ident).toBe('Z990001')
    expect(result?.github_username).toBe('gladfjord')
    expect(result?.display_name).toBe('Glad Fjord')
  })

  it('looks up user by NAV-ident (case-insensitive)', async () => {
    await seedAccount('GladFjord', 'Z990001')
    const result = await getUserByIdentifier('z990001')
    expect(result?.nav_ident).toBe('Z990001')
    expect(result?.github_username).toBe('gladfjord')
    expect(result?.display_name).toBe('Glad Fjord')
  })

  it('returns null github_username when user has no GitHub account', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Rask Elv')`)
    const result = await getUserByIdentifier('Z990001')
    expect(result?.nav_ident).toBe('Z990001')
    expect(result?.github_username).toBeNull()
  })

  it('includes soft-deleted GitHub accounts for GitHub username lookups', async () => {
    await seedAccount('GladFjord', 'Z990001', { deleted: true })
    const result = await getUserByIdentifier('gladfjord')
    expect(result).not.toBeNull()
    expect(result?.nav_ident).toBe('Z990001')
  })

  it('returns null for GitHub username lookup when the user is soft-deleted', async () => {
    await seedAccount('GladFjord', 'Z990001')
    await pool.query(`UPDATE users SET deleted_at = NOW() WHERE nav_ident = 'Z990001'`)
    const result = await getUserByIdentifier('gladfjord')
    expect(result).toBeNull()
  })

  it('returns newest active GitHub account when NAV-ident has multiple', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Stille Skog')`)
    await pool.query(
      `INSERT INTO user_github_accounts (github_username, nav_ident, created_at) VALUES ('olduser', 'Z990001', NOW() - INTERVAL '1 day')`,
    )
    await pool.query(
      `INSERT INTO user_github_accounts (github_username, nav_ident, created_at) VALUES ('newuser', 'Z990001', NOW())`,
    )
    const result = await getUserByIdentifier('Z990001')
    expect(result?.github_username).toBe('newuser')
  })
})

describe('getUsersByIdentifiers', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('returns empty map for empty input', async () => {
    expect((await getUsersByIdentifiers([])).size).toBe(0)
  })

  it('resolves GitHub usernames', async () => {
    await seedAccount('GladFjord', 'Z990001')
    const result = await getUsersByIdentifiers(['gladfjord'])
    expect(result.get('gladfjord')?.display_name).toBe('Glad Fjord')
    expect(result.get('gladfjord')?.nav_ident).toBe('Z990001')
  })

  it('resolves NAV-idents', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990002', 'Modig Bjørk')`)
    const result = await getUsersByIdentifiers(['Z990002'])
    expect(result.get('Z990002')?.display_name).toBe('Modig Bjørk')
    expect(result.get('Z990002')?.nav_ident).toBe('Z990002')
  })

  it('resolves mixed GitHub usernames and NAV-idents in one call', async () => {
    await seedAccount('GladFjord', 'Z990001')
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990002', 'Rask Elv')`)
    const result = await getUsersByIdentifiers(['gladfjord', 'Z990002'])
    expect(result.size).toBe(2)
    expect(result.get('gladfjord')?.nav_ident).toBe('Z990001')
    expect(result.get('Z990002')?.display_name).toBe('Rask Elv')
  })

  it('preserves original identifier casing as map key', async () => {
    await seedAccount('GladFjord', 'Z990001')
    const result = await getUsersByIdentifiers(['GladFjord'])
    expect(result.has('GladFjord')).toBe(true)
    expect(result.has('gladfjord')).toBe(false)
  })

  it('NAV-ident lookup returns newest active GitHub account when linked', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Glad Fjord')`)
    await pool.query(
      `INSERT INTO user_github_accounts (github_username, nav_ident, created_at) VALUES ('olduser', 'Z990001', NOW() - INTERVAL '1 day')`,
    )
    await pool.query(
      `INSERT INTO user_github_accounts (github_username, nav_ident, created_at) VALUES ('newuser', 'Z990001', NOW())`,
    )
    const result = await getUsersByIdentifiers(['Z990001'])
    expect(result.get('Z990001')?.github_username).toBe('newuser')
  })

  it('NAV-ident lookup returns null github_username when no GitHub account linked', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Rask Elv')`)
    const result = await getUsersByIdentifiers(['Z990001'])
    expect(result.get('Z990001')?.github_username).toBeNull()
  })

  it('skips unknown identifiers', async () => {
    const result = await getUsersByIdentifiers(['unknownuser', 'Z999999'])
    expect(result.size).toBe(0)
  })

  it('includes soft-deleted GitHub accounts for historical lookups', async () => {
    await seedAccount('GladFjord', 'Z990001', { deleted: true })
    const result = await getUsersByIdentifiers(['gladfjord'])
    expect(result.get('gladfjord')?.nav_ident).toBe('Z990001')
  })

  it('excludes soft-deleted users (users.deleted_at) from GitHub username lookups', async () => {
    await seedAccount('GladFjord', 'Z990001')
    await pool.query(`UPDATE users SET deleted_at = NOW() WHERE nav_ident = 'Z990001'`)
    const result = await getUsersByIdentifiers(['gladfjord'])
    expect(result.has('gladfjord')).toBe(false)
  })
})

describe('getAllUsersWithAccounts', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('returns active accounts joined with users', async () => {
    await seedAccount('GladFjord', 'Z990001')
    await seedAccount('RaskElv', 'Z990002')
    const result = await getAllUsersWithAccounts()
    expect(result.map((r) => r.github_username).sort()).toEqual(['gladfjord', 'raskelv'])
    expect(result.find((r) => r.github_username === 'gladfjord')?.nav_ident).toBe('Z990001')
  })

  it('excludes soft-deleted github accounts', async () => {
    await seedAccount('GladFjord', 'Z990001')
    await seedAccount('RaskElv', 'Z990002', { deleted: true })
    const result = await getAllUsersWithAccounts()
    expect(result.map((r) => r.github_username)).toEqual(['gladfjord'])
  })

  it('excludes accounts whose user row is soft-deleted', async () => {
    await seedAccount('GladFjord', 'Z990001')
    await pool.query(`UPDATE users SET deleted_at = NOW() WHERE nav_ident = 'Z990001'`)
    const result = await getAllUsersWithAccounts()
    expect(result).toHaveLength(0)
  })
})

describe('getUnmappedDeployers', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('returns deployers without an active account link', async () => {
    const appId = await seedApp(pool, { teamSlug: 't', appName: 'app1', environment: 'prod', auditStartYear: 2025 })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 't',
      environment: 'prod',
      deployerUsername: 'unmapped-user',
      createdAt: new Date('2025-06-01'),
    })
    const result = await getUnmappedDeployers()
    expect(result.map((r) => r.github_username)).toContain('unmapped-user')
  })

  it('excludes deployers that have an active account link', async () => {
    const appId = await seedApp(pool, { teamSlug: 't', appName: 'app1', environment: 'prod', auditStartYear: 2025 })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 't',
      environment: 'prod',
      deployerUsername: 'mapped-user',
      createdAt: new Date('2025-06-01'),
    })
    await seedAccount('mapped-user', 'Z990001')
    const result = await getUnmappedDeployers()
    expect(result.map((r) => r.github_username)).not.toContain('mapped-user')
  })

  it('includes deployers whose account link is soft-deleted', async () => {
    const appId = await seedApp(pool, { teamSlug: 't', appName: 'app1', environment: 'prod', auditStartYear: 2025 })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 't',
      environment: 'prod',
      deployerUsername: 'deleted-user',
      createdAt: new Date('2025-06-01'),
    })
    await seedAccount('deleted-user', 'Z990002', { deleted: true })
    const result = await getUnmappedDeployers()
    expect(result.map((r) => r.github_username)).toContain('deleted-user')
  })

  it('returns correct deployment_count', async () => {
    const appId = await seedApp(pool, { teamSlug: 't', appName: 'app1', environment: 'prod', auditStartYear: 2025 })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 't',
      environment: 'prod',
      deployerUsername: 'count-user',
      createdAt: new Date('2025-06-01'),
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 't',
      environment: 'prod',
      deployerUsername: 'count-user',
      createdAt: new Date('2025-07-01'),
    })
    const result = await getUnmappedDeployers()
    const found = result.find((r) => r.github_username === 'count-user')
    expect(found?.deployment_count).toBe(2)
  })
})

describe('getOrCreateUserFromGraph', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
    vi.mocked(searchGraphUsers).mockReset()
  })

  it('returns existing user without calling Graph', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Glad Fjord')`)
    const result = await getOrCreateUserFromGraph('Z990001')
    expect(result?.nav_ident).toBe('Z990001')
    expect(searchGraphUsers).not.toHaveBeenCalled()
  })

  it('creates user from Graph when not found locally', async () => {
    vi.mocked(searchGraphUsers).mockResolvedValue([{ navIdent: 'Z990001', displayName: 'Glad Fjord' }])
    const result = await getOrCreateUserFromGraph('Z990001')
    expect(result?.nav_ident).toBe('Z990001')
    expect(result?.display_name).toBe('Glad Fjord')
    const { rows } = await pool.query(`SELECT * FROM users WHERE nav_ident = 'Z990001'`)
    expect(rows).toHaveLength(1)
  })

  it('returns null when Graph finds no match', async () => {
    vi.mocked(searchGraphUsers).mockResolvedValue([])
    const result = await getOrCreateUserFromGraph('Z990001')
    expect(result).toBeNull()
  })

  it('returns null when Graph result has no displayName', async () => {
    vi.mocked(searchGraphUsers).mockResolvedValue([{ navIdent: 'Z990001', displayName: null }])
    const result = await getOrCreateUserFromGraph('Z990001')
    expect(result).toBeNull()
  })

  it('throws when Graph API fails', async () => {
    vi.mocked(searchGraphUsers).mockRejectedValue(new Error('Graph API error'))
    await expect(getOrCreateUserFromGraph('Z990001')).rejects.toThrow()
  })
})
