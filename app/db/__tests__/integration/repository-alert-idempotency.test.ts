import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

describe('repository alert idempotency migration', () => {
  it('preserves historical duplicates and resolutions while enforcing uniqueness for new alerts', async () => {
    const migration = readFileSync(
      join(process.cwd(), 'app/db/migrations/1791719000000_add-new-alert-event-uniqueness.sql'),
      'utf8',
    )
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(`
        CREATE TEMP TABLE repository_alerts (
          id INTEGER PRIMARY KEY,
          deployment_id INTEGER,
          alert_type TEXT NOT NULL,
          old_owner TEXT,
          old_repo TEXT,
          new_owner TEXT NOT NULL,
          new_repo TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          resolved_at TIMESTAMPTZ,
          resolved_by TEXT,
          resolution_notes TEXT,
          created_at TIMESTAMPTZ NOT NULL
        )
      `)
      await client.query(`
        INSERT INTO repository_alerts (
          id, deployment_id, alert_type, old_owner, old_repo, new_owner, new_repo, status,
          resolved_at, resolved_by, resolution_notes, created_at
        ) VALUES
          (10, 1, 'pending_approval', 'navikt', 'expected', 'navikt', 'new', 'resolved',
            '2026-10-10T01:00:00Z', 'web-user', 'Manually reviewed', '2026-10-10T00:00:00Z'),
          (11, 1, 'pending_approval', 'navikt', 'expected', 'navikt', 'new', 'open',
            NULL, NULL, NULL, '2026-10-10T00:00:00Z')
      `)

      await client.query(migration)

      const historicalRows = await client.query<{
        id: number
        idempotency_key_enabled: boolean | null
        resolved: boolean
        resolution_note: string | null
        expected_github_owner: string | null
        detected_github_repo_name: string
      }>(`
        SELECT
          id,
          idempotency_key_enabled,
          resolved,
          resolution_note,
          expected_github_owner,
          detected_github_repo_name
        FROM repository_alerts
        ORDER BY id
      `)
      expect(historicalRows.rows).toEqual([
        {
          id: 10,
          idempotency_key_enabled: null,
          resolved: true,
          resolution_note: 'Manually reviewed',
          expected_github_owner: 'navikt',
          detected_github_repo_name: 'new',
        },
        {
          id: 11,
          idempotency_key_enabled: null,
          resolved: false,
          resolution_note: null,
          expected_github_owner: 'navikt',
          detected_github_repo_name: 'new',
        },
      ])

      const firstNewAlert = await client.query(
        `INSERT INTO repository_alerts (
          id, deployment_id, alert_type, expected_github_owner, expected_github_repo_name,
          detected_github_owner, detected_github_repo_name, created_at
        ) VALUES (12, 2, 'pending_approval', 'navikt', 'expected', 'navikt', 'new', '2026-10-11T00:00:00Z')
        ON CONFLICT DO NOTHING
        RETURNING id, idempotency_key_enabled`,
      )
      expect(firstNewAlert.rows).toEqual([{ id: 12, idempotency_key_enabled: true }])

      const repeatedNewAlert = await client.query(
        `INSERT INTO repository_alerts (
          id, deployment_id, alert_type, expected_github_owner, expected_github_repo_name,
          detected_github_owner, detected_github_repo_name, created_at
        ) VALUES (13, 2, 'pending_approval', 'navikt', 'expected', 'navikt', 'new', '2026-10-11T00:01:00Z')
        ON CONFLICT DO NOTHING
        RETURNING id`,
      )
      expect(repeatedNewAlert.rowCount).toBe(0)
    } finally {
      try {
        await client.query('ROLLBACK')
      } finally {
        client.release()
      }
    }
  })

  it('preserves duplicate rows in the current alert schema', async () => {
    const migration = readFileSync(
      join(process.cwd(), 'app/db/migrations/1791719000000_add-new-alert-event-uniqueness.sql'),
      'utf8',
    )
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(`
        CREATE TEMP TABLE repository_alerts (
          id INTEGER PRIMARY KEY,
          deployment_id INTEGER,
          alert_type TEXT NOT NULL,
          expected_github_owner TEXT NOT NULL,
          expected_github_repo_name TEXT NOT NULL,
          detected_github_owner TEXT NOT NULL,
          detected_github_repo_name TEXT NOT NULL,
          resolved BOOLEAN NOT NULL DEFAULT FALSE,
          resolved_at TIMESTAMPTZ,
          resolved_by TEXT,
          resolution_note TEXT,
          created_at TIMESTAMPTZ NOT NULL
        )
      `)
      await client.query(`
        INSERT INTO repository_alerts (
          id, deployment_id, alert_type, expected_github_owner, expected_github_repo_name,
          detected_github_owner, detected_github_repo_name, resolved, resolved_at,
          resolved_by, resolution_note, created_at
        ) VALUES
          (20, 1, 'pending_approval', 'navikt', 'expected', 'navikt', 'new', TRUE,
            '2026-10-10T01:00:00Z', 'web-user', 'First resolution', '2026-10-10T00:00:00Z'),
          (21, 1, 'pending_approval', 'navikt', 'expected', 'navikt', 'new', TRUE,
            '2026-10-10T02:00:00Z', 'web-user', 'Second resolution', '2026-10-10T00:00:00Z')
      `)

      await client.query(migration)

      const historicalRows = await client.query<{ id: number; resolution_note: string | null }>(`
        SELECT id, resolution_note
        FROM repository_alerts
        ORDER BY id
      `)
      expect(historicalRows.rows).toEqual([
        { id: 20, resolution_note: 'First resolution' },
        { id: 21, resolution_note: 'Second resolution' },
      ])
    } finally {
      try {
        await client.query('ROLLBACK')
      } finally {
        client.release()
      }
    }
  })
})
