import { PlusIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { Link } from 'react-router'
import { UserProfileHeader } from '~/components/UserProfileHeader'
import { mockDeployments, mockUserMapping } from './mock-data'

type UserMapping = {
  github_username: string
  display_name: string | null
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
}

type Deployment = {
  id: number
  app_name: string
  environment_name: string
  team_slug: string
  created_at: string
}

function UserPage({
  username,
  mapping,
  deploymentCount,
  recentDeployments,
}: {
  username: string
  mapping: UserMapping | null
  deploymentCount: number
  recentDeployments: Deployment[]
}) {
  const formatDate = (date: string | Date) => {
    const d = new Date(date)
    return d.toLocaleDateString('nb-NO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <VStack gap="space-32">
      <UserProfileHeader username={username} displayName={mapping?.display_name} identity={mapping} />

      {!mapping && (
        <Alert variant="warning">
          <HStack gap="space-16" align="center" justify="space-between" wrap>
            <BodyShort>Ingen brukermapping funnet for denne brukeren.</BodyShort>
            <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
              Opprett mapping
            </Button>
          </HStack>
        </Alert>
      )}

      <VStack gap="space-16">
        <Heading level="2" size="small">
          Siste deployments ({deploymentCount})
        </Heading>

        {recentDeployments.length === 0 ? (
          <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort>Ingen deployments funnet for denne brukeren.</BodyShort>
          </Box>
        ) : (
          <div>
            {recentDeployments.map((deployment) => (
              <Box
                key={deployment.id}
                padding="space-16"
                background="raised"
                borderColor="neutral-subtle"
                borderWidth="1"
                style={{ marginBottom: '-1px' }}
              >
                <HStack gap="space-16" align="center" justify="space-between" wrap>
                  <HStack gap="space-12" align="center">
                    <BodyShort weight="semibold" style={{ whiteSpace: 'nowrap' }}>
                      {formatDate(deployment.created_at)}
                    </BodyShort>
                    <Link
                      to={`/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}`}
                    >
                      <BodyShort>{deployment.app_name}</BodyShort>
                    </Link>
                  </HStack>
                  <Detail textColor="subtle">{deployment.environment_name}</Detail>
                </HStack>
              </Box>
            ))}
          </div>
        )}
      </VStack>
    </VStack>
  )
}

const meta: Meta<typeof UserPage> = {
  title: 'Pages/User',
  component: UserPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1000px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof UserPage>

export const Default: Story = {
  args: {
    username: 'glad-fjord',
    mapping: mockUserMapping,
    deploymentCount: 42,
    recentDeployments: mockDeployments,
  },
}

export const NoMapping: Story = {
  name: 'Uten mapping',
  args: {
    username: 'unknown-user',
    mapping: null,
    deploymentCount: 5,
    recentDeployments: mockDeployments.slice(0, 2),
  },
}

export const PartialMapping: Story = {
  name: 'Delvis mapping',
  args: {
    username: 'partial-user',
    mapping: {
      github_username: 'partial-user',
      display_name: 'Rolig Dal',
      nav_email: null,
      nav_ident: 'Z990001',
      slack_member_id: null,
    },
    deploymentCount: 10,
    recentDeployments: mockDeployments,
  },
}

export const NoDeployments: Story = {
  name: 'Ingen deployments',
  args: {
    username: 'new-user',
    mapping: mockUserMapping,
    deploymentCount: 0,
    recentDeployments: [],
  },
}
