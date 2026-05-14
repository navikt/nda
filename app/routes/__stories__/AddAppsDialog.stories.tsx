import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useRef } from 'react'
import { AddAppsDialog, type AddableApp } from '~/components/AddAppsDialog'

const mixedApps: AddableApp[] = [
  { team_slug: 'dp-ramp', environment_name: 'prod-gcp', app_name: 'dp-soknad', monitored_id: 42 },
  { team_slug: 'dp-ramp', environment_name: 'prod-gcp', app_name: 'dp-vedtak', monitored_id: null },
  { team_slug: 'dp-ramp', environment_name: 'dev-gcp', app_name: 'dp-vedtak', monitored_id: null },
  { team_slug: 'dp-arena', environment_name: 'prod-gcp', app_name: 'dp-arena-sink', monitored_id: null },
  { team_slug: 'dp-arena', environment_name: 'prod-gcp', app_name: 'dp-arena-adapter', monitored_id: 101 },
]

const existingOnlyApps: AddableApp[] = [
  { team_slug: 'dp-ramp', environment_name: 'prod-gcp', app_name: 'dp-soknad', monitored_id: 42 },
  { team_slug: 'dp-ramp', environment_name: 'prod-gcp', app_name: 'dp-innsyn', monitored_id: 43 },
]

function OpenDialogWrapper(props: { addableApps: AddableApp[]; naisCatalogFailed: boolean; isSubmitting: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return <AddAppsDialog ref={ref} {...props} />
}

const meta: Meta<typeof AddAppsDialog> = {
  title: 'Team Admin/AddAppsDialog',
  component: AddAppsDialog,
  render: (args) => <OpenDialogWrapper {...args} />,
  parameters: {
    layout: 'fullscreen',
  },
}
export default meta
type Story = StoryObj<typeof AddAppsDialog>

export const MixedApps: Story = {
  args: {
    addableApps: mixedApps,
    naisCatalogFailed: false,
    isSubmitting: false,
  },
}

export const OnlyExistingApps: Story = {
  args: {
    addableApps: existingOnlyApps,
    naisCatalogFailed: false,
    isSubmitting: false,
  },
}

export const NaisCatalogFailed: Story = {
  args: {
    addableApps: [],
    naisCatalogFailed: true,
    isSubmitting: false,
  },
}

export const EmptyList: Story = {
  args: {
    addableApps: [],
    naisCatalogFailed: false,
    isSubmitting: false,
  },
}

export const Submitting: Story = {
  args: {
    addableApps: mixedApps,
    naisCatalogFailed: false,
    isSubmitting: true,
  },
}
