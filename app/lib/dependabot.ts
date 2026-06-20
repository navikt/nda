export function isDependabotUser(username: string | null | undefined): boolean {
  if (!username) return false
  const lower = username.toLowerCase()
  return lower === 'dependabot[bot]' || lower.includes('dependabot')
}
