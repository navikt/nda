/**
 * Integration test: Verify all database migrations apply correctly.
 *
 * The global-setup already ran all migrations on the test container.
 * This test verifies the resulting schema is correct.
 */

import { readdirSync } from 'node:fs'
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

describe('Database migrations', () => {
  it('should have applied all migration files', async () => {
    const migrationsDir = join(process.cwd(), 'app/db/migrations')
    const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))

    const { rows } = await pool.query<{ name: string }>('SELECT name FROM pgmigrations ORDER BY run_on')
    const appliedNames = rows.map((r) => r.name)

    for (const file of migrationFiles) {
      const name = file.replace('.sql', '')
      expect(appliedNames).toContain(name)
    }
  })

  it('should have expected core tables', async () => {
    const { rows } = await pool.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `)
    const tables = rows.map((r) => r.tablename)

    // Core tables that must exist
    const expectedTables = [
      'sections',
      'monitored_applications',
      'deployments',
      'dev_teams',
      'dev_team_nais_teams',
      'dev_team_applications',
      'boards',
      'board_objectives',
      'board_key_results',
      'deployment_goal_links',
      'audit_reports',
      'sync_jobs',
    ]

    for (const table of expectedTables) {
      expect(tables, `Expected table "${table}" to exist`).toContain(table)
    }
  })

  it('should be idempotent (running migrations again is a no-op)', async () => {
    const { runner } = await import('node-pg-migrate')

    // Running migrations again should complete without error
    await expect(
      runner({
        databaseUrl: process.env.DATABASE_URL ?? '',
        dir: join(process.cwd(), 'app/db/migrations'),
        direction: 'up',
        migrationsTable: 'pgmigrations',
        schema: 'public',
        log: () => {},
      }),
    ).resolves.not.toThrow()
  })

  it('should have correct foreign key relationships', async () => {
    const { rows } = await pool.query<{
      constraint_name: string
      table_name: string
      column_name: string
      foreign_table_name: string
    }>(`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name
    `)

    // Verify key relationships exist
    const fks = rows.map((r) => `${r.table_name}.${r.column_name} -> ${r.foreign_table_name}`)

    expect(fks).toContainEqual('dev_teams.section_id -> sections')
    expect(fks).toContainEqual('boards.dev_team_id -> dev_teams')
    expect(fks).toContainEqual('board_objectives.board_id -> boards')
    expect(fks).toContainEqual('board_key_results.objective_id -> board_objectives')
    expect(fks).toContainEqual('deployments.monitored_app_id -> monitored_applications')
  })
})
