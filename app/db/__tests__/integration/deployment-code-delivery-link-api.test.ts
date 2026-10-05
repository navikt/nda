import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closePool } from '~/db/connection.server'
import {
  createRepositoryCodeDelivery,
  linkDeploymentToRepositoryCodeDelivery,
} from '~/db/repository-code-deliveries.server'
import { seedApp, seedDeployment, seedRepository, truncateAllTables } from './helpers'

let pool: Pool
const headSha = 'b'.repeat(40)

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await closePool()
  await pool.end()
})

afterEach(async () => {
  await truncateAllTables(pool)
})

async function createRepository(githubRepoId = '123') {
  return seedRepository(pool, {
    githubRepoId,
    githubOwner: 'navikt',
    githubRepoName: `repo-${githubRepoId}`,
  })
}

async function createDeployment(repositoryId: number | null, commitSha: string | null = headSha, appName = 'app-a') {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName, environment: 'prod-gcp' })
  const deploymentId = await seedDeployment(pool, {
    monitoredAppId: appId,
    teamSlug: 'team-a',
    appName,
    environment: 'prod-gcp',
    commitSha,
    fourEyesStatus: 'manually_approved',
  })
  await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryId, deploymentId])
  return deploymentId
}

async function createDelivery(repositoryId: number, head = headSha) {
  return createRepositoryCodeDelivery({ repositoryId, baseSha: 'a'.repeat(40), headSha: head })
}

async function getDeployment(deploymentId: number) {
  const { rows } = await pool.query('SELECT * FROM deployments WHERE id = $1', [deploymentId])
  return rows[0]
}

describe('deployment code delivery link API', () => {
  it('links multiple apps to one delivery and changes only the link', async () => {
    const repositoryId = await createRepository()
    const delivery = await createDelivery(repositoryId)
    const firstId = await createDeployment(repositoryId)
    const secondId = await createDeployment(repositoryId, headSha.toUpperCase(), 'app-b')
    for (const deploymentId of [firstId, secondId]) {
      const before = await getDeployment(deploymentId)
      expect(await linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id)).toBe(true)
      expect(await getDeployment(deploymentId)).toEqual({ ...before, repository_code_delivery_id: delivery.id })
      expect(await linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id)).toBe(false)
      expect(await getDeployment(deploymentId)).toEqual({ ...before, repository_code_delivery_id: delivery.id })
    }
  })

  it('sets the link exactly once for concurrent calls', async () => {
    const repositoryId = await createRepository()
    const delivery = await createDelivery(repositoryId)
    const deploymentId = await createDeployment(repositoryId)
    const [first, second, third] = await Promise.all([
      linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id),
      linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id),
      linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id),
    ])
    expect([first, second, third].sort()).toEqual([false, false, true])
    expect((await getDeployment(deploymentId)).repository_code_delivery_id).toBe(delivery.id)
  })

  it.each([null, '', 'b'.repeat(7), 'g'.repeat(40), 'c'.repeat(40)])(
    'rejects missing, incomplete or mismatching deployment SHA %j',
    async (sha) => {
      const repositoryId = await createRepository()
      const delivery = await createDelivery(repositoryId)
      const deploymentId = await createDeployment(repositoryId, sha)
      const before = await getDeployment(deploymentId)
      await expect(linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id)).rejects.toThrow('full head SHA')
      expect(await getDeployment(deploymentId)).toEqual(before)
    },
  )

  it('rejects missing or different repository identity even when SHA matches', async () => {
    const repositoryId = await createRepository()
    const otherRepositoryId = await createRepository('456')
    const delivery = await createDelivery(repositoryId)
    for (const id of [null, otherRepositoryId]) {
      const deploymentId = await createDeployment(id, headSha, `app-${id}`)
      const before = await getDeployment(deploymentId)
      await expect(linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id)).rejects.toThrow(
        'different repository identities',
      )
      expect(await getDeployment(deploymentId)).toEqual(before)
    }
  })

  it('does not replace an existing link even when the requested delivery matches deployment identity', async () => {
    const repositoryId = await createRepository()
    const delivery = await createDelivery(repositoryId)
    const otherDelivery = await createDelivery(repositoryId, 'c'.repeat(40))
    const deploymentId = await createDeployment(repositoryId)
    await pool.query('UPDATE deployments SET repository_code_delivery_id = $1 WHERE id = $2', [
      otherDelivery.id,
      deploymentId,
    ])
    const before = await getDeployment(deploymentId)
    await expect(linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id)).rejects.toThrow('already linked')
    expect(await getDeployment(deploymentId)).toEqual(before)
  })

  it('revalidates an existing link instead of accepting mismatched identity as an unchanged operation', async () => {
    const repositoryId = await createRepository()
    const delivery = await createDelivery(repositoryId)
    const deploymentId = await createDeployment(repositoryId)
    await linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id)
    await pool.query('UPDATE deployments SET commit_sha = $1 WHERE id = $2', ['c'.repeat(40), deploymentId])
    await expect(linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id)).rejects.toThrow('full head SHA')
  })

  it('preserves the valid link when concurrent requests target different deliveries', async () => {
    const repositoryId = await createRepository()
    const delivery = await createDelivery(repositoryId)
    const otherDelivery = await createDelivery(repositoryId, 'c'.repeat(40))
    const deploymentId = await createDeployment(repositoryId)
    const [valid, invalid] = await Promise.allSettled([
      linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id),
      linkDeploymentToRepositoryCodeDelivery(deploymentId, otherDelivery.id),
    ])
    expect(valid).toEqual({ status: 'fulfilled', value: true })
    expect(invalid.status).toBe('rejected')
    expect((await getDeployment(deploymentId)).repository_code_delivery_id).toBe(delivery.id)
  })

  it('rejects missing rows explicitly without writing', async () => {
    const repositoryId = await createRepository()
    const delivery = await createDelivery(repositoryId)
    const deploymentId = await createDeployment(repositoryId)
    await expect(linkDeploymentToRepositoryCodeDelivery(2147483647, delivery.id)).rejects.toThrow(
      'Deployment 2147483647 was not found',
    )
    await expect(linkDeploymentToRepositoryCodeDelivery(deploymentId, 2147483647)).rejects.toThrow(
      'Code delivery 2147483647 was not found',
    )
    expect((await getDeployment(deploymentId)).repository_code_delivery_id).toBeNull()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid ID %j', async (id) => {
    await expect(linkDeploymentToRepositoryCodeDelivery(id, 1)).rejects.toThrow('Deployment ID')
    await expect(linkDeploymentToRepositoryCodeDelivery(1, id)).rejects.toThrow('Code delivery ID')
  })
})
