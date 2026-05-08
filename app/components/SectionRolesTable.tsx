import { PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import { Alert, Button, Heading, HStack, Modal, Select, Table, Tag, TextField, VStack } from '@navikt/ds-react'
import { useRef, useState } from 'react'
import { Form } from 'react-router'
import { SECTION_ROLES, type SectionRole } from '~/lib/authorization-types'

export interface SectionRoleAssignmentDisplay {
  id: number
  nav_ident: string
  section_id: number
  role: string
  assigned_by: string
  assigned_at: string | Date
}

export interface SectionOption {
  id: number
  name: string
}

const ROLE_LABELS: Record<SectionRole, string> = {
  teknologileder: 'Teknologileder',
  seksjonsleder: 'Seksjonsleder',
  leveranseleder: 'Leveranseleder',
}

/**
 * Section role assignments table with assign/remove functionality.
 * Used on the admin section roles page.
 */
export function SectionRolesTable({
  sections,
  assignments,
  displayNameMap,
}: {
  sections: SectionOption[]
  assignments: SectionRoleAssignmentDisplay[]
  displayNameMap: Record<string, string | null>
}) {
  const modalRef = useRef<HTMLDialogElement>(null)
  const [selectedSection, setSelectedSection] = useState('')

  return (
    <VStack gap="space-16">
      <HStack justify="space-between" align="center">
        <Heading level="2" size="medium">
          Rolletildelinger ({assignments.length})
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

      {assignments.length > 0 ? (
        <Table size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Seksjon</Table.HeaderCell>
              <Table.HeaderCell>NAV-ident</Table.HeaderCell>
              <Table.HeaderCell>Navn</Table.HeaderCell>
              <Table.HeaderCell>Rolle</Table.HeaderCell>
              <Table.HeaderCell>Tildelt av</Table.HeaderCell>
              <Table.HeaderCell>Tildelt</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {assignments.map((a) => {
              const section = sections.find((s) => s.id === a.section_id)
              return (
                <Table.Row key={a.id}>
                  <Table.DataCell>{section?.name ?? `Seksjon #${a.section_id}`}</Table.DataCell>
                  <Table.DataCell>
                    <code>{a.nav_ident}</code>
                  </Table.DataCell>
                  <Table.DataCell>{displayNameMap[a.nav_ident.toUpperCase()] ?? '–'}</Table.DataCell>
                  <Table.DataCell>
                    <Tag variant="info" size="xsmall">
                      {ROLE_LABELS[a.role as SectionRole] ?? a.role}
                    </Tag>
                  </Table.DataCell>
                  <Table.DataCell>
                    <code>{a.assigned_by}</code>
                  </Table.DataCell>
                  <Table.DataCell>
                    {new Date(a.assigned_at).toLocaleDateString('nb-NO', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Table.DataCell>
                  <Table.DataCell>
                    <Form method="post" style={{ display: 'inline' }}>
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="assignment_id" value={a.id} />
                      <Button variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />} type="submit">
                        Fjern
                      </Button>
                    </Form>
                  </Table.DataCell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      ) : (
        <Alert variant="info" size="small">
          Ingen seksjonsroller er tildelt ennå.
        </Alert>
      )}

      <Modal ref={modalRef} header={{ heading: 'Tildel seksjonsrolle' }} closeOnBackdropClick>
        <Modal.Body>
          <Form method="post" onSubmit={() => modalRef.current?.close()}>
            <input type="hidden" name="intent" value="assign" />
            <VStack gap="space-16">
              <TextField
                label="NAV-ident"
                name="nav_ident"
                size="small"
                autoComplete="off"
                description="Én bokstav etterfulgt av 6 siffer (f.eks. A123456)"
              />
              <Select
                label="Seksjon"
                name="section_id"
                size="small"
                value={selectedSection}
                onChange={(e) => setSelectedSection(e.target.value)}
              >
                <option value="">Velg seksjon…</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Select label="Rolle" name="role" size="small">
                <option value="">Velg rolle…</option>
                {SECTION_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
              <HStack gap="space-8">
                <Button type="submit" size="small" icon={<PlusIcon aria-hidden />}>
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
