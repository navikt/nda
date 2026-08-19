import { requireUser } from '~/lib/auth.server'
import { canSearchUsers } from '~/lib/authorization.server'
import { isValidNavIdent } from '~/lib/form-validators'
import { logger } from '~/lib/logger.server'
import { searchGraphUsers } from '~/lib/microsoft-graph.server'
import { isSlackConfigured, lookupSlackUserIdByEmail } from '~/lib/slack/client.server'
import type { Route } from './+types/users.slack-lookup'

export async function loader({ request, url }: Route.LoaderArgs) {
  const identity = await requireUser(request)
  const navIdent = (url.searchParams.get('nav_ident') || '').toUpperCase()

  if (!isValidNavIdent(navIdent)) {
    return Response.json({ slackMemberId: null, navIdent }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const isSelf = navIdent === identity.navIdent.toUpperCase()
  if (!isSelf && !(await canSearchUsers(identity))) {
    return Response.json(
      { slackMemberId: null, navIdent, error: 'Ingen tilgang' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (!isSlackConfigured()) {
    return Response.json({ slackMemberId: null, navIdent }, { headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const graphResults = await searchGraphUsers(navIdent)
    const graphUser = graphResults.find((u) => u.navIdent?.toUpperCase() === navIdent)

    if (!graphUser?.email) {
      return Response.json({ slackMemberId: null, navIdent }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const slackMemberId = await lookupSlackUserIdByEmail(graphUser.email)
    return Response.json({ slackMemberId, navIdent }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logger.error('Slack member ID lookup failed:', error)
    return Response.json({ slackMemberId: null, navIdent }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
