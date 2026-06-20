import { Link } from 'react-router'
import { getUserDisplayName, type UserLookupMap } from '~/lib/user-display'
import { ExternalLink } from './ExternalLink'

interface UserNameProps {
  username: string | null | undefined
  userMappings: UserLookupMap
  link?: 'internal' | 'github' | false
}

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
