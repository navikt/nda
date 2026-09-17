import type { Meta, StoryObj } from '@storybook/react'
import { ImplicitApprovalSettings } from './ImplicitApprovalSettings'

const meta: Meta<typeof ImplicitApprovalSettings> = {
  title: 'Features/RepositoryAdmin/ImplicitApprovalSettings',
  component: ImplicitApprovalSettings,
}
export default meta
type Story = StoryObj<typeof ImplicitApprovalSettings>

export const Default: Story = {
  name: 'Implisitt godkjenning - av',
  args: {
    repositoryId: 5,
    implicitApprovalSettings: { mode: 'off' },
  },
}

export const KunDependabot: Story = {
  name: 'Implisitt godkjenning - kun Dependabot',
  args: {
    repositoryId: 5,
    implicitApprovalSettings: { mode: 'dependabot_only' },
  },
}
