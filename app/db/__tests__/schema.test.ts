import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Database schema', () => {
  it('scopes Nais deployment ID uniqueness to the monitored application', () => {
    const schema = readFileSync(join(process.cwd(), 'app/db/schema.sql'), 'utf8')
    const deploymentsTable = schema.match(/CREATE TABLE IF NOT EXISTS deployments \(([\s\S]*?)\n\);/)?.[1]

    expect(deploymentsTable).toBeDefined()
    expect(deploymentsTable).toMatch(/nais_deployment_id VARCHAR\(255\) NOT NULL/)
    expect(deploymentsTable).not.toMatch(/nais_deployment_id VARCHAR\(255\) UNIQUE/)
    expect(deploymentsTable).toMatch(/UNIQUE \(monitored_app_id, nais_deployment_id\)/)
  })
})
