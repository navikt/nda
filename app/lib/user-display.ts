import { getBotDisplayName } from './github-bots'

export type UserRecord = {
  display_name: string | null
  nav_ident?: string | null
  nav_email?: string | null
}

export type UserLookupMap = Record<string, UserRecord>

export function getUserDisplayName(
  githubUsername: string | undefined | null,
  userMappings: UserLookupMap,
): string | null {
  if (!githubUsername) return null

  const botName = getBotDisplayName(githubUsername)
  if (botName) return botName

  const mapping = userMappings[githubUsername]
  return mapping?.display_name || mapping?.nav_email || githubUsername
}

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

export function formatDisplayNameNatural(displayName: string | null): string {
  if (!displayName) return ''
  if (!displayName.includes(',')) return displayName
  const [last, ...rest] = displayName.split(',')
  return `${rest.join(',').trim()} ${last.trim()}`
}
