import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { searchDeployments } from '../../deployments.server'
import { seedApp, seedApplicationRepository, seedRepository, truncateAllTables } from './helpers'

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

describe('searchDeployments monorepo results', () => {
  const owner = 'navikt'
  const repo = 'monorepo-example'

  it('links to the repository page when every app shares the same linked repository', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9010',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9010',
    })
    const repositoryId = await seedRepository(pool, { githubRepoId: '9010', githubOwner: owner, githubRepoName: repo })

    const results = await searchDeployments(repo, 10)
    const monorepoResult = results.find((r) => r.type === 'monorepo')
    expect(monorepoResult?.url).toBe(`/repository/${owner}/${repo}?repositoryId=${repositoryId}`)
  })

  it('falls back to the deployments page when apps point at different repositories', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9011',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9012',
    })
    await seedRepository(pool, { githubRepoId: '9011', githubOwner: owner, githubRepoName: repo })

    const results = await searchDeployments(repo, 10)
    const monorepoResult = results.find((r) => r.type === 'monorepo')
    expect(monorepoResult?.url).toBe('/team/team-a/env/prod/app/service-a/deployments?monorepo=true')
  })

  it('falls back to the deployments page when no app has a github_repo_id at all', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })

    const results = await searchDeployments(repo, 10)
    const monorepoResult = results.find((r) => r.type === 'monorepo')
    expect(monorepoResult?.url).toBe('/team/team-a/env/prod/app/service-a/deployments?monorepo=true')
  })
})

describe('searchDeployments application results', () => {
  it('returns an app result for each environment and includes the environment in each subtitle', async () => {
    await seedApp(pool, { teamSlug: 'pensjon-regler', appName: 'pensjon-regler', environment: 'prod-fss' })
    await seedApp(pool, { teamSlug: 'pensjon-regler', appName: 'pensjon-regler', environment: 'prod-gcp' })

    const appResults = (await searchDeployments('pensjon-regler', 10)).filter((result) => result.type === 'app')

    expect(appResults).toHaveLength(2)
    expect(appResults).toEqual(
      expect.arrayContaining([
        {
          type: 'app',
          url: '/team/pensjon-regler/env/prod-fss/app/pensjon-regler',
          title: 'pensjon-regler',
          subtitle: 'Miljø: prod-fss · pensjon-regler',
        },
        {
          type: 'app',
          url: '/team/pensjon-regler/env/prod-gcp/app/pensjon-regler',
          title: 'pensjon-regler',
          subtitle: 'Miljø: prod-gcp · pensjon-regler',
        },
      ]),
    )
  })

  it('includes the environment when an app only runs in one environment', async () => {
    await seedApp(pool, { teamSlug: 'team-a', appName: 'single-app', environment: 'prod-gcp' })

    const appResult = (await searchDeployments('single-app', 10)).find((result) => result.type === 'app')

    expect(appResult?.subtitle).toBe('Miljø: prod-gcp · team-a')
  })
})

describe('searchDeployments team results', () => {
  it('uses the singular form when a Nais team has one application', async () => {
    await seedApp(pool, { teamSlug: 'nais-team', appName: 'single-app', environment: 'prod-gcp' })

    const teamResult = (await searchDeployments('nais-team', 10)).find((result) => result.type === 'team')

    expect(teamResult?.subtitle).toBe('1 applikasjon')
  })
})
