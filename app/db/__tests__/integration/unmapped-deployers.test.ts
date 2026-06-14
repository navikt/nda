/**
 * Integration test: getUnmappedContributors
 *
 * Verifies that the function correctly identifies GitHub usernames from
 * a team's deployments that lack a corresponding user_github_accounts row.
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getUnmappedContributors } from '~/db/deployments/home.server'
import { seedApp, seedDeployment, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

afterEach(async () => {
  await truncateAllTables(pool)
  navIdentCounter = 1
})

let navIdentCounter = 1
async function seedGithubAccount(githubUsername: string): Promise<void> {
  const navIdent = `Z99${String(navIdentCounter++).padStart(4, '0')}`
  await pool.query(`INSERT INTO users (nav_ident, display_name, nav_email) VALUES ($1, $2, $3)`, [
    navIdent,
    `Name of ${githubUsername}`,
    `${githubUsername}@nav.no`,
  ])
  await pool.query(`INSERT INTO user_github_accounts (github_username, nav_ident) VALUES ($1, $2)`, [
    githubUsername.toLowerCase(),
    navIdent,
  ])
}

describe('getUnmappedContributors', () => {
  it('returns deployer usernames that have no user_github_accounts row', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'bob',
    })
    await seedGithubAccount('alice')

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual(['bob'])
  })

  it('returns empty array when all deployers are mapped', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'alice',
    })
    await seedGithubAccount('alice')

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual([])
  })

  it('returns empty array when there are no deployments', async () => {
    await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual([])
  })

  it('excludes bot accounts (usernames ending with [bot])', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'dependabot[bot]',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'real-person',
    })

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual(['real-person'])
  })

  it('does not include PR creator usernames (only deployers matter)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'deployer-1',
      githubPrData: { creator: { username: 'pr-author-1' } },
    })
    await seedGithubAccount('deployer-1')

    const result = await getUnmappedContributors(['team-a'])
    // pr-author-1 is NOT included — only deployer_username is checked
    expect(result).toEqual([])
  })

  it('deduplicates deployer usernames across multiple deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'alice',
    })

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual(['alice'])
  })

  it('performs case-insensitive matching against user_github_accounts', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'Alice',
    })
    await seedGithubAccount('alice')

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual([])
  })

  it('excludes soft-deleted user mappings', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'alice',
    })
    await seedGithubAccount('alice')
    await pool.query(`UPDATE user_github_accounts SET deleted_at = NOW() WHERE github_username = 'alice'`)

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual(['alice'])
  })

  it('scopes to the given nais team slugs only', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc-b', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-b',
      environment: 'prod',
      deployerUsername: 'bob',
    })

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual(['alice'])
  })

  it('includes apps matched via directAppIds', async () => {
    const appId = await seedApp(pool, { teamSlug: 'other-team', appName: 'direct-app', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'other-team',
      environment: 'prod',
      deployerUsername: 'charlie',
    })

    const result = await getUnmappedContributors([], [appId])
    expect(result).toEqual(['charlie'])
  })

  it('ignores inactive apps', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'old-svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'alice',
    })
    await pool.query('UPDATE monitored_applications SET is_active = false WHERE id = $1', [appId])

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual([])
  })

  it('ignores deployments from previous years', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    const previousYearDate = new Date(new Date().getFullYear() - 1, 0, 1)
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'old-deployer',
      createdAt: previousYearDate,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'current-deployer',
    })

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual(['current-deployer'])
  })

  it('excludes deployments before the app audit_start_year', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'svc',
      environment: 'prod',
      auditStartYear: new Date().getFullYear(),
    })
    // Deploy before audit start year — should be excluded
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'old-deployer',
      createdAt: new Date(new Date().getFullYear() - 1, 6, 1),
    })
    // Deploy in audit year — should be included
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'current-deployer',
    })

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual(['current-deployer'])
  })

  it('includes all deployments when audit_start_year is null', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'svc',
      environment: 'prod',
      auditStartYear: null,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'deployer-a',
    })

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual(['deployer-a'])
  })

  it('handles mixed apps with different audit_start_year values', async () => {
    const currentYear = new Date().getFullYear()
    // App with audit start this year
    const appWithAudit = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'new-svc',
      environment: 'prod',
      auditStartYear: currentYear,
    })
    // App with no audit start year (all deployments count)
    const appNoAudit = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'old-svc',
      environment: 'prod',
      auditStartYear: null,
    })

    // Deploy before audit year on the app WITH audit_start_year — excluded
    await seedDeployment(pool, {
      monitoredAppId: appWithAudit,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'excluded-deployer',
      createdAt: new Date(currentYear - 1, 6, 1),
    })
    // Deploy on the app WITHOUT audit_start_year — included (since filter allows)
    await seedDeployment(pool, {
      monitoredAppId: appNoAudit,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'included-deployer',
    })

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual(['included-deployer'])
  })

  it('returns usernames sorted alphabetically', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'charlie',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'bob',
    })

    const result = await getUnmappedContributors(['team-a'])
    expect(result).toEqual(['alice', 'bob', 'charlie'])
  })
})
