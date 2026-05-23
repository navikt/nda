import { PencilIcon, PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, Modal, Show, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import styles from '~/styles/common.module.css'

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
              <Box
                key={mapping.github_username}
                padding="space-16"
                background="raised"
                className={styles.stackedListItem}
              >
                <VStack gap="space-12">
                  <HStack gap="space-8" align="center" justify="space-between" wrap>
                    <Link to={`/users/${mapping.github_username}`} style={{ textDecoration: 'none' }}>
                      <Heading level="3" size="xsmall">
                        {mapping.display_name || mapping.github_username}
                      </Heading>
                    </Link>
                    <HStack gap="space-8">
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
                    </HStack>
                  </HStack>

                  <HStack gap="space-16" wrap>
                    <ExternalLink href={`https://github.com/${mapping.github_username}`}>
                      <Detail textColor="subtle">GitHub: {mapping.github_username}</Detail>
                    </ExternalLink>
                    {mapping.nav_email && <Detail textColor="subtle">{mapping.nav_email}</Detail>}
                    {mapping.nav_ident && (
                      <ExternalLink href={`https://teamkatalogen.nav.no/resource/${mapping.nav_ident}`}>
                        <Detail textColor="subtle">Teamkatalogen: {mapping.nav_ident}</Detail>
                      </ExternalLink>
                    )}
                    {mapping.slack_member_id && (
                      <ExternalLink href={`https://nav-it.slack.com/team/${mapping.slack_member_id}`}>
                        <Detail textColor="subtle">Slack: {mapping.slack_member_id}</Detail>
                      </ExternalLink>
                    )}
                    {!mapping.nav_email && !mapping.nav_ident && !mapping.slack_member_id && (
                      <Detail textColor="subtle">Ingen tilleggsinformasjon</Detail>
                    )}
                  </HStack>
                </VStack>
              </Box>
            ))}
          </div>
        )}

        {unmappedUsers.length > 0 && (
          <VStack gap="space-16">
            <Heading level="2" size="medium">
              GitHub-brukere uten mapping ({unmappedUsers.length})
            </Heading>
            <div>
              {unmappedUsers.map((user) => (
                <Box
                  key={user.github_username}
                  padding="space-16"
                  background="raised"
                  className={styles.stackedListItem}
                >
                  <HStack justify="space-between" align="center">
                    <HStack gap="space-12" align="center">
                      <Link to={`/users/${user.github_username}`}>
                        <BodyShort weight="semibold">{user.github_username}</BodyShort>
                      </Link>
                      <Detail textColor="subtle">{user.deployment_count} deployments</Detail>
                    </HStack>
                    <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
                      <Show above="sm">Legg til mapping</Show>
                    </Button>
                  </HStack>
                </Box>
              ))}
            </div>
          </VStack>
        )}

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
