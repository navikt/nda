import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Migration file timestamps', () => {
  const migrationsDir = join(process.cwd(), 'app/db/migrations')
  const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))

  it('should have at least one migration file', () => {
    expect(migrationFiles.length).toBeGreaterThan(0)
  })

  it('should not contain migration files timestamped in the future', () => {
    const now = Date.now()
    const futureFiles = migrationFiles.filter((file) => {
      const timestamp = Number.parseInt(file.split('_')[0], 10)
      return Number.isFinite(timestamp) && timestamp > now
    })

    expect(futureFiles, `Found migration files timestamped in the future: ${futureFiles.join(', ')}`).toEqual([])
  })

  it('should have a valid epoch millisecond timestamp prefix on every migration file', () => {
    for (const file of migrationFiles) {
      const [prefix] = file.split('_')
      expect(prefix, `Migration file "${file}" must start with a numeric timestamp prefix`).toMatch(/^\d{13}$/)
    }
  })
})
