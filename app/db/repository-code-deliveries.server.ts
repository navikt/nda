import { pool } from './connection.server'

export interface RepositoryCodeDelivery {
  id: number
  repository_id: number
  base_sha: string
  head_sha: string
  created_at: Date
}

interface CreateRepositoryCodeDeliveryInput {
  repositoryId: number
  baseSha: string
  headSha: string
}

export class RepositoryCodeDeliveryConflictError extends Error {
  constructor(
    readonly existingDelivery: RepositoryCodeDelivery,
    readonly requestedBaseSha: string,
  ) {
    super(
      `Repository ${existingDelivery.repository_id} already has delivery ${existingDelivery.head_sha} with base ${existingDelivery.base_sha}; requested base ${requestedBaseSha}`,
    )
    this.name = 'RepositoryCodeDeliveryConflictError'
  }
}

function validateRepositoryId(repositoryId: number): void {
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new Error('Repository ID must be a positive integer')
  }
}

function validateFullSha(sha: string): void {
  if (sha.length !== 40 || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('Commit SHA must contain exactly 40 hexadecimal characters')
  }
}

export async function getRepositoryCodeDelivery(
  repositoryId: number,
  headSha: string,
): Promise<RepositoryCodeDelivery | null> {
  validateRepositoryId(repositoryId)
  validateFullSha(headSha)
  const { rows } = await pool.query<RepositoryCodeDelivery>(
    `SELECT id, repository_id, base_sha, head_sha, created_at
     FROM repository_code_deliveries
     WHERE repository_id = $1 AND lower(head_sha) = lower($2)`,
    [repositoryId, headSha],
  )
  return rows[0] ?? null
}

export async function createRepositoryCodeDelivery({
  repositoryId,
  baseSha,
  headSha,
}: CreateRepositoryCodeDeliveryInput): Promise<RepositoryCodeDelivery> {
  validateRepositoryId(repositoryId)
  validateFullSha(baseSha)
  validateFullSha(headSha)
  const { rows } = await pool.query<RepositoryCodeDelivery>(
    `INSERT INTO repository_code_deliveries (repository_id, base_sha, head_sha)
     VALUES ($1, $2, $3)
     ON CONFLICT (repository_id, lower(head_sha)) DO NOTHING
     RETURNING id, repository_id, base_sha, head_sha, created_at`,
    [repositoryId, baseSha, headSha],
  )
  if (rows[0]) return rows[0]

  const existingDelivery = await getRepositoryCodeDelivery(repositoryId, headSha)
  if (!existingDelivery) {
    throw new Error(`Conflicting code delivery for repository ${repositoryId} and head ${headSha} was not found`)
  }
  if (existingDelivery.base_sha.toLowerCase() !== baseSha.toLowerCase()) {
    throw new RepositoryCodeDeliveryConflictError(existingDelivery, baseSha)
  }
  return existingDelivery
}
