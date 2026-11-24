import { useLoaderData } from 'react-router'
import { TeamBoardsPage } from '~/components/TeamBoardsPage'
import { getBoardsByDevTeam } from '~/db/boards.server'
import { getDevTeamBySlug } from '~/db/dev-teams.server'
import { getSectionBySlug } from '~/db/sections.server'
import { requireUser } from '~/lib/auth.server'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug.boards'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `Alle tavler – ${data?.devTeam?.name ?? 'Utviklingsteam'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) throw new Response('Utviklingsteam ikke funnet', { status: 404 })

  const boards = await getBoardsByDevTeam(devTeam.id)

  const section = await getSectionBySlug(params.sectionSlug)

  return {
    devTeam,
    boards,
    sectionSlug: params.sectionSlug,
    sectionName: section?.name ?? params.sectionSlug,
  }
}

export default function TeamBoards() {
  const { devTeam, boards, sectionSlug } = useLoaderData<typeof loader>()
  return <TeamBoardsPage devTeam={devTeam} boards={boards} sectionSlug={sectionSlug} />
}
