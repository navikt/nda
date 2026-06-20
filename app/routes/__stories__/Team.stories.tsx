import { Box, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { Link } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { ExternalLink } from '~/components/ExternalLink'
import { mockApps } from './mock-data'

function TeamPage({ team, appsByEnv }: { team: string; appsByEnv: Record<string, AppCardData[]> }) {
  const environments = Object.keys(appsByEnv).sort()

  return (
    <Box paddingInline={{ xs: 'space-16', md: 'space-24' }} paddingBlock="space-24">
      <VStack gap="space-24">
        <VStack gap="space-8">
          <Heading level="1" size="xlarge">
            {team}
          </Heading>
          <HStack gap="space-8" align="center">
            <ExternalLink href={`https://console.nav.cloud.nais.io/team/${team}/applications`}>
              NAIS Console
            </ExternalLink>
          </HStack>
        </VStack>

        <VStack gap="space-24">
          {environments.map((env) => (
            <VStack key={env} gap="space-16">
              <HStack gap="space-8" align="center">
                <Link to={`/team/${team}/env/${env}`} className="no-underline hover:underline">
                  <Heading level="2" size="small">
                    {env}
                  </Heading>
                </Link>
                <Tag size="xsmall" variant="neutral">
                  {appsByEnv[env].length} {appsByEnv[env].length === 1 ? 'applikasjon' : 'applikasjoner'}
                </Tag>
              </HStack>

              <div>
                {appsByEnv[env].map((app) => (
                  <AppCard key={app.id} app={app} showEnvironment={false} />
                ))}
              </div>
            </VStack>
          ))}
        </VStack>
      </VStack>
    </Box>
  )
}

const meta: Meta<typeof TeamPage> = {
  title: 'Pages/Team',
  component: TeamPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof TeamPage>

const pensjondeployerApps = mockApps.filter((app) => app.team_slug === 'pensjondeployer')
const appsByEnvPensjondeployer = pensjondeployerApps.reduce(
  (acc, app) => {
    if (!acc[app.environment_name]) {
      acc[app.environment_name] = []
    }
    acc[app.environment_name].push(app)
    return acc
  },
  {} as Record<string, AppCardData[]>,
)

export const Default: Story = {
  args: {
    team: 'pensjondeployer',
    appsByEnv: appsByEnvPensjondeployer,
  },
}

export const SingleEnvironment: Story = {
  name: 'Ett miljø',
  args: {
    team: 'pensjondeployer',
    appsByEnv: {
      'prod-fss': pensjondeployerApps.filter((app) => app.environment_name === 'prod-fss'),
    },
  },
}

export const MultipleEnvironments: Story = {
  name: 'Flere miljøer',
  args: {
    team: 'pensjondeployer',
    appsByEnv: {
      'prod-fss': [mockApps[0], mockApps[1]],
      'prod-gcp': [mockApps[2]],
      'dev-fss': [{ ...mockApps[0], id: 10, environment_name: 'dev-fss' }],
    },
  },
}
