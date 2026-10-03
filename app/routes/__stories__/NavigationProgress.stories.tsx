import { Box, Button, Heading, HStack, Theme, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { NavigationProgress } from '~/components/NavigationProgress'

const meta: Meta<typeof NavigationProgress> = {
  title: 'Components/NavigationProgress',
  component: NavigationProgress,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <VStack>
        <Story />
        <Box padding="space-16" background="neutral-soft">
          <HStack gap="space-16" align="center">
            <Heading size="small" textColor="default" data-color="neutral">
              NDA
            </Heading>
            <Button variant="tertiary" data-color="neutral">
              Mine team
            </Button>
          </HStack>
        </Box>
        <Box padding="space-24">
          <Heading size="large">Deployments</Heading>
        </Box>
      </VStack>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof NavigationProgress>

export const Loading: Story = { args: { isNavigating: true } }

export const Idle: Story = { args: { isNavigating: false } }

export const Dark: Story = {
  args: { isNavigating: true },
  decorators: [
    (Story) => (
      <Theme theme="dark">
        <Story />
      </Theme>
    ),
  ],
}
