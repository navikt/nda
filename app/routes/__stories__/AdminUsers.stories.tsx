import { PencilIcon, PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import { BodyShort, Button, Modal, Show } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { useRef, useState } from 'react'
import { type AdminUsersMapping, AdminUsersPage, type AdminUsersUnmappedUser } from '~/components/AdminUsersPage'

const mockMappings: AdminUsersMapping[] = [
  {
    github_username: 'john-doe',
    display_name: 'John Doe',
    nav_email: 'john.doe@nav.no',
    nav_ident: 'A123456',
    slack_member_id: 'U12345678',
  },
  {
    github_username: 'jane-smith',
    display_name: 'Jane Smith',
    nav_email: 'jane.smith@nav.no',
    nav_ident: 'B654321',
    slack_member_id: 'U87654321',
  },
  {
    github_username: 'dev-user',
    display_name: null,
    nav_email: 'dev.user@nav.no',
    nav_ident: null,
    slack_member_id: null,
  },
  {
    github_username: 'minimal-user',
    display_name: null,
    nav_email: null,
    nav_ident: null,
    slack_member_id: null,
  },
]

const mockUnmappedUsers: AdminUsersUnmappedUser[] = [
  { github_username: 'unknown-deployer', deployment_count: 12 },
  { github_username: 'new-hire', deployment_count: 3 },
]

function AdminUsersStory({
  mappings,
  unmappedUsers,
}: {
  mappings: AdminUsersMapping[]
  unmappedUsers: AdminUsersUnmappedUser[]
}) {
  const [deleteTarget, setDeleteTarget] = useState<AdminUsersMapping | null>(null)
  const deleteModalRef = useRef<HTMLDialogElement>(null)

  return (
    <AdminUsersPage
      mappings={mappings}
      unmappedUsers={unmappedUsers}
      topActions={
        <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
          <Show above="sm">Legg til</Show>
        </Button>
      }
      renderMappingActions={(mapping) => (
        <>
          <Button variant="tertiary" size="small" icon={<PencilIcon aria-hidden />}>
            <Show above="sm">Rediger</Show>
          </Button>
          <Button
            variant="tertiary-neutral"
            size="small"
            icon={<TrashIcon aria-hidden />}
            onClick={() => {
              setDeleteTarget(mapping)
              deleteModalRef.current?.showModal()
            }}
          >
            <Show above="sm">Slett</Show>
          </Button>
        </>
      )}
      renderUnmappedActions={() => (
        <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
          <Show above="sm">Legg til mapping</Show>
        </Button>
      )}
    >
      <Modal
        ref={deleteModalRef}
        header={{ heading: 'Bekreft sletting' }}
        width="small"
        onClose={() => setDeleteTarget(null)}
      >
        <Modal.Body>
          <BodyShort>
            Er du sikker på at du vil slette brukermappingen for{' '}
            <strong>{deleteTarget?.display_name || deleteTarget?.github_username}</strong>
            {deleteTarget?.display_name ? ` (${deleteTarget.github_username})` : ''}?
          </BodyShort>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="danger">Slett</Button>
          <Button variant="secondary" onClick={() => deleteModalRef.current?.close()}>
            Avbryt
          </Button>
        </Modal.Footer>
      </Modal>
    </AdminUsersPage>
  )
}

const meta: Meta<typeof AdminUsersStory> = {
  title: 'Pages/AdminUsers',
  component: AdminUsersStory,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof AdminUsersStory>

export const Default: Story = {
  args: {
    mappings: mockMappings,
    unmappedUsers: [],
  },
}

export const WithUnmappedUsers: Story = {
  name: 'Med umappede brukere',
  args: {
    mappings: mockMappings,
    unmappedUsers: mockUnmappedUsers,
  },
}

export const Empty: Story = {
  name: 'Ingen brukere',
  args: {
    mappings: [],
    unmappedUsers: [],
  },
}

export const MinimalData: Story = {
  name: 'Kun GitHub-brukernavn',
  args: {
    mappings: [
      {
        github_username: 'solo-user',
        display_name: null,
        nav_email: null,
        nav_ident: null,
        slack_member_id: null,
      },
    ],
    unmappedUsers: [],
  },
}

export const OnlyUnmapped: Story = {
  name: 'Kun umappede brukere',
  args: {
    mappings: [],
    unmappedUsers: mockUnmappedUsers,
  },
}
