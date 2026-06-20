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

    const fks = rows.map((r) => `${r.table_name}.${r.column_name} -> ${r.foreign_table_name}`)

    expect(fks).toContainEqual('dev_teams.section_id -> sections')
    expect(fks).toContainEqual('boards.dev_team_id -> dev_teams')
    expect(fks).toContainEqual('board_objectives.board_id -> boards')
    expect(fks).toContainEqual('board_key_results.objective_id -> board_objectives')
    expect(fks).toContainEqual('deployments.monitored_app_id -> monitored_applications')
  })

  it('should have is_active columns on board_objectives and board_key_results', async () => {
    const { rows } = await pool.query<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: string
      column_default: string
    }>(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('board_objectives', 'board_key_results')
        AND column_name = 'is_active'
      ORDER BY table_name
    `)

    expect(rows).toHaveLength(2)

    for (const col of rows) {
      expect(col.data_type).toBe('boolean')
      expect(col.is_nullable).toBe('NO')
      expect(col.column_default).toContain('true')
    }

    expect(rows.map((r) => r.table_name)).toEqual(['board_key_results', 'board_objectives'])
  })

  it('should have RESTRICT delete rules on soft-delete protected foreign keys', async () => {
    const { rows } = await pool.query<{
      constraint_name: string
      delete_rule: string
    }>(`
      SELECT tc.constraint_name, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name IN (
          'deployment_goal_links_objective_id_fkey',
          'deployment_goal_links_key_result_id_fkey',
          'board_objectives_board_id_fkey',
          'board_key_results_objective_id_fkey',
          'external_references_objective_id_fkey',
          'external_references_key_result_id_fkey'
        )
      ORDER BY tc.constraint_name
    `)

    expect(rows).toHaveLength(6)
    for (const fk of rows) {
      expect(fk.delete_rule, `${fk.constraint_name} should be RESTRICT`).toBe('RESTRICT')
    }
  })

  it('should have only the partial active index on deployment_comments(deployment_id)', async () => {
    const { rows } = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'deployment_comments'
      ORDER BY indexname
    `)
    const names = rows.map((r) => r.indexname)
    expect(names).toContain('idx_deployment_comments_active')
    expect(names).not.toContain('idx_deployment_comments_deployment_id')
    expect(names).not.toContain('idx_comments_deployment')
  })

  it('should have only the partial active index on dev_team_applications', async () => {
    const { rows } = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'dev_team_applications'
      ORDER BY indexname
    `)
    const names = rows.map((r) => r.indexname)
    expect(names).toContain('idx_dev_team_applications_active')
    expect(names).not.toContain('idx_dev_team_applications_app')
  })

  it('should have only the partial active index on section_teams', async () => {
    const { rows } = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'section_teams'
      ORDER BY indexname
    `)
    const names = rows.map((r) => r.indexname)
    expect(names).toContain('idx_section_teams_active')
    expect(names).not.toContain('idx_section_teams_team_slug')
  })

  it('should have only the partial active index on dev_team_nais_teams', async () => {
    const { rows } = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'dev_team_nais_teams'
      ORDER BY indexname
    `)
    const names = rows.map((r) => r.indexname)
    expect(names).toContain('idx_dev_team_nais_teams_active')
    expect(names).not.toContain('idx_dev_team_nais_teams_slug')
  })

  it('should have partial active indexes on external_references', async () => {
    const { rows } = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'external_references'
      ORDER BY indexname
    `)
    const names = rows.map((r) => r.indexname)
    expect(names).toContain('idx_external_references_active_objective')
    expect(names).toContain('idx_external_references_active_key_result')
  })
})
