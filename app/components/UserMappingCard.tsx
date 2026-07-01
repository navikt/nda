import { PencilIcon, TrashIcon } from '@navikt/aksel-icons'
import { Box, Button, Detail, Heading, HStack, Show, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import { isTeamLeaderRole, SECTION_ROLE_LABELS, TEAM_ROLE_LABELS } from '~/lib/authorization-types'
import styles from '~/styles/common.module.css'

interface RoleAssignment {
  dev_team_id: number
  role: string
}

interface SectionRoleAssignment {
  section_id: number
  section_name: string
  role: string
}

interface DevTeam {
  id: number
  name: string
}

interface UserMappingCardProps {
  mapping: {
    github_username: string
    display_github_username: string | null
    display_name: string | null
    nav_ident: string | null
    slack_member_id: string | null
  }
  teamRoles?: RoleAssignment[]
  sectionRoles?: SectionRoleAssignment[]
  devTeamById?: Map<number, DevTeam>
  onEdit?: () => void
  onDelete?: () => void
}

export function UserMappingCard({
  mapping,
  teamRoles = [],
  sectionRoles = [],
  devTeamById = new Map(),
  onEdit,
  onDelete,
}: UserMappingCardProps) {
  return (
    <Box padding="space-16" background="raised" className={styles.stackedListItem}>
      <VStack gap="space-12">
        {/* First row: Display name heading, actions */}
        <HStack gap="space-8" align="center" justify="space-between" wrap>
          <Link to={`/users/${mapping.github_username}`} style={{ textDecoration: 'none' }}>
            <Heading level="3" size="xsmall">
              {mapping.display_name || mapping.display_github_username || mapping.github_username}
            </Heading>
          </Link>
          <HStack gap="space-8">
            {onEdit && (
              <Button
                variant="tertiary"
                size="small"
                icon={<PencilIcon aria-hidden />}
                onClick={onEdit}
                aria-label="Rediger"
              >
                <Show above="sm">Rediger</Show>
              </Button>
            )}
            {onDelete && (
              <Button
                variant="tertiary-neutral"
                size="small"
                icon={<TrashIcon aria-hidden />}
                onClick={onDelete}
                aria-label="Slett"
              >
                <Show above="sm">Slett</Show>
              </Button>
            )}
          </HStack>
        </HStack>

        {/* Details row */}
        <HStack gap="space-16" wrap>
          <ExternalLink href={`https://github.com/${mapping.display_github_username || mapping.github_username}`}>
            <Detail textColor="subtle">GitHub: {mapping.display_github_username || mapping.github_username}</Detail>
          </ExternalLink>
          {mapping.nav_ident && (
            <ExternalLink href={`https://teamkatalogen.nav.no/resource/${mapping.nav_ident}`}>
              <Detail textColor="subtle">Teamkatalogen: {mapping.nav_ident}</Detail>
            </ExternalLink>
          )}
          {mapping.slack_member_id && (
            <ExternalLink href={`https://nav-it.slack.com/team/${mapping.slack_member_id}`}>
              <Detail textColor="subtle">Slack: {mapping.slack_member_id}</Detail>
            </ExternalLink>
          )}
          {!mapping.nav_ident && !mapping.slack_member_id && (
            <Detail textColor="subtle">Ingen tilleggsinformasjon</Detail>
          )}
        </HStack>

        {/* Role assignments row */}
        {(sectionRoles.length > 0 || teamRoles.length > 0) && (
          <HStack gap="space-8" align="center" wrap>
            <Detail textColor="subtle">Roller:</Detail>
            {sectionRoles.map((ra) => (
              <Tag key={`s-${ra.section_id}-${ra.role}`} variant="warning" size="xsmall">
                {SECTION_ROLE_LABELS[ra.role] ?? ra.role} – {ra.section_name}
              </Tag>
            ))}
            {teamRoles.map((ra) => {
              const team = devTeamById.get(ra.dev_team_id)
              return (
                <Tag
                  key={`t-${ra.dev_team_id}-${ra.role}`}
                  variant={isTeamLeaderRole(ra.role) ? 'warning' : 'info'}
                  size="xsmall"
                >
                  {TEAM_ROLE_LABELS[ra.role] ?? ra.role} – {team?.name ?? `Team #${ra.dev_team_id}`}
                </Tag>
              )
            })}
          </HStack>
        )}
      </VStack>
    </Box>
  )
}
