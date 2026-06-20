import { PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Button, Heading, HStack, Modal, Select, Table, Tag, VStack } from '@navikt/ds-react'
import { useRef, useState } from 'react'
import { Form } from 'react-router'
import { isTeamLeaderRole, TEAM_ROLE_LABELS, TEAM_ROLES } from '~/lib/authorization-types'
import { UserSearch } from './UserSearch'

export interface RoleMember {
  id: number
  nav_ident: string
  role: string
  github_username: string | null
  display_github_username: string | null
  display_name: string | null
  assigned_at: string | Date
}

export function RoleMembersSection({ roleMembers }: { roleMembers: RoleMember[] }) {
  const modalRef = useRef<HTMLDialogElement>(null)
  const [selectedNavIdent, setSelectedNavIdent] = useState('')
  const [selectedRole, setSelectedRole] = useState<string>('utvikler')
  const [searchResetKey, setSearchResetKey] = useState(0)

  return (
    <VStack gap="space-16">
      <HStack justify="space-between" align="center">
        <Heading level="2" size="medium">
          Rolletildelinger ({roleMembers.length})
        </Heading>
        <Button
          variant="tertiary"
          size="small"
          icon={<PlusIcon aria-hidden />}
          onClick={() => modalRef.current?.showModal()}
        >
          Tildel rolle
        </Button>
      </HStack>

      {roleMembers.length > 0 ? (
        <Table size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>NAV-ident</Table.HeaderCell>
              <Table.HeaderCell>Navn</Table.HeaderCell>
              <Table.HeaderCell>Rolle</Table.HeaderCell>
              <Table.HeaderCell>GitHub</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {roleMembers.map((member) => (
              <Table.Row key={member.id}>
                <Table.DataCell>
                  <code>{member.nav_ident}</code>
                </Table.DataCell>
                <Table.DataCell>{member.display_name ?? '–'}</Table.DataCell>
                <Table.DataCell>
                  <Tag variant={isTeamLeaderRole(member.role) ? 'warning' : 'info'} size="xsmall">
                    {TEAM_ROLE_LABELS[member.role] ?? member.role}
                  </Tag>
                </Table.DataCell>
                <Table.DataCell>
                  {member.display_github_username || member.github_username ? (
                    <code>{member.display_github_username ?? member.github_username}</code>
                  ) : (
                    <BodyShort textColor="subtle">–</BodyShort>
                  )}
                </Table.DataCell>
                <Table.DataCell>
                  <Form method="post" style={{ display: 'inline' }}>
                    <input type="hidden" name="intent" value="remove_role" />
                    <input type="hidden" name="assignment_id" value={member.id} />
                    <Button variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />} type="submit">
                      Fjern
                    </Button>
                  </Form>
                </Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      ) : (
        <Alert variant="info" size="small">
          Ingen roller er tildelt ennå. Bruk knappen over for å tildele roller.
        </Alert>
      )}

      <Modal
        ref={modalRef}
        header={{ heading: 'Tildel teamrolle' }}
        closeOnBackdropClick
        onClose={() => {
          setSelectedNavIdent('')
          setSearchResetKey((k) => k + 1)
        }}
      >
        <Modal.Body>
          <Form
            method="post"
            onSubmit={() => {
              modalRef.current?.close()
            }}
          >
            <input type="hidden" name="intent" value="assign_role" />
            <input type="hidden" name="nav_ident" value={selectedNavIdent} />
            <VStack gap="space-16">
              <UserSearch
                label="Søk etter bruker"
                description="Søk med navn, e-post eller NAV-ident"
                onSelect={(navIdent) => setSelectedNavIdent(navIdent)}
                onClear={() => setSelectedNavIdent('')}
                resetKey={searchResetKey}
              />
              <Select
                label="Rolle"
                name="role"
                size="small"
                value={selectedRole}
                onChange={(e) => {
                  setSelectedRole(e.target.value)
                }}
              >
                {TEAM_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {TEAM_ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
              <HStack gap="space-8">
                <Button type="submit" size="small" icon={<PlusIcon aria-hidden />} disabled={!selectedNavIdent}>
                  Tildel
                </Button>
                <Button variant="tertiary" size="small" type="button" onClick={() => modalRef.current?.close()}>
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        </Modal.Body>
      </Modal>
    </VStack>
  )
}
