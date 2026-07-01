import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { addExternalReference, deleteExternalReference } from '../../boards.server'
import {
  getAllSoftDeleted,
  restoreDeploymentComment,
  restoreDevTeamApplication,
  restoreDevTeamNaisTeam,
  restoreExternalReference,
  restoreGithubAccountLink,
  restoreSectionTeam,
} from '../../soft-deleted.server'
import {
  getGithubUserLookup,
  softDeleteGithubAccount,
  upsertUser,
  upsertUserAndGithubAccount,
} from '../../user-github-lookups.server'
import { seedApp, seedDeployment, seedDevTeam, seedSection, truncateAllTables } from './helpers'

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

async function seedBoardWithObjectiveAndKr(prefix = 'b') {
  const sectionId = await seedSection(pool, `${prefix}-sec`)
  const devTeamId = await seedDevTeam(pool, `${prefix}-team`, 'Team', sectionId)
  const { rows: boardRows } = await pool.query(
    `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label, created_by)
     VALUES ($1, 'Sprint', 'tertiary', '2026-01-01', '2026-04-30', 'T1 2026', 'alice') RETURNING id`,
    [devTeamId],
  )
  const boardId = boardRows[0].id as number
  const { rows: objRows } = await pool.query(
    "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING id",
    [boardId],
  )
  const objectiveId = objRows[0].id as number
  const { rows: krRows } = await pool.query(
    "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR', 0) RETURNING id",
    [objectiveId],
  )
  const keyResultId = krRows[0].id as number
  return { sectionId, devTeamId, boardId, objectiveId, keyResultId }
}

describe('soft-deleted: getAllSoftDeleted', () => {
  it('returns empty arrays when no rows are soft-deleted', async () => {
    const summary = await getAllSoftDeleted()
    expect(summary.githubAccounts).toEqual([])
    expect(summary.deploymentComments).toEqual([])
    expect(summary.devTeamApplications).toEqual([])
    expect(summary.sectionTeams).toEqual([])
    expect(summary.devTeamNaisTeams).toEqual([])
    expect(summary.externalReferences).toEqual([])
  })

  it('lists soft-deleted rows across all six tables with metadata', async () => {
    const sectionId = await seedSection(pool, 'sec')
    const devTeamId = await seedDevTeam(pool, 'team', 'Team', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'naisteam', appName: 'app', environment: 'dev' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'naisteam',
      environment: 'dev',
    })

    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord' })
    await upsertUserAndGithubAccount({
      githubUsername: 'gh-alice',
      navIdent: 'Z990001',
      displayName: 'Glad Fjord',
    })
    await softDeleteGithubAccount('gh-alice', 'Z990002')

    const { rows: commentRows } = await pool.query(
      `INSERT INTO deployment_comments (deployment_id, comment_type, comment_text, deleted_at, deleted_by)
       VALUES ($1, 'note', 'hello world', NOW(), 'Z990002') RETURNING id`,
      [deploymentId],
    )
    const commentId = commentRows[0].id as number

    await pool.query(
      `INSERT INTO dev_team_applications (dev_team_id, monitored_app_id, deleted_at, deleted_by)
       VALUES ($1, $2, NOW(), 'Z990002')`,
      [devTeamId, appId],
    )

    await pool.query(
      `INSERT INTO section_teams (section_id, team_slug, deleted_at, deleted_by)
       VALUES ($1, 'naisteam', NOW(), 'Z990002')`,
      [sectionId],
    )

    await pool.query(
      `INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug, deleted_at, deleted_by)
       VALUES ($1, 'naisteam', NOW(), 'Z990002')`,
      [devTeamId],
    )

    const { objectiveId } = await seedBoardWithObjectiveAndKr('xr')
    const ref = await addExternalReference({
      ref_type: 'jira',
      url: 'https://jira/1',
      title: 'JIRA-1',
      objective_id: objectiveId,
    })
    await deleteExternalReference(ref.id, 'Z990002')

    const summary = await getAllSoftDeleted()

    expect(summary.githubAccounts).toHaveLength(1)
    expect(summary.githubAccounts[0].github_username).toBe('gh-alice')
    expect(summary.githubAccounts[0].deleted_by).toBe('Z990002')

    expect(summary.deploymentComments).toHaveLength(1)
    expect(summary.deploymentComments[0].id).toBe(commentId)
    expect(summary.deploymentComments[0].app_name).toBe('app')

    expect(summary.devTeamApplications).toHaveLength(1)
    expect(summary.devTeamApplications[0].dev_team_name).toBe('Team')
    expect(summary.devTeamApplications[0].app_name).toBe('app')

    expect(summary.sectionTeams).toHaveLength(1)
    expect(summary.sectionTeams[0].team_slug).toBe('naisteam')

    expect(summary.devTeamNaisTeams).toHaveLength(1)
    expect(summary.devTeamNaisTeams[0].nais_team_slug).toBe('naisteam')

    expect(summary.externalReferences).toHaveLength(1)
    expect(summary.externalReferences[0].id).toBe(ref.id)
    expect(summary.externalReferences[0].parent_active).toBe(true)
    expect(summary.externalReferences[0].parent_label).toBe('Mål: Obj')
  })

  it('flags external references whose parent is deactivated', async () => {
    const { objectiveId } = await seedBoardWithObjectiveAndKr()
    const ref = await addExternalReference({
      ref_type: 'jira',
      url: 'https://jira/1',
      title: 'JIRA-1',
      objective_id: objectiveId,
    })
    await deleteExternalReference(ref.id, 'Z990002')
    await pool.query('UPDATE board_objectives SET is_active = false WHERE id = $1', [objectiveId])

    const summary = await getAllSoftDeleted()
    expect(summary.externalReferences).toHaveLength(1)
    expect(summary.externalReferences[0].parent_active).toBe(false)
  })
})

describe('soft-deleted: restore', () => {
  it('restores a soft-deleted GitHub account link', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord' })
    await upsertUserAndGithubAccount({
      githubUsername: 'gh-alice',
      navIdent: 'Z990001',
      displayName: 'Glad Fjord',
    })
    await softDeleteGithubAccount('gh-alice', 'Z990002')

    const deletedLookup = await getGithubUserLookup('gh-alice')
    expect(deletedLookup?.account_deleted_at).not.toBeNull()

    const restored = await restoreGithubAccountLink('gh-alice')
    expect(restored).toBe(true)

    const { rows } = await pool.query(
      'SELECT deleted_at, deleted_by FROM user_github_accounts WHERE github_username = $1',
      ['gh-alice'],
    )
    expect(rows[0].deleted_at).toBeNull()
    expect(rows[0].deleted_by).toBeNull()

    const reread = await getGithubUserLookup('gh-alice')
    expect(reread?.account_deleted_at).toBeNull()
  })

  it('restoreGithubAccountLink is a no-op for missing or already-active rows', async () => {
    expect(await restoreGithubAccountLink('does-not-exist')).toBe(false)

    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord' })
    await upsertUserAndGithubAccount({
      githubUsername: 'gh-alice',
      navIdent: 'Z990001',
      displayName: 'Glad Fjord',
    })
    expect(await restoreGithubAccountLink('gh-alice')).toBe(false)
  })

  it('restores a deployment comment', async () => {
    const sectionId = await seedSection(pool, 'sec')
    const _devTeamId = await seedDevTeam(pool, 'team', 'Team', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'naisteam', appName: 'app', environment: 'dev' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'naisteam',
      environment: 'dev',
    })
    const { rows } = await pool.query(
      `INSERT INTO deployment_comments (deployment_id, comment_type, comment_text, deleted_at, deleted_by)
       VALUES ($1, 'note', 'gone', NOW(), 'Z990002') RETURNING id`,
      [deploymentId],
    )
    const id = rows[0].id as number

    expect(await restoreDeploymentComment(id)).toBe(true)

    const { rows: after } = await pool.query('SELECT deleted_at, deleted_by FROM deployment_comments WHERE id = $1', [
      id,
    ])
    expect(after[0].deleted_at).toBeNull()
    expect(after[0].deleted_by).toBeNull()

    expect(await restoreDeploymentComment(id)).toBe(false)
    expect(await restoreDeploymentComment(999999)).toBe(false)
  })

  it('refuses to restore manual_approval and legacy_info comments', async () => {
    const sectionId = await seedSection(pool, 'sec2')
    const _devTeamId = await seedDevTeam(pool, 'team2', 'Team', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais2', appName: 'app2', environment: 'dev' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'nais2',
      environment: 'dev',
    })

    const { rows: ma } = await pool.query<{ id: number }>(
      `INSERT INTO deployment_comments (deployment_id, comment_type, comment_text, deleted_at, deleted_by)
       VALUES ($1, 'manual_approval', 'approved', NOW(), 'Z990002') RETURNING id`,
      [deploymentId],
    )
    const { rows: li } = await pool.query<{ id: number }>(
      `INSERT INTO deployment_comments (deployment_id, comment_type, comment_text, deleted_at, deleted_by)
       VALUES ($1, 'legacy_info', 'legacy', NOW(), 'Z990002') RETURNING id`,
      [deploymentId],
    )

    expect(await restoreDeploymentComment(ma[0].id)).toBe(false)
    expect(await restoreDeploymentComment(li[0].id)).toBe(false)

    const { rows: after } = await pool.query('SELECT id, deleted_at FROM deployment_comments WHERE id = ANY($1)', [
      [ma[0].id, li[0].id],
    ])
    expect(after).toHaveLength(2)
    for (const row of after) expect(row.deleted_at).not.toBeNull()

    const summary = await getAllSoftDeleted()
    const listedIds = summary.deploymentComments.map((c) => c.id)
    expect(listedIds).not.toContain(ma[0].id)
    expect(listedIds).not.toContain(li[0].id)
  })

  it('restores a dev_team_applications link', async () => {
    const sectionId = await seedSection(pool, 'sec')
    const devTeamId = await seedDevTeam(pool, 'team', 'Team', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'naisteam', appName: 'app', environment: 'dev' })
    await pool.query(
      `INSERT INTO dev_team_applications (dev_team_id, monitored_app_id, deleted_at, deleted_by)
       VALUES ($1, $2, NOW(), 'Z990002')`,
      [devTeamId, appId],
    )

    expect(await restoreDevTeamApplication(devTeamId, appId)).toBe(true)
    const { rows } = await pool.query(
      'SELECT deleted_at FROM dev_team_applications WHERE dev_team_id = $1 AND monitored_app_id = $2',
      [devTeamId, appId],
    )
    expect(rows[0].deleted_at).toBeNull()

    expect(await restoreDevTeamApplication(devTeamId, appId)).toBe(false)
  })

  it('restores a section_teams link', async () => {
    const sectionId = await seedSection(pool, 'sec')
    await pool.query(
      `INSERT INTO section_teams (section_id, team_slug, deleted_at, deleted_by)
       VALUES ($1, 'naisteam', NOW(), 'Z990002')`,
      [sectionId],
    )

    expect(await restoreSectionTeam(sectionId, 'naisteam')).toBe(true)
    const { rows } = await pool.query('SELECT deleted_at FROM section_teams WHERE section_id = $1 AND team_slug = $2', [
      sectionId,
      'naisteam',
    ])
    expect(rows[0].deleted_at).toBeNull()
    expect(await restoreSectionTeam(sectionId, 'naisteam')).toBe(false)
  })

  it('restores a dev_team_nais_teams link', async () => {
    const sectionId = await seedSection(pool, 'sec')
    const devTeamId = await seedDevTeam(pool, 'team', 'Team', sectionId)
    await pool.query(
      `INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug, deleted_at, deleted_by)
       VALUES ($1, 'naisteam', NOW(), 'Z990002')`,
      [devTeamId],
    )

    expect(await restoreDevTeamNaisTeam(devTeamId, 'naisteam')).toBe(true)
    const { rows } = await pool.query(
      'SELECT deleted_at FROM dev_team_nais_teams WHERE dev_team_id = $1 AND nais_team_slug = $2',
      [devTeamId, 'naisteam'],
    )
    expect(rows[0].deleted_at).toBeNull()
    expect(await restoreDevTeamNaisTeam(devTeamId, 'naisteam')).toBe(false)
  })

  it('restores an external reference', async () => {
    const { objectiveId } = await seedBoardWithObjectiveAndKr()
    const ref = await addExternalReference({
      ref_type: 'jira',
      url: 'https://jira/1',
      title: 'JIRA-1',
      objective_id: objectiveId,
    })
    await deleteExternalReference(ref.id, 'Z990002')

    expect(await restoreExternalReference(ref.id)).toBe(true)
    const { rows } = await pool.query('SELECT deleted_at FROM external_references WHERE id = $1', [ref.id])
    expect(rows[0].deleted_at).toBeNull()
    expect(await restoreExternalReference(ref.id)).toBe(false)
    expect(await restoreExternalReference(999999)).toBe(false)
  })

  it('refuses to restore an external reference under a deactivated objective', async () => {
    const { objectiveId } = await seedBoardWithObjectiveAndKr()
    const ref = await addExternalReference({
      ref_type: 'jira',
      url: 'https://jira/1',
      title: 'JIRA-1',
      objective_id: objectiveId,
    })
    await deleteExternalReference(ref.id, 'Z990002')
    await pool.query('UPDATE board_objectives SET is_active = false WHERE id = $1', [objectiveId])

    await expect(restoreExternalReference(ref.id)).rejects.toThrow(/deaktivert/)

    const { rows } = await pool.query('SELECT deleted_at FROM external_references WHERE id = $1', [ref.id])
    expect(rows[0].deleted_at).not.toBeNull()
  })

  it('refuses to restore a key-result reference whose parent objective is deactivated', async () => {
    const { objectiveId, keyResultId } = await seedBoardWithObjectiveAndKr()
    const ref = await addExternalReference({
      ref_type: 'github_issue',
      url: 'https://gh/1',
      title: 'GH-1',
      key_result_id: keyResultId,
    })
    await deleteExternalReference(ref.id, 'Z990002')
    await pool.query('UPDATE board_objectives SET is_active = false WHERE id = $1', [objectiveId])

    await expect(restoreExternalReference(ref.id)).rejects.toThrow(/deaktivert/)
  })

  it('does not leak a transaction when external reference is already active or missing', async () => {
    const { objectiveId } = await seedBoardWithObjectiveAndKr('leak')
    const ref = await addExternalReference({
      ref_type: 'jira',
      url: 'https://jira/leak',
      title: 'JIRA-leak',
      objective_id: objectiveId,
    })

    for (let i = 0; i < 5; i++) {
      expect(await restoreExternalReference(ref.id)).toBe(false)
    }
    for (let i = 0; i < 5; i++) {
      expect(await restoreExternalReference(999_000 + i)).toBe(false)
    }

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_stat_activity
       WHERE state = 'idle in transaction' AND datname = current_database()`,
    )
    expect(parseInt(rows[0].count, 10)).toBe(0)
  })
})
