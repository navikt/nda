import { PlusIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Modal, Show, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { useRef, useState } from 'react'
import { UnmappedUsersList } from '~/components/UnmappedUsersList'
import { UserMappingCard } from '~/components/UserMappingCard'

type UserMapping = {
  github_username: string
  display_name: string | null
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
}

type UnmappedUser = {
  github_username: string
  deployment_count: number
}

const mockMappings: UserMapping[] = [
  {
    github_username: 'glad-fjord',
    display_name: 'Glad Fjord',
    nav_email: 'glad.fjord@nav.no',
    nav_ident: 'Z990001',
    slack_member_id: 'U12345678',
  },
  {
    github_username: 'rask-elv',
    display_name: 'Rask Elv',
    nav_email: 'rask.elv@nav.no',
    nav_ident: 'Z990002',
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

const mockUnmappedUsers: UnmappedUser[] = [
  { github_username: 'unknown-deployer', deployment_count: 12 },
  { github_username: 'new-hire', deployment_count: 3 },
]

function AdminUsersPage({ mappings, unmappedUsers }: { mappings: UserMapping[]; unmappedUsers: UnmappedUser[] }) {
  const [deleteTarget, setDeleteTarget] = useState<UserMapping | null>(null)
  const deleteModalRef = useRef<HTMLDialogElement>(null)

  return (
    <Box padding={{ xs: 'space-16', md: 'space-24' }}>
      <VStack gap="space-24">
        <HStack justify="space-between" align="center" wrap gap="space-8">
          <Heading level="1" size="large">
            Brukermappinger
          </Heading>
          <HStack gap="space-8">
            <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
              <Show above="sm">Legg til</Show>
            </Button>
          </HStack>
        </HStack>

        <BodyShort textColor="subtle">
          Kobler GitHub-brukernavn til Nav-identitet og Slack for visning i deployment-oversikten.
        </BodyShort>

        {unmappedUsers.length > 0 && (
          <Alert variant="warning">
            {unmappedUsers.length} GitHub-bruker{unmappedUsers.length === 1 ? '' : 'e'} har deployments men mangler
            mapping. Se listen nederst på siden.
          </Alert>
        )}

        {mappings.length === 0 ? (
          <Alert variant="info">
            Ingen brukermappinger er lagt til ennå. Klikk "Legg til" for å opprette den første.
          </Alert>
        ) : (
          <div>
            {mappings.map((mapping) => (
              <UserMappingCard
                key={mapping.github_username}
                mapping={mapping}
                onEdit={() => {}}
                onDelete={() => {
                  setDeleteTarget(mapping)
                  deleteModalRef.current?.showModal()
                }}
              />
            ))}
          </div>
        )}

        <UnmappedUsersList users={unmappedUsers} onAddMapping={() => {}} />

        {/* Delete Confirmation Modal */}
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
      </VStack>
    </Box>
  )
}

const meta: Meta<typeof AdminUsersPage> = {
  title: 'Pages/AdminUsers',
  component: AdminUsersPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof AdminUsersPage>

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
