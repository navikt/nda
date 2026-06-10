import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { upsertUser, upsertUserMapping } from '../../user-mappings.server'
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

/**
 * Poll until `condition` returns true or `timeoutMs` elapses.
 * Avoids fixed sleeps that are either flaky (too short) or slow (too long).
 */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('waitFor: condition not met within timeout')
}

describe('upsertUser', () => {
  it('inserts a new user row', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'z990001@nav.no' })

    const { rows } = await pool.query('SELECT * FROM users WHERE nav_ident = $1', ['Z990001'])
    expect(rows).toHaveLength(1)
    expect(rows[0].display_name).toBe('Glad Fjord')
    expect(rows[0].nav_email).toBe('z990001@nav.no')
    expect(rows[0].slack_member_id).toBeNull()
  })

  it('updates display_name and nav_email on conflict', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Gammel Navn', navEmail: 'old@nav.no' })
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'z990001@nav.no' })

    const { rows } = await pool.query('SELECT * FROM users WHERE nav_ident = $1', ['Z990001'])
    expect(rows).toHaveLength(1)
    expect(rows[0].display_name).toBe('Glad Fjord')
    expect(rows[0].nav_email).toBe('z990001@nav.no')
  })

  it('preserves existing slack_member_id when new value is null', async () => {
    await upsertUser({
      navIdent: 'Z990001',
      displayName: 'Glad Fjord',
      navEmail: 'z990001@nav.no',
      slackMemberId: 'U12345',
    })
    await upsertUser({
      navIdent: 'Z990001',
      displayName: 'Glad Fjord',
      navEmail: 'z990001@nav.no',
      slackMemberId: null,
    })

    const { rows } = await pool.query('SELECT slack_member_id FROM users WHERE nav_ident = $1', ['Z990001'])
    expect(rows[0].slack_member_id).toBe('U12345')
  })

  it('updates slack_member_id when a new value is provided', async () => {
    await upsertUser({
      navIdent: 'Z990001',
      displayName: 'Glad Fjord',
      navEmail: 'z990001@nav.no',
      slackMemberId: 'U12345',
    })
    await upsertUser({
      navIdent: 'Z990001',
      displayName: 'Glad Fjord',
      navEmail: 'z990001@nav.no',
      slackMemberId: 'U99999',
    })

    const { rows } = await pool.query('SELECT slack_member_id FROM users WHERE nav_ident = $1', ['Z990001'])
    expect(rows[0].slack_member_id).toBe('U99999')
  })

  it('reactivates a soft-deleted user on upsert', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'z990001@nav.no' })
    await pool.query("UPDATE users SET deleted_at = NOW(), deleted_by = 'Z990002' WHERE nav_ident = 'Z990001'")

    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'z990001@nav.no' })

    const { rows } = await pool.query('SELECT deleted_at FROM users WHERE nav_ident = $1', ['Z990001'])
    expect(rows[0].deleted_at).toBeNull()
  })
})

describe('upsertUserMapping dual-write to users', () => {
  it('writes to users when nav_ident, display_name, and nav_email are present', async () => {
    await upsertUserMapping({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
      navEmail: 'z990001@nav.no',
    })

    // Poll until the best-effort async dual-write completes
    await waitFor(async () => {
      const { rows } = await pool.query('SELECT 1 FROM users WHERE nav_ident = $1', ['Z990001'])
      return rows.length === 1
    })

    const { rows } = await pool.query('SELECT * FROM users WHERE nav_ident = $1', ['Z990001'])
    expect(rows).toHaveLength(1)
    expect(rows[0].display_name).toBe('Glad Fjord')
    expect(rows[0].nav_email).toBe('z990001@nav.no')
  })

  it('does not write to users when nav_ident is missing', async () => {
    await upsertUserMapping({
      githubUsername: 'anonym',
      displayName: 'Rask Elv',
      navEmail: 'rask.elv@nav.no',
    })

    // No async dual-write is triggered (nav_ident is missing), no sleep needed
    const { rows } = await pool.query('SELECT * FROM users')
    expect(rows).toHaveLength(0)
  })

  it('does not write to users when display_name is missing', async () => {
    await upsertUserMapping({
      githubUsername: 'uten-navn',
      navIdent: 'Z990002',
      navEmail: 'z990002@nav.no',
    })

    // No async dual-write is triggered (display_name is missing), no sleep needed
    const { rows } = await pool.query('SELECT * FROM users')
    expect(rows).toHaveLength(0)
  })

  it('syncs slack_member_id to users table', async () => {
    await upsertUserMapping({
      githubUsername: 'gladfjord',
      displayName: 'Glad Fjord',
      navIdent: 'Z990001',
      navEmail: 'z990001@nav.no',
      slackMemberId: 'U12345',
    })

    // Poll until the best-effort async dual-write completes
    await waitFor(async () => {
      const { rows } = await pool.query('SELECT 1 FROM users WHERE nav_ident = $1 AND slack_member_id = $2', [
        'Z990001',
        'U12345',
      ])
      return rows.length === 1
    })

    const { rows } = await pool.query('SELECT slack_member_id FROM users WHERE nav_ident = $1', ['Z990001'])
    expect(rows[0].slack_member_id).toBe('U12345')
  })
})
