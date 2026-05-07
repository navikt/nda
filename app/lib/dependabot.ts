/**
 * Check if a username belongs to a Dependabot bot.
 * Matches both the exact `dependabot[bot]` and any username containing `dependabot`.
 */
export function isDependabotUser(username: string | null | undefined): boolean {
  if (!username) return false
  const lower = username.toLowerCase()
  return lower === 'dependabot[bot]' || lower.includes('dependabot')
}
