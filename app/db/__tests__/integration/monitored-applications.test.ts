import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createMonitoredApplication, getMonitoredApplicationById } from '../../monitored-applications.server'
import { truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

afterEach(async () => {
  await truncateAllTables(pool)
})

describe('createMonitoredApplication', () => {
  it('setter audit_start_year ved første INSERT', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'team-a',
      environment_name: 'prod-gcp',
      app_name: 'app-a',
      audit_start_year: 2026,
      default_branch: 'main',
    })
    expect(app.audit_start_year).toBe(2026)
  })

  it('beholder eksisterende audit_start_year ved ON CONFLICT (re-add)', async () => {
    const first = await createMonitoredApplication({
      team_slug: 'team-a',
      environment_name: 'prod-gcp',
      app_name: 'app-a',
      audit_start_year: 2023,
      default_branch: 'main',
    })
    expect(first.audit_start_year).toBe(2023)

    const second = await createMonitoredApplication({
      team_slug: 'team-a',
      environment_name: 'prod-gcp',
      app_name: 'app-a',
      audit_start_year: 2026,
      default_branch: 'main',
    })
    expect(second.audit_start_year).toBe(2023)

    const fetched = await getMonitoredApplicationById(first.id)
    expect(fetched?.audit_start_year).toBe(2023)
  })

  it('setter audit_start_year til oppgitt verdi', async () => {
    const year = new Date().getFullYear()
    const app = await createMonitoredApplication({
      team_slug: 'team-b',
      environment_name: 'prod-gcp',
      app_name: 'app-b',
      audit_start_year: year,
      default_branch: 'main',
    })
    expect(app.audit_start_year).toBe(year)
  })

  it('bruker oppgitt default_branch', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'team-c',
      environment_name: 'prod-gcp',
      app_name: 'app-c',
      audit_start_year: 2026,
      default_branch: 'master',
    })
    expect(app.default_branch).toBe('master')
  })
})
