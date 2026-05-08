import { useLoaderData } from 'react-router'
import { BoardDetailPage } from '~/components/BoardDetailPage'
import {
  addExternalReference,
  clearDependabotTarget,
  createKeyResult,
  createObjective,
  deactivateKeyResult,
  deactivateObjective,
  deleteExternalReference,
  type ExternalReference,
  getBoardDevTeamId,
  getBoardWithObjectives,
  reactivateKeyResult,
  reactivateObjective,
  setDependabotTarget,
  updateBoardDates,
  updateKeyResult,
  updateKeyResultKeywords,
  updateObjective,
  updateObjectiveKeywords,
} from '~/db/boards.server'
import { getBoardObjectiveProgress } from '~/db/dashboard-stats.server'
import { getDevTeamBySlug } from '~/db/dev-teams.server'
import { getMembersGithubUsernamesForDevTeamRoles } from '~/db/role-assignments.server'
import { getSectionBySlug } from '~/db/sections.server'
import { requireUser } from '~/lib/auth.server'
import { formatBoardLabel } from '~/lib/board-periods'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug.$boardId'

export function meta({ data }: Route.MetaArgs) {
  const label =
    data?.devTeam && data?.board
      ? formatBoardLabel({ teamName: data.devTeam.name, periodLabel: data.board.period_label })
      : 'Tavle'
  return [{ title: label }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) throw new Response('Utviklingsteam ikke funnet', { status: 404 })

  const board = await getBoardWithObjectives(Number(params.boardId))
  if (!board || board.dev_team_id !== devTeam.id) throw new Response('Tavle ikke funnet', { status: 404 })

  const [section, deployerUsernames] = await Promise.all([
    getSectionBySlug(params.sectionSlug),
    getMembersGithubUsernamesForDevTeamRoles([devTeam.id]).catch(() => [] as string[]),
  ])
  const { objectives: objectiveProgress } = await getBoardObjectiveProgress(board.id, deployerUsernames)

  return {
    devTeam,
    board,
    objectiveProgress,
    sectionSlug: params.sectionSlug,
    sectionName: section?.name ?? params.sectionSlug,
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) throw new Response('Utviklingsteam ikke funnet', { status: 404 })

  const boardId = Number(params.boardId)
  if (!Number.isFinite(boardId)) throw new Response('Ugyldig tavle-ID', { status: 400 })

  // Verify that the board belongs to this dev team (lightweight query)
  const boardDevTeamId = await getBoardDevTeamId(boardId)
  if (boardDevTeamId == null || boardDevTeamId !== devTeam.id) throw new Response('Tavle ikke funnet', { status: 404 })

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  try {
    switch (intent) {
      case 'add-objective': {
        const title = (formData.get('title') as string)?.trim()
        if (!title) return { error: 'Tittel er påkrevd.' }
        await createObjective(boardId, title, (formData.get('description') as string)?.trim())
        return { success: true }
      }
      case 'update-objective': {
        const id = Number(formData.get('id'))
        const title = (formData.get('title') as string)?.trim()
        if (!title) return { error: 'Tittel er påkrevd.' }
        await updateObjective(id, { title, description: (formData.get('description') as string)?.trim() })
        return { success: true }
      }
      case 'deactivate-objective': {
        await deactivateObjective(Number(formData.get('id')))
        return { success: true }
      }
      case 'reactivate-objective': {
        await reactivateObjective(Number(formData.get('id')))
        return { success: true }
      }
      case 'add-key-result': {
        const objectiveId = Number(formData.get('objective_id'))
        const title = (formData.get('title') as string)?.trim()
        if (!title) return { error: 'Tittel er påkrevd.' }
        await createKeyResult(objectiveId, title, (formData.get('description') as string)?.trim())
        return { success: true }
      }
      case 'update-key-result': {
        const id = Number(formData.get('id'))
        const title = (formData.get('title') as string)?.trim()
        if (!title) return { error: 'Tittel er påkrevd.' }
        await updateKeyResult(id, { title, description: (formData.get('description') as string)?.trim() })
        return { success: true }
      }
      case 'deactivate-key-result': {
        await deactivateKeyResult(Number(formData.get('id')))
        return { success: true }
      }
      case 'reactivate-key-result': {
        await reactivateKeyResult(Number(formData.get('id')))
        return { success: true }
      }
      case 'add-reference': {
        const refType = formData.get('ref_type') as ExternalReference['ref_type']
        const url = (formData.get('url') as string)?.trim()
        const title = (formData.get('ref_title') as string)?.trim()
        const objectiveId = formData.get('objective_id') ? Number(formData.get('objective_id')) : undefined
        const keyResultId = formData.get('key_result_id') ? Number(formData.get('key_result_id')) : undefined
        if (!url) return { error: 'URL er påkrevd.' }
        await addExternalReference({
          ref_type: refType,
          url,
          title,
          objective_id: objectiveId,
          key_result_id: keyResultId,
        })
        return { success: true }
      }
      case 'delete-reference': {
        await deleteExternalReference(Number(formData.get('id')), user.navIdent)
        return { success: true }
      }
      case 'update-objective-keywords': {
        const id = Number(formData.get('id'))
        const raw = (formData.get('keywords') as string) ?? ''
        const keywords = raw
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
        await updateObjectiveKeywords(id, keywords)
        return { success: true }
      }
      case 'update-kr-keywords': {
        const id = Number(formData.get('id'))
        const raw = (formData.get('keywords') as string) ?? ''
        const keywords = raw
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
        await updateKeyResultKeywords(id, keywords)
        return { success: true }
      }
      case 'update-dates': {
        const periodStart = (formData.get('period_start') as string)?.trim()
        const periodEnd = (formData.get('period_end') as string)?.trim()
        if (!periodStart || !periodEnd) return { error: 'Begge datoer er påkrevd.' }
        if (periodStart > periodEnd) return { error: 'Startdato kan ikke være etter sluttdato.' }
        await updateBoardDates(boardId, periodStart, periodEnd)
        return { success: true }
      }
      case 'set-dependabot-target': {
        const objectiveId = formData.get('objective_id') ? Number(formData.get('objective_id')) : undefined
        const keyResultId = formData.get('key_result_id') ? Number(formData.get('key_result_id')) : undefined
        await setDependabotTarget(boardId, objectiveId, keyResultId)
        return { success: true }
      }
      case 'clear-dependabot-target': {
        await clearDependabotTarget(boardId)
        return { success: true }
      }
      default:
        return { error: 'Ukjent handling.' }
    }
  } catch (error) {
    return { error: `Feil: ${error}` }
  }
}

export default function BoardDetail() {
  const { devTeam, board, objectiveProgress } = useLoaderData<typeof loader>()
  return <BoardDetailPage devTeam={devTeam} board={board} objectiveProgress={objectiveProgress} />
}
