import { lockRepositoryCodeDeliveries, pool, withTransaction } from './connection.server'
import { REPOSITORY_SETTING_KEYS, recordRepoConfigAuditLog } from './repositories.server'

export type RestartCodeDeliveryTrackingResult =
  | { ok: false; reason: 'repo_not_found' | 'tracking_disabled' }
  | {
      ok: true
      since: Date
      deletedDeliveries: number
      unlinkedDeployments: number
      clearedUnresolved: number
    }

export async function restartCodeDeliveryTracking(params: {
  repositoryId: number
  since: Date
  changedByNavIdent: string
  changedByName?: string
}): Promise<RestartCodeDeliveryTrackingResult> {
  const { repositoryId, since, changedByNavIdent, changedByName } = params

  return withTransaction(async (client) => {
    await lockRepositoryCodeDeliveries(client, repositoryId)

    const { rows } = await client.query<{ code_delivery_tracking: boolean; code_delivery_tracking_since: Date | null }>(
      `SELECT code_delivery_tracking, code_delivery_tracking_since FROM repositories WHERE id = $1 FOR UPDATE`,
      [repositoryId],
    )
    const repository = rows[0]
    if (!repository) return { ok: false, reason: 'repo_not_found' }
    if (!repository.code_delivery_tracking) return { ok: false, reason: 'tracking_disabled' }

    const cleared = await client.query(
      `DELETE FROM repository_code_delivery_unresolved
       WHERE deployment_id IN (SELECT id FROM deployments WHERE repository_id = $1)`,
      [repositoryId],
    )
    const unlinked = await client.query(
      `UPDATE deployments SET repository_code_delivery_id = NULL
       WHERE repository_code_delivery_id IN (SELECT id FROM repository_code_deliveries WHERE repository_id = $1)`,
      [repositoryId],
    )
    const deleted = await client.query(`DELETE FROM repository_code_deliveries WHERE repository_id = $1`, [
      repositoryId,
    ])
    await client.query(`UPDATE repositories SET code_delivery_tracking_since = $1, updated_at = now() WHERE id = $2`, [
      since,
      repositoryId,
    ])

    const result = {
      ok: true as const,
      since,
      deletedDeliveries: deleted.rowCount ?? 0,
      unlinkedDeployments: unlinked.rowCount ?? 0,
      clearedUnresolved: cleared.rowCount ?? 0,
    }

    await recordRepoConfigAuditLog(
      {
        repositoryId,
        settingKey: REPOSITORY_SETTING_KEYS.CODE_DELIVERY_TRACKING_RESTART,
        oldValue: { since: repository.code_delivery_tracking_since?.toISOString() ?? null },
        newValue: {
          since: since.toISOString(),
          deleted_deliveries: result.deletedDeliveries,
          unlinked_deployments: result.unlinkedDeployments,
          cleared_unresolved: result.clearedUnresolved,
        },
        changedByNavIdent,
        changedByName,
      },
      client,
    )

    return result
  })
}

export async function getEarliestDeploymentAtForRepository(repositoryId: number): Promise<Date | null> {
  const { rows } = await pool.query<{ earliest: Date | null }>(
    `SELECT min(created_at) AS earliest FROM deployments WHERE repository_id = $1`,
    [repositoryId],
  )
  return rows[0]?.earliest ?? null
}
