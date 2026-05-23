import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useRef } from 'react'
import { CreateMappingModal, type CreateMappingModalProps } from '~/components/CreateMappingModal'

function OpenDialogWrapper(props: CreateMappingModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return <CreateMappingModal ref={ref} {...props} />
}

const meta: Meta<typeof CreateMappingModal> = {
  title: 'Components/CreateMappingModal',
  component: CreateMappingModal,
  render: (args) => <OpenDialogWrapper {...args} />,
  parameters: {
    layout: 'fullscreen',
  },
}

export default meta

type Story = StoryObj<typeof CreateMappingModal>

export const Default: Story = {
  name: 'Admin-opprettelse (fast GitHub)',
  args: {
    username: 'glad-fjord',
    canPrefillOwnMapping: false,
    isSubmitting: false,
  },
}

export const AdminEditable: Story = {
  name: 'Admin-opprettelse (redigerbar GitHub)',
  args: {
    username: '',
    canPrefillOwnMapping: false,
    githubEditable: true,
    isSubmitting: false,
    heading: 'Legg til brukermapping',
    intent: 'create-mapping',
    formId: 'add-form',
  },
}

export const AdminWithPrefill: Story = {
  name: 'Admin-opprettelse (forhåndsutfylt GitHub)',
  args: {
    username: 'rask-elv',
    canPrefillOwnMapping: false,
    githubEditable: true,
    isSubmitting: false,
    heading: 'Legg til brukermapping',
    intent: 'create-mapping',
    formId: 'add-form',
  },
}

export const SelfService: Story = {
  name: 'Selvbetjening',
  args: {
    username: 'modig-bjork',
    canPrefillOwnMapping: true,
    loggedInNavIdent: 'Z990008',
    isSubmitting: false,
  },
}

export const WithFieldErrors: Story = {
  name: 'Med valideringsfeil',
  args: {
    username: 'glad-fjord',
    canPrefillOwnMapping: false,
    isSubmitting: false,
    fieldErrors: {
      nav_ident: 'NAV-ident ble ikke funnet i Active Directory',
    },
  },
}

export const Submitting: Story = {
  name: 'Lagrer',
  args: {
    username: 'glad-fjord',
    canPrefillOwnMapping: false,
    isSubmitting: true,
  },
}
