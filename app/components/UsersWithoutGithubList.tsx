import { BodyShort, Box, HStack, VStack } from '@navikt/ds-react'
import styles from '~/styles/common.module.css'

interface UserWithoutGithub {
  nav_ident: string
  display_name: string | null
}

interface UsersWithoutGithubListProps {
  users: UserWithoutGithub[]
}

export function UsersWithoutGithubList({ users }: UsersWithoutGithubListProps) {
  if (users.length === 0) return null

  return (
    <VStack gap="space-16">
      <div>
        {users.map((u) => (
          <Box key={u.nav_ident} padding="space-16" background="raised" className={styles.stackedListItem}>
            <HStack justify="space-between" align="center">
              <VStack gap="space-2">
                <BodyShort weight="semibold">{u.display_name}</BodyShort>
                <BodyShort size="small" textColor="subtle">
                  {u.nav_ident}
                </BodyShort>
              </VStack>
            </HStack>
          </Box>
        ))}
      </div>
    </VStack>
  )
}
