import { logger } from '~/lib/logger.server'
import { getGraphUsersByNavIdenter, searchGraphUsers } from '~/lib/microsoft-graph.server'
import { getNomUsersByNavIdenter, searchNomUsers } from '~/lib/nom.server'
import { formatDisplayNameNatural } from '~/lib/user-display'
import type { UserLookupResult } from '~/lib/user-lookup-types'

export type UserLookupProviderName = 'nom' | 'entra_id'

export interface UserLookupProvider {
  getUsersByNavIdenter(navIdenter: string[]): Promise<UserLookupResult[]>
  searchUsers(query: string): Promise<UserLookupResult[]>
}

const providers: Record<UserLookupProviderName, UserLookupProvider> = {
  nom: { getUsersByNavIdenter: getNomUsersByNavIdenter, searchUsers: searchNomUsers },
  entra_id: { getUsersByNavIdenter: getGraphUsersByNavIdenter, searchUsers: searchGraphUsers },
}

const DEFAULT_PROVIDER: UserLookupProviderName = 'nom'

export function getUserLookupProviderName(): UserLookupProviderName {
  const raw = process.env.USER_LOOKUP_PROVIDER?.trim().toLowerCase()
  if (!raw) return DEFAULT_PROVIDER
  if (raw === 'nom' || raw === 'entra_id') return raw

  logger.warn('Unknown USER_LOOKUP_PROVIDER value, falling back to default', {
    value: raw,
    default: DEFAULT_PROVIDER,
  })
  return DEFAULT_PROVIDER
}

export function getUserLookupProvider(): UserLookupProvider {
  return providers[getUserLookupProviderName()]
}

export async function getUsersByNavIdenter(navIdenter: string[]): Promise<UserLookupResult[]> {
  return getUserLookupProvider().getUsersByNavIdenter(navIdenter)
}

export async function searchUsers(query: string): Promise<UserLookupResult[]> {
  return getUserLookupProvider().searchUsers(query)
}

export type UserLookupResolution =
  | { ok: true; navIdent: string; displayName: string; email: string | null }
  | { ok: false; error: string }

export interface UserLookupErrorMessages {
  unavailable: string
  notFound: string
  missingDisplayName: string
}

export async function resolveUserByNavIdent(
  navIdent: string,
  logContext: string,
  messages: UserLookupErrorMessages,
): Promise<UserLookupResolution> {
  const normalizedNavIdent = navIdent.trim().toUpperCase()

  let results: UserLookupResult[]
  try {
    results = await getUsersByNavIdenter([normalizedNavIdent])
  } catch (error) {
    logger.error(`User lookup failed during ${logContext}`, error)
    return { ok: false, error: messages.unavailable }
  }

  const user = results.find((u) => u.navIdent?.toUpperCase() === normalizedNavIdent)
  if (!user) {
    return { ok: false, error: messages.notFound }
  }

  const displayName = user.displayName ? formatDisplayNameNatural(user.displayName) : null
  if (!displayName) {
    return { ok: false, error: messages.missingDisplayName }
  }

  return { ok: true, navIdent: normalizedNavIdent, displayName, email: user.email }
}
