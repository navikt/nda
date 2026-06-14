/**
 * User display utilities for consistent GitHub-username-to-user-identity lookup data
 */

import { getBotDisplayName } from './github-bots'

export type UserRecord = {
  display_name: string | null
  nav_ident?: string | null
  nav_email?: string | null
}

export type UserLookupMap = Record<string, UserRecord>

/**
 * Get display name for a GitHub username, falling back to the username if no mapping exists.
 * Also handles GitHub bot accounts.
 *
 * @param githubUsername - The GitHub username to look up
 * @param userMappings - Lookup record keyed by GitHub username
 * @returns Display name, bot name, nav_email, or the original username as fallback
 */
export function getUserDisplayName(
  githubUsername: string | undefined | null,
  userMappings: UserLookupMap,
): string | null {
  if (!githubUsername) return null

  // Check if it's a bot first
  const botName = getBotDisplayName(githubUsername)
  if (botName) return botName

  const mapping = userMappings[githubUsername]
  return mapping?.display_name || mapping?.nav_email || githubUsername
}

/**
 * Serialize a Map of user lookup data to a plain object for client-side use.
 *
 * @param mappings - Map keyed by GitHub username with user identity data
 * @returns Plain object suitable for JSON serialization
 */
export function serializeUserLookups(
  mappings: Map<string, { display_name: string | null; nav_ident: string | null; nav_email?: string | null }>,
): UserLookupMap {
  const result: UserLookupMap = {}
  for (const [username, mapping] of mappings) {
    result[username] = {
      display_name: mapping.display_name,
      nav_ident: mapping.nav_ident,
      nav_email: mapping.nav_email,
    }
  }
  return result
}

/** Convert "Lastname, Firstname" to "Firstname Lastname" */
export function formatDisplayNameNatural(displayName: string | null): string {
  if (!displayName) return ''
  if (!displayName.includes(',')) return displayName
  const [last, ...rest] = displayName.split(',')
  return `${rest.join(',').trim()} ${last.trim()}`
}
