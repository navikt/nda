import type { Meta, StoryObj } from '@storybook/react'
import { Form } from 'react-router'
import { SlackMemberIdField } from '~/components/SlackMemberIdField'

const meta: Meta<typeof SlackMemberIdField> = {
  title: 'Components/SlackMemberIdField',
  component: SlackMemberIdField,
  render: (args) => (
    <Form method="post" style={{ maxWidth: 400 }}>
      <SlackMemberIdField {...args} />
    </Form>
  ),
}

export default meta

type Story = StoryObj<typeof SlackMemberIdField>

export const Manual: Story = {
  name: 'Manuell utfylling (ikke funnet automatisk)',
  args: {
    isLoading: false,
    isAutoDetected: false,
    autoDetectedValue: null,
  },
}

export const Loading: Story = {
  name: 'Slår opp automatisk',
  args: {
    isLoading: true,
    isAutoDetected: false,
    autoDetectedValue: null,
  },
}

export const AutoDetected: Story = {
  name: 'Funnet automatisk (grået ut)',
  args: {
    isLoading: false,
    isAutoDetected: true,
    autoDetectedValue: 'U123456',
  },
}
