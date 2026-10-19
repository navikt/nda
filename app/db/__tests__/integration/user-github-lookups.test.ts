import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/user-lookup.server', () => ({
  getUsersByNavIdenter: vi.fn(),
}))

vi.mock('~/lib/slack/client.server', () => ({
  isSlackConfigured: vi.fn(() => false),
  lookupSlackUserIdByEmail: vi.fn(),
  SlackLookupFailedError: class SlackLookupFailedError extends Error {
    constructor(cause: unknown) {
      super('Slack member ID lookup failed')
      this.cause = cause
    }
  },
}))

import { isSlackConfigured, lookupSlackUserIdByEmail, SlackLookupFailedError } from '~/lib/slack/client.server'
import { getUsersByNavIdenter } from '~/lib/user-lookup.server'
import { restoreGithubAccountLink } from '../../soft-deleted.server'
import {
  getActiveGithubAccountByNavIdent,
  getAllUsersWithAccounts,
  getGithubUserLookup,
  getGithubUserLookups,
  getOrCreateUserFromDirectory,
  getUnmappedDeployers,
  getUserByIdentifier,
  getUserBySlackMemberId,
  getUsersByIdentifiers,
  populateUsersFromDirectory,
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

describe('identity versions', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
    await seedAccount('GladFjord', 'Z990001')
  })

  async function versions() {
    const lookup = await getGithubUserLookup('GladFjord')
    expect(lookup).not.toBeNull()
    return {
      account: lookup?.account_identity_version,
      user: lookup?.user_identity_version,
    }
  }

  it('backfills unique versions for existing users and accounts without changing their data', async () => {
    await seedAccount('RaskElv', 'Z990002', { deleted: true })
    await pool.query(`UPDATE users SET deleted_at = NOW() WHERE nav_ident = 'Z990002'`)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`
        DROP TRIGGER users_identity_version ON users;
        DROP TRIGGER github_accounts_identity_version ON user_github_accounts;
        DROP FUNCTION assign_user_identity_version();
        DROP FUNCTION assign_github_account_identity_version();
        ALTER TABLE users DROP COLUMN identity_version;
        ALTER TABLE user_github_accounts DROP COLUMN identity_version;
        DROP SEQUENCE identity_version_sequence;
      `)
      const usersBefore = await client.query('SELECT to_jsonb(u) AS data FROM users u ORDER BY nav_ident')
      const accountsBefore = await client.query(
        'SELECT to_jsonb(a) AS data FROM user_github_accounts a ORDER BY github_username',
      )
      await client.query(readFileSync('app/db/migrations/1792388760000_add-identity-versions.sql', 'utf8'))
      expect(
        (await client.query("SELECT to_jsonb(u) - 'identity_version' AS data FROM users u ORDER BY nav_ident")).rows,
      ).toEqual(usersBefore.rows)
      expect(
        (
          await client.query(
            "SELECT to_jsonb(a) - 'identity_version' AS data FROM user_github_accounts a ORDER BY github_username",
          )
        ).rows,
      ).toEqual(accountsBefore.rows)
      const { rows } = await client.query<{ identity_version: string }>(
        `SELECT identity_version::text FROM users
         UNION ALL SELECT identity_version::text FROM user_github_accounts`,
      )
      expect(rows).toHaveLength(4)
      for (const row of rows) {
        expect(row.identity_version).toMatch(/^[1-9]\d*$/)
      }
      expect(new Set(rows.map((row) => row.identity_version)).size).toBe(rows.length)
      const { rows: columns } = await client.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name IN ('users', 'user_github_accounts')
           AND column_name = 'identity_version'`,
      )
      expect(columns).toHaveLength(2)
      expect(columns.every((column) => column.is_nullable === 'NO')).toBe(true)
    } finally {
      try {
        await client.query('ROLLBACK')
      } finally {
        client.release()
      }
    }
  })

  it('exposes the same versions through single and batch lookups', async () => {
    const single = await getGithubUserLookup('GladFjord')
    const batch = (await getGithubUserLookups(['GladFjord'])).get('GladFjord')
    expect(single?.account_identity_version).toMatch(/^\d+$/)
    expect(single?.user_identity_version).toMatch(/^\d+$/)
    expect(batch?.account_identity_version).toBe(single?.account_identity_version)
    expect(batch?.user_identity_version).toBe(single?.user_identity_version)
  })

  it('preserves versions for profile updates and ignores caller-supplied versions', async () => {
    const before = await versions()
    await pool.query(
      `UPDATE users SET display_name = 'Rask Elv', slack_member_id = 'slack-test',
       updated_at = NOW(), identity_version = 0 WHERE nav_ident = 'Z990001'`,
    )
    await pool.query(
      `UPDATE user_github_accounts SET display_github_username = 'gladfjord',
       updated_at = NOW(), identity_version = 0 WHERE github_username = 'gladfjord'`,
    )
    expect(await versions()).toEqual(before)
  })

  it('changes account version for A to B to A without restoring the original version', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990002', 'Rask Elv')`)
    const before = await versions()
    await pool.query(`UPDATE user_github_accounts SET nav_ident = 'Z990002' WHERE github_username = 'gladfjord'`)
    const changed = await versions()
    await pool.query(`UPDATE user_github_accounts SET nav_ident = 'Z990001' WHERE github_username = 'gladfjord'`)
    const restored = await versions()
    expect(changed.account).not.toBe(before.account)
    expect(restored.account).not.toBe(changed.account)
    expect(restored.account).not.toBe(before.account)
    expect(restored.user).toBe(before.user)
  })

  it('changes account version on deletion and restoration', async () => {
    const before = await versions()
    await softDeleteGithubAccount('GladFjord')
    const deleted = await versions()
    await upsertUserAndGithubAccount({ githubUsername: 'GladFjord', navIdent: 'Z990001' })
    const restored = await versions()
    expect(deleted.account).not.toBe(before.account)
    expect(restored.account).not.toBe(deleted.account)
    expect(restored.account).not.toBe(before.account)
    expect(restored.user).toBe(before.user)
  })

  it('assigns a new account version when restored through the admin function', async () => {
    const before = await versions()
    expect(await softDeleteGithubAccount('GladFjord')).toBe(true)
    const deleted = await versions()

    expect(await restoreGithubAccountLink('GladFjord')).toBe(true)
    const restored = await versions()

    expect(deleted.account).not.toBe(before.account)
    expect(restored.account).not.toBe(deleted.account)
    expect(restored.account).not.toBe(before.account)
    expect(restored.user).toBe(before.user)
    expect((await getGithubUserLookup('GladFjord'))?.account_deleted_at).toBeNull()
    expect(await restoreGithubAccountLink('GladFjord')).toBe(false)
    expect(await versions()).toEqual(restored)
  })

  it('changes user version on deletion and restoration without changing the account version', async () => {
    const before = await versions()
    await pool.query(`UPDATE users SET deleted_at = NOW() WHERE nav_ident = 'Z990001'`)
    const deleted = await versions()
    expect(deleted.user).toBeNull()
    const { rows } = await pool.query<{ identity_version: string }>(
      `SELECT identity_version::text FROM users WHERE nav_ident = 'Z990001'`,
    )
    expect(rows[0].identity_version).not.toBe(before.user)
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord' })
    const restored = await versions()
    expect(restored.user).not.toBe(before.user)
    expect(restored.user).not.toBe(rows[0].identity_version)
    expect(restored.account).toBe(before.account)
  })

  it('assigns a new account version after physical deletion and recreation', async () => {
    const before = await versions()
    await pool.query(`DELETE FROM user_github_accounts WHERE github_username = 'gladfjord'`)
    await pool.query(
      `INSERT INTO user_github_accounts (github_username, nav_ident, identity_version)
       VALUES ('gladfjord', 'Z990001', $1)`,
      [before.account],
    )
    expect((await versions()).account).not.toBe(before.account)
  })

  it('assigns new versions to a physically recreated user and account', async () => {
    const before = await versions()
    await pool.query(`DELETE FROM user_github_accounts WHERE github_username = 'gladfjord'`)
    await pool.query(`DELETE FROM users WHERE nav_ident = 'Z990001'`)
    await seedAccount('GladFjord', 'Z990001')
    const recreated = await versions()
    expect(recreated.account).not.toBe(before.account)
    expect(recreated.user).not.toBe(before.user)
  })

  it('preserves versions on an upsert that leaves the identity unchanged', async () => {
    const before = await versions()
    await pool.query(
      `INSERT INTO user_github_accounts (github_username, nav_ident)
       VALUES ('gladfjord', 'Z990001')
       ON CONFLICT (github_username) DO UPDATE SET nav_ident = EXCLUDED.nav_ident, updated_at = NOW()`,
    )
    expect(await versions()).toEqual(before)
  })

  it('changes account version through production upserts without changing the user version', async () => {
    const before = await versions()
    await upsertUserAndGithubAccount({
      githubUsername: 'GladFjord',
      navIdent: 'Z990002',
      displayName: 'Rask Elv',
    })
    const changed = await versions()
    await upsertUserAndGithubAccount({
      githubUsername: 'GladFjord',
      navIdent: 'Z990001',
      displayName: 'Glad Fjord',
    })
    const restored = await versions()
    expect(changed.account).not.toBe(before.account)
    expect(restored.account).not.toBe(changed.account)
    expect(restored.account).not.toBe(before.account)
    expect(restored.user).toBe(before.user)
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
    const appId = await seedApp(pool, { teamSlug: 't', appName: 'app1', environment: 'prod' })
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
    const appId = await seedApp(pool, { teamSlug: 't', appName: 'app1', environment: 'prod' })
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
    const appId = await seedApp(pool, { teamSlug: 't', appName: 'app1', environment: 'prod' })
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
    const appId = await seedApp(pool, { teamSlug: 't', appName: 'app1', environment: 'prod' })
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

describe('getOrCreateUserFromDirectory', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
    vi.mocked(getUsersByNavIdenter).mockReset()
  })

  it('returns existing user without calling NOM', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Glad Fjord')`)
    const result = await getOrCreateUserFromDirectory('Z990001')
    expect(result?.nav_ident).toBe('Z990001')
    expect(getUsersByNavIdenter).not.toHaveBeenCalled()
  })

  it('creates user from NOM when not found locally', async () => {
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([
      { navIdent: 'Z990001', displayName: 'Glad Fjord', email: 'glad.fjord@nav.no' },
    ])
    const result = await getOrCreateUserFromDirectory('Z990001')
    expect(result?.nav_ident).toBe('Z990001')
    expect(result?.display_name).toBe('Glad Fjord')
    const { rows } = await pool.query(`SELECT * FROM users WHERE nav_ident = 'Z990001'`)
    expect(rows).toHaveLength(1)
  })

  it('returns null when NOM finds no match', async () => {
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([])
    const result = await getOrCreateUserFromDirectory('Z990001')
    expect(result).toBeNull()
  })

  it('returns null when NOM result has no displayName', async () => {
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([{ navIdent: 'Z990001', displayName: null, email: null }])
    const result = await getOrCreateUserFromDirectory('Z990001')
    expect(result).toBeNull()
  })

  it('throws when NOM API fails', async () => {
    vi.mocked(getUsersByNavIdenter).mockRejectedValue(new Error('NOM API error'))
    await expect(getOrCreateUserFromDirectory('Z990001')).rejects.toThrow()
  })
})

describe('populateUsersFromDirectory', () => {
  const originalSlackBotToken = process.env.SLACK_BOT_TOKEN
  const originalSlackAppToken = process.env.SLACK_APP_TOKEN

  beforeEach(async () => {
    await truncateAllTables(pool)
    vi.mocked(getUsersByNavIdenter).mockReset()
    vi.mocked(isSlackConfigured).mockReset().mockReturnValue(false)
    vi.mocked(lookupSlackUserIdByEmail).mockReset()
    delete process.env.SLACK_BOT_TOKEN
    delete process.env.SLACK_APP_TOKEN
  })

  afterEach(() => {
    if (originalSlackBotToken === undefined) delete process.env.SLACK_BOT_TOKEN
    else process.env.SLACK_BOT_TOKEN = originalSlackBotToken
    if (originalSlackAppToken === undefined) delete process.env.SLACK_APP_TOKEN
    else process.env.SLACK_APP_TOKEN = originalSlackAppToken
  })

  function configureSlackEnv() {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test'
    process.env.SLACK_APP_TOKEN = 'xapp-test'
  }

  it('returns all-zero result when there are no users', async () => {
    const result = await populateUsersFromDirectory()
    expect(result).toEqual({ success: 0, skipped: 0, errors: 0, slackIdsResolved: 0, slackLookupErrors: 0 })
    expect(getUsersByNavIdenter).not.toHaveBeenCalled()
  })

  it('fetches all nav-idents in a single NOM call and upserts matches', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Old Name')`)
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990002', 'Old Name 2')`)

    vi.mocked(getUsersByNavIdenter).mockResolvedValue([
      { navIdent: 'Z990001', displayName: 'Glad Fjord', email: 'glad.fjord@nav.no' },
      { navIdent: 'Z990002', displayName: 'Rask Elv', email: 'rask.elv@nav.no' },
    ])

    const result = await populateUsersFromDirectory()

    expect(result).toEqual({ success: 2, skipped: 0, errors: 0, slackIdsResolved: 0, slackLookupErrors: 0 })
    expect(getUsersByNavIdenter).toHaveBeenCalledTimes(1)
    expect(getUsersByNavIdenter).toHaveBeenCalledWith(expect.arrayContaining(['Z990001', 'Z990002']))

    const { rows } = await pool.query(`SELECT nav_ident, display_name FROM users ORDER BY nav_ident`)
    expect(rows).toEqual([
      { nav_ident: 'Z990001', display_name: 'Glad Fjord' },
      { nav_ident: 'Z990002', display_name: 'Rask Elv' },
    ])
  })

  it('normalizes a comma-formatted NOM displayName before persisting', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Old Name')`)

    vi.mocked(getUsersByNavIdenter).mockResolvedValue([
      { navIdent: 'Z990001', displayName: 'Fjord, Glad', email: 'glad.fjord@nav.no' },
    ])

    const result = await populateUsersFromDirectory()

    expect(result).toEqual({ success: 1, skipped: 0, errors: 0, slackIdsResolved: 0, slackLookupErrors: 0 })
    const { rows } = await pool.query(`SELECT display_name FROM users WHERE nav_ident = 'Z990001'`)
    expect(rows[0].display_name).toBe('Glad Fjord')
  })

  it('skips nav-idents with no matching NOM result', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Old Name')`)

    vi.mocked(getUsersByNavIdenter).mockResolvedValue([])

    const result = await populateUsersFromDirectory()

    expect(result).toEqual({ success: 0, skipped: 1, errors: 0, slackIdsResolved: 0, slackLookupErrors: 0 })
  })

  it('skips nav-idents whose NOM result has no displayName', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Old Name')`)

    vi.mocked(getUsersByNavIdenter).mockResolvedValue([{ navIdent: 'Z990001', displayName: null, email: null }])

    const result = await populateUsersFromDirectory()

    expect(result).toEqual({ success: 0, skipped: 1, errors: 0, slackIdsResolved: 0, slackLookupErrors: 0 })
  })

  it('counts every nav-ident in a batch as an error when the NOM call fails', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Old Name')`)
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990002', 'Old Name 2')`)

    vi.mocked(getUsersByNavIdenter).mockRejectedValue(new Error('NOM API error'))

    const result = await populateUsersFromDirectory()

    expect(result).toEqual({ success: 0, skipped: 0, errors: 2, slackIdsResolved: 0, slackLookupErrors: 0 })
  })

  it('splits large nav-ident lists into multiple batched NOM calls', async () => {
    const navIdents = Array.from({ length: 150 }, (_, i) => `Z${(990001 + i).toString().padStart(6, '0')}`)
    for (const navIdent of navIdents) {
      await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ($1, 'Old Name')`, [navIdent])
    }

    vi.mocked(getUsersByNavIdenter).mockImplementation(async (batch) =>
      batch.map((navIdent) => ({ navIdent, displayName: `Navn ${navIdent}`, email: null })),
    )

    const result = await populateUsersFromDirectory()

    expect(result).toEqual({ success: 150, skipped: 0, errors: 0, slackIdsResolved: 0, slackLookupErrors: 0 })
    expect(getUsersByNavIdenter).toHaveBeenCalledTimes(2)
    expect((vi.mocked(getUsersByNavIdenter).mock.calls[0][0] as string[]).length).toBe(100)
    expect((vi.mocked(getUsersByNavIdenter).mock.calls[1][0] as string[]).length).toBe(50)
  })

  it('resolves and persists Slack member ID for users missing one when Slack is configured', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Old Name')`)

    configureSlackEnv()
    vi.mocked(isSlackConfigured).mockReturnValue(true)
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([
      { navIdent: 'Z990001', displayName: 'Glad Fjord', email: 'glad.fjord@nav.no' },
    ])
    vi.mocked(lookupSlackUserIdByEmail).mockResolvedValue('U123456')

    const result = await populateUsersFromDirectory()

    expect(result).toEqual({ success: 1, skipped: 0, errors: 0, slackIdsResolved: 1, slackLookupErrors: 0 })
    expect(lookupSlackUserIdByEmail).toHaveBeenCalledWith('glad.fjord@nav.no')
    const { rows } = await pool.query(`SELECT slack_member_id FROM users WHERE nav_ident = 'Z990001'`)
    expect(rows[0].slack_member_id).toBe('U123456')
  })

  it('does not overwrite an existing Slack member ID or re-lookup for users who already have one', async () => {
    await pool.query(
      `INSERT INTO users (nav_ident, display_name, slack_member_id) VALUES ('Z990001', 'Old Name', 'U_EXISTING')`,
    )

    configureSlackEnv()
    vi.mocked(isSlackConfigured).mockReturnValue(true)
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([
      { navIdent: 'Z990001', displayName: 'Glad Fjord', email: 'glad.fjord@nav.no' },
    ])

    const result = await populateUsersFromDirectory()

    expect(result).toEqual({ success: 1, skipped: 0, errors: 0, slackIdsResolved: 0, slackLookupErrors: 0 })
    expect(lookupSlackUserIdByEmail).not.toHaveBeenCalled()
    const { rows } = await pool.query(`SELECT slack_member_id FROM users WHERE nav_ident = 'Z990001'`)
    expect(rows[0].slack_member_id).toBe('U_EXISTING')
  })

  it('skips Slack ID lookup when the directory returns no email for a user missing one', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Old Name')`)

    configureSlackEnv()
    vi.mocked(isSlackConfigured).mockReturnValue(true)
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([{ navIdent: 'Z990001', displayName: 'Glad Fjord', email: null }])

    const result = await populateUsersFromDirectory()

    expect(result).toEqual({ success: 1, skipped: 0, errors: 0, slackIdsResolved: 0, slackLookupErrors: 0 })
    expect(lookupSlackUserIdByEmail).not.toHaveBeenCalled()
    const { rows } = await pool.query(`SELECT slack_member_id FROM users WHERE nav_ident = 'Z990001'`)
    expect(rows[0].slack_member_id).toBeNull()
  })

  it('counts a Slack lookup failure without failing the whole user upsert', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Old Name')`)

    configureSlackEnv()
    vi.mocked(isSlackConfigured).mockReturnValue(true)
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([
      { navIdent: 'Z990001', displayName: 'Glad Fjord', email: 'glad.fjord@nav.no' },
    ])
    vi.mocked(lookupSlackUserIdByEmail).mockRejectedValue(new SlackLookupFailedError(new Error('Slack outage')))

    const result = await populateUsersFromDirectory()

    expect(result).toEqual({ success: 1, skipped: 0, errors: 0, slackIdsResolved: 0, slackLookupErrors: 1 })
    const { rows } = await pool.query(`SELECT slack_member_id FROM users WHERE nav_ident = 'Z990001'`)
    expect(rows[0].slack_member_id).toBeNull()
  })

  it('does not perform Slack lookups when Slack is not configured', async () => {
    await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ('Z990001', 'Old Name')`)

    vi.mocked(isSlackConfigured).mockReturnValue(false)
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([
      { navIdent: 'Z990001', displayName: 'Glad Fjord', email: 'glad.fjord@nav.no' },
    ])

    const result = await populateUsersFromDirectory()

    expect(result).toEqual({ success: 1, skipped: 0, errors: 0, slackIdsResolved: 0, slackLookupErrors: 0 })
    expect(lookupSlackUserIdByEmail).not.toHaveBeenCalled()
  })
})
