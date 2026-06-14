import { Link } from 'react-router'
import { getUserDisplayName, type UserLookupMap } from '~/lib/user-display'
import { ExternalLink } from './ExternalLink'

interface UserNameProps {
  /** GitHub username to resolve */
  username: string | null | undefined
  /** User mappings from loader (serialized via serializeUserLookups) */
  userMappings: UserLookupMap
  /** Link behavior: 'internal' links to /users/:username, 'github' to github.com, false disables link */
  link?: 'internal' | 'github' | false
}

/**
 * Renders a resolved display name for a GitHub username.
 * Falls back to GitHub username if no mapping exists, or "(ukjent)" if username is null.
 */
export function UserName({ username, userMappings, link = 'internal' }: UserNameProps) {
  if (!username) return <>(ukjent)</>

  const displayName = getUserDisplayName(username, userMappings) ?? username

  if (link === 'internal') {
    return <Link to={`/users/${username}`}>{displayName}</Link>
  }

  if (link === 'github') {
    return <ExternalLink href={`https://github.com/${username}`}>{displayName}</ExternalLink>
  }

  return <>{displayName}</>
}
