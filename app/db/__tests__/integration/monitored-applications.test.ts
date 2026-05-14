/**
 * Integration tests for createMonitoredApplication.
 *
 * Spesifikt: verifiserer at audit_start_year settes ved første INSERT, og at
 * eksisterende verdi *ikke* overskrives ved ON CONFLICT (re-add av app skal
 * ikke kunne endre revisjonsvinduet utilsiktet).
 */

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
    })
    expect(app.audit_start_year).toBe(2026)
  })

  it('beholder eksisterende audit_start_year ved ON CONFLICT (re-add)', async () => {
    const first = await createMonitoredApplication({
      team_slug: 'team-a',
      environment_name: 'prod-gcp',
      app_name: 'app-a',
      audit_start_year: 2023,
    })
    expect(first.audit_start_year).toBe(2023)

    // Re-add med annet årstall — skal IKKE overskrive
    const second = await createMonitoredApplication({
      team_slug: 'team-a',
      environment_name: 'prod-gcp',
      app_name: 'app-a',
      audit_start_year: 2026,
    })
    expect(second.audit_start_year).toBe(2023)

    // Verifiser også via ny lesing
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
    })
    expect(app.audit_start_year).toBe(year)
  })
})
