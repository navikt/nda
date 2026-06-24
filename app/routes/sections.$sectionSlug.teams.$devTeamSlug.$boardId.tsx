import { useActionData, useLoaderData } from 'react-router'
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
  externalReferenceBelongsToBoard,
  getBoardDevTeamId,
  getBoardWithObjectives,
  keyResultBelongsToBoard,
  objectiveBelongsToBoard,
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
import { getSectionBySlug } from '~/db/sections.server'
import { requireUser } from '~/lib/auth.server'
import { formatBoardLabel } from '~/lib/board-periods'
import { isSafeHttpUrl, parseId } from '~/lib/route-helpers'
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

  const [section, { objectives: objectiveProgress }] = await Promise.all([
    getSectionBySlug(params.sectionSlug),
    getBoardObjectiveProgress(board.id),
  ])

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
        const id = parseId(formData.get('id'))
        if (id === null) return { error: 'Ugyldig mål-ID.', intent: 'update-objective', id: null }
        if (!(await objectiveBelongsToBoard(id, boardId)))
          return { error: 'Målet tilhører ikke denne tavlen.', intent: 'update-objective', id }
        const title = (formData.get('title') as string)?.trim()
        if (!title) return { error: 'Tittel er påkrevd.', intent: 'update-objective', id }
        await updateObjective(id, { title, description: (formData.get('description') as string)?.trim() })
        return { success: true, intent: 'update-objective', id, resultToken: Date.now() }
      }
      case 'deactivate-objective': {
        const id = parseId(formData.get('id'))
        if (id === null) return { error: 'Ugyldig mål-ID.' }
        if (!(await objectiveBelongsToBoard(id, boardId))) return { error: 'Målet tilhører ikke denne tavlen.' }
        await deactivateObjective(id)
        return { success: true }
      }
      case 'reactivate-objective': {
        const id = parseId(formData.get('id'))
        if (id === null) return { error: 'Ugyldig mål-ID.' }
        if (!(await objectiveBelongsToBoard(id, boardId))) return { error: 'Målet tilhører ikke denne tavlen.' }
        await reactivateObjective(id)
        return { success: true }
      }
      case 'add-key-result': {
        const objectiveId = parseId(formData.get('objective_id'))
        if (objectiveId === null) return { error: 'Ugyldig mål-ID.' }
        if (!(await objectiveBelongsToBoard(objectiveId, boardId)))
          return { error: 'Målet tilhører ikke denne tavlen.' }
        const title = (formData.get('title') as string)?.trim()
        if (!title) return { error: 'Tittel er påkrevd.' }
        await createKeyResult(objectiveId, title, (formData.get('description') as string)?.trim())
        return { success: true }
      }
      case 'update-key-result': {
        const id = parseId(formData.get('id'))
        if (id === null) return { error: 'Ugyldig nøkkelresultat-ID.', intent: 'update-key-result', id: null }
        if (!(await keyResultBelongsToBoard(id, boardId)))
          return { error: 'Nøkkelresultatet tilhører ikke denne tavlen.', intent: 'update-key-result', id }
        const title = (formData.get('title') as string)?.trim()
        if (!title) return { error: 'Tittel er påkrevd.', intent: 'update-key-result', id }
        await updateKeyResult(id, { title, description: (formData.get('description') as string)?.trim() })
        return { success: true, intent: 'update-key-result', id, resultToken: Date.now() }
      }
      case 'deactivate-key-result': {
        const id = parseId(formData.get('id'))
        if (id === null) return { error: 'Ugyldig nøkkelresultat-ID.' }
        if (!(await keyResultBelongsToBoard(id, boardId)))
          return { error: 'Nøkkelresultatet tilhører ikke denne tavlen.' }
        await deactivateKeyResult(id)
        return { success: true }
      }
      case 'reactivate-key-result': {
        const id = parseId(formData.get('id'))
        if (id === null) return { error: 'Ugyldig nøkkelresultat-ID.' }
        if (!(await keyResultBelongsToBoard(id, boardId)))
          return { error: 'Nøkkelresultatet tilhører ikke denne tavlen.' }
        await reactivateKeyResult(id)
        return { success: true }
      }
      case 'add-reference': {
        const refType = formData.get('ref_type') as ExternalReference['ref_type']
        const url = (formData.get('url') as string)?.trim()
        const title = (formData.get('ref_title') as string)?.trim()
        const rawObjectiveId = formData.get('objective_id')
        const rawKeyResultId = formData.get('key_result_id')
        const objectiveId = parseId(rawObjectiveId)
        const keyResultId = parseId(rawKeyResultId)
        if (!url) return { error: 'URL er påkrevd.' }
        if (!isSafeHttpUrl(url)) return { error: 'URL må starte med http:// eller https://.' }
        if (rawObjectiveId !== null && objectiveId === null) return { error: 'Ugyldig mål-ID.' }
        if (rawKeyResultId !== null && keyResultId === null) return { error: 'Ugyldig nøkkelresultat-ID.' }
        if (objectiveId !== null && !(await objectiveBelongsToBoard(objectiveId, boardId))) {
          return { error: 'Målet tilhører ikke denne tavlen.' }
        }
        if (keyResultId !== null && !(await keyResultBelongsToBoard(keyResultId, boardId))) {
          return { error: 'Nøkkelresultatet tilhører ikke denne tavlen.' }
        }
        await addExternalReference({
          ref_type: refType,
          url,
          title,
          objective_id: objectiveId ?? undefined,
          key_result_id: keyResultId ?? undefined,
        })
        return { success: true }
      }
      case 'delete-reference': {
        const id = parseId(formData.get('id'))
        if (id === null) return { error: 'Ugyldig referanse-ID.' }
        if (!(await externalReferenceBelongsToBoard(id, boardId)))
          return { error: 'Referansen tilhører ikke denne tavlen.' }
        await deleteExternalReference(id, user.navIdent)
        return { success: true }
      }
      case 'update-objective-keywords': {
        const id = parseId(formData.get('id'))
        if (id === null) return { error: 'Ugyldig mål-ID.' }
        if (!(await objectiveBelongsToBoard(id, boardId))) return { error: 'Målet tilhører ikke denne tavlen.' }
        const raw = (formData.get('keywords') as string) ?? ''
        const keywords = raw
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
        await updateObjectiveKeywords(id, keywords)
        return { success: true }
      }
      case 'update-kr-keywords': {
        const id = parseId(formData.get('id'))
        if (id === null) return { error: 'Ugyldig nøkkelresultat-ID.' }
        if (!(await keyResultBelongsToBoard(id, boardId)))
          return { error: 'Nøkkelresultatet tilhører ikke denne tavlen.' }
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
        const rawObjectiveId = formData.get('objective_id')
        const rawKeyResultId = formData.get('key_result_id')
        const objectiveId = parseId(rawObjectiveId)
        const keyResultId = parseId(rawKeyResultId)
        if (rawObjectiveId !== null && objectiveId === null) return { error: 'Ugyldig mål-ID.' }
        if (rawKeyResultId !== null && keyResultId === null) return { error: 'Ugyldig nøkkelresultat-ID.' }
        await setDependabotTarget(boardId, objectiveId ?? undefined, keyResultId ?? undefined)
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
    const context = `boardId=${boardId} intent=${intent}`
    if (error instanceof Error) {
      console.error(`Board action failed ${context}`, error)
    } else {
      console.error(`Board action failed ${context}: ${String(error)}`)
    }
    return { error: 'Kunne ikke utføre handlingen. Prøv igjen.' }
  }
}

export default function BoardDetail() {
  const actionData = useActionData<typeof action>()
  const { devTeam, board, objectiveProgress, sectionSlug } = useLoaderData<typeof loader>()
  const deploymentsPath = `/sections/${sectionSlug}/teams/${devTeam.slug}/deployments`
  return (
    <BoardDetailPage
      devTeam={devTeam}
      board={board}
      objectiveProgress={objectiveProgress}
      deploymentsPath={deploymentsPath}
      actionResult={actionData}
    />
  )
}
