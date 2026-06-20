import { Detail, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { SECTION_ROLE_LABELS, TEAM_ROLE_LABELS } from '~/lib/authorization-types'

interface UserRoleDisplayData {
  sectionRoles: Array<{ role: string; sectionName: string; sectionSlug: string }>
  teamRoles: Array<{ role: string; teamName: string; teamSlug: string; sectionSlug: string | null }>
}

export function UserRolesDisplay({ userRoles }: { userRoles: UserRoleDisplayData }) {
  if (userRoles.sectionRoles.length === 0 && userRoles.teamRoles.length === 0) {
    return null
  }

  return (
    <VStack gap="space-8">
      <Detail textColor="subtle">Roller</Detail>
      <HStack gap="space-8" wrap>
        {userRoles.sectionRoles.map((r) => (
          <Tag key={`s-${r.sectionSlug}-${r.role}`} variant="warning" size="small">
            {SECTION_ROLE_LABELS[r.role] ?? r.role}
            {' – '}
            {r.sectionName}
          </Tag>
        ))}
        {userRoles.teamRoles.map((r) => (
          <Tag key={`t-${r.teamSlug}-${r.role}`} variant="info" size="small">
            {r.sectionSlug ? (
              <Link
                to={`/sections/${r.sectionSlug}/teams/${r.teamSlug}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                {TEAM_ROLE_LABELS[r.role] ?? r.role}
                {' – '}
                {r.teamName}
              </Link>
            ) : (
              <>
                {TEAM_ROLE_LABELS[r.role] ?? r.role}
                {' – '}
                {r.teamName}
              </>
            )}
          </Tag>
        ))}
      </HStack>
    </VStack>
  )
}
