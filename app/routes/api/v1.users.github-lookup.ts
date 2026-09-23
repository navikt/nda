import { getGithubUserLookups } from '~/db/user-github-lookups.server'
import { jsonError } from '~/lib/api/errors'
import type { GithubUserLookupResponse, GithubUserLookupResult } from '~/lib/api/types'
import { getBotDisplayName } from '~/lib/github-bots'
import { requireM2MToken } from '~/lib/m2m-auth.server'
import type { Route } from './+types/v1.users.github-lookup'

const MAX_USERNAMES_PER_REQUEST = 500

export async function action({ request }: Route.ActionArgs) {
  await requireM2MToken(request)

  let body: { githubUsernames?: unknown }
  try {
    body = await request.json()
  } catch {
    throw jsonError('Invalid JSON in request body', 400)
  }

  const { githubUsernames } = body
  if (!Array.isArray(githubUsernames) || githubUsernames.some((u) => typeof u !== 'string')) {
    throw jsonError('githubUsernames must be an array of strings', 400)
  }

  const usernames = (githubUsernames as string[]).map((u) => u.trim()).filter((u) => u.length > 0)
  if (usernames.length === 0) {
    throw jsonError('githubUsernames must contain at least one username', 400)
  }
  if (usernames.length > MAX_USERNAMES_PER_REQUEST) {
    throw jsonError(`githubUsernames must not contain more than ${MAX_USERNAMES_PER_REQUEST} usernames`, 400)
  }

  const lookups = await getGithubUserLookups(usernames)

  const users: GithubUserLookupResult[] = usernames.map((githubUsername) => {
    const botDisplayName = getBotDisplayName(githubUsername)
    if (botDisplayName) {
      return { githubUsername, displayName: botDisplayName, navIdent: null, found: true }
    }

    const lookup = lookups.get(githubUsername)
    if (!lookup || lookup.account_deleted_at) {
      return { githubUsername, displayName: null, navIdent: null, found: false }
    }

    return {
      githubUsername,
      displayName: lookup.display_name,
      navIdent: lookup.nav_ident,
      found: true,
    }
  })

  const response: GithubUserLookupResponse = { users }
  return Response.json(response)
}
