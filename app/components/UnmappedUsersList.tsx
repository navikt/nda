import { PlusIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Button, Detail, Heading, HStack, Show, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import styles from '~/styles/common.module.css'

interface UnmappedUser {
  github_username: string
  deployment_count: number
}

interface UnmappedUsersListProps {
  users: UnmappedUser[]
  onAddMapping?: (username: string) => void
}

export function UnmappedUsersList({ users, onAddMapping }: UnmappedUsersListProps) {
  if (users.length === 0) return null

  return (
    <VStack gap="space-16">
      <Heading level="2" size="medium">
        GitHub-brukere uten mapping ({users.length})
      </Heading>
      <div>
        {users.map((user) => (
          <Box key={user.github_username} padding="space-16" background="raised" className={styles.stackedListItem}>
            <HStack justify="space-between" align="center">
              <HStack gap="space-12" align="center">
                <Link to={`/users/${user.github_username}`}>
                  <BodyShort weight="semibold">{user.github_username}</BodyShort>
                </Link>
                <Detail textColor="subtle">{user.deployment_count} deployments</Detail>
              </HStack>
              {onAddMapping && (
                <Button
                  variant="secondary"
                  size="small"
                  icon={<PlusIcon aria-hidden />}
                  onClick={() => onAddMapping(user.github_username)}
                  aria-label="Legg til mapping"
                >
                  <Show above="sm">Legg til mapping</Show>
                </Button>
              )}
            </HStack>
          </Box>
        ))}
      </div>
    </VStack>
  )
}
