import { PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Button,
  Heading,
  HStack,
  Modal,
  Select,
  Table,
  Tag,
  UNSAFE_Combobox,
  VStack,
} from '@navikt/ds-react'
import { useRef, useState } from 'react'
import { Form } from 'react-router'
import { isTeamLeaderRole, TEAM_ROLE_LABELS, TEAM_ROLES } from '~/lib/authorization-types'

export interface RoleMember {
  id: number
  nav_ident: string
  role: string
  github_username: string | null
  display_name: string | null
  assigned_at: string | Date
}

export interface UserOption {
  navIdent: string
  displayName: string | null
  githubUsername: string
}

/**
 * Team role management section with table and assign modal.
 * Used on the team admin page.
 */
export function RoleMembersSection({ roleMembers, allUsers }: { roleMembers: RoleMember[]; allUsers: UserOption[] }) {
  const modalRef = useRef<HTMLDialogElement>(null)
  const [selectedNavIdent, setSelectedNavIdent] = useState('')
  const [selectedRole, setSelectedRole] = useState<string>('utvikler')

  const roleMemberIdents = new Set(roleMembers.map((m) => `${m.nav_ident.toUpperCase()}-${m.role}`))
  const availableUsers = allUsers.filter((u) => !roleMemberIdents.has(`${u.navIdent.toUpperCase()}-${selectedRole}`))

  const comboboxOptions = availableUsers.map((u) => ({
    label: `${u.displayName ?? u.githubUsername} (${u.navIdent})`,
    value: u.navIdent,
  }))

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
                  {member.github_username ? (
                    <code>{member.github_username}</code>
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

      <Modal ref={modalRef} header={{ heading: 'Tildel teamrolle' }} closeOnBackdropClick>
        <Modal.Body>
          <Form
            method="post"
            onSubmit={() => {
              modalRef.current?.close()
              setSelectedNavIdent('')
            }}
          >
            <input type="hidden" name="intent" value="assign_role" />
            <input type="hidden" name="nav_ident" value={selectedNavIdent} />
            <VStack gap="space-16">
              <UNSAFE_Combobox
                key={selectedRole}
                label="Søk etter bruker"
                options={comboboxOptions}
                onToggleSelected={(value, isSelected) => {
                  setSelectedNavIdent(isSelected ? value : '')
                }}
                shouldAutocomplete
              />
              <Select
                label="Rolle"
                name="role"
                size="small"
                value={selectedRole}
                onChange={(e) => {
                  setSelectedRole(e.target.value)
                  setSelectedNavIdent('')
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
                <Button
                  variant="tertiary"
                  size="small"
                  type="button"
                  onClick={() => {
                    modalRef.current?.close()
                    setSelectedNavIdent('')
                  }}
                >
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
