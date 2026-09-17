import { pool } from '~/db/connection.server'

/**
 * Runs a dedup-guarded snapshot insert inside its own transaction.
 *
 * The advisory lock is acquired in a separate statement *before* the
 * dedup lookup/insert statement runs. Postgres takes a fresh MVCC
 * snapshot per statement (default READ COMMITTED), so once a concurrent
 * caller has finished waiting on the lock, its subsequent lookup sees the
 * row the previous caller just committed — the CTE-only approach (lock and
 * lookup in one statement) could still see a stale snapshot taken before
 * the wait completed, allowing duplicate inserts.
 *
 * `namespace` scopes the lock to a specific table/writer so unrelated
 * snapshot writers never contend on the same advisory lock key.
 */
export async function saveRawSnapshotWithLock(
  namespace: number,
  lockKey: string,
  sql: string,
  params: unknown[],
): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [namespace, lockKey])
    const result = await client.query(sql, params)
    await client.query('COMMIT')
    return result.rows[0].id
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // best-effort rollback; the connection will still be released below
    }
    throw err
  } finally {
    client.release()
  }
}
