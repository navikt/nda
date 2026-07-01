import { DownloadIcon, PlusIcon, UploadIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Modal, Show, VStack } from '@navikt/ds-react'
import type { ChangeEvent, RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Form } from 'react-router'
import { UnmappedUsersList } from '~/components/UnmappedUsersList'
import { UserMappingCard } from '~/components/UserMappingCard'

interface UserMapping {
  github_username: string
  display_github_username: string | null
  display_name: string | null
  nav_ident: string | null
  slack_member_id: string | null
}

interface UnmappedUser {
  github_username: string
  deployment_count: number
}

interface RoleAssignment {
  dev_team_id: number
  role: string
}

interface SectionRoleAssignment {
  section_id: number
  section_name: string
  role: string
}

interface DevTeam {
  id: number
  name: string
}

interface AdminUsersPageProps<T extends UserMapping = UserMapping> {
  mappings: T[]
  unmappedUsers: UnmappedUser[]
  devTeamById?: Map<number, DevTeam>
  userRoleAssignments?: Record<string, RoleAssignment[]>
  userSectionRoleAssignments?: Record<string, SectionRoleAssignment[]>
  actionMessage?: string | null
  actionData?: { success?: boolean; error?: string } | null
  isSubmitting?: boolean
  onAdd?: () => void
  onEdit?: (mapping: T) => void
  onAddMapping?: (username: string) => void
  onImportClick?: () => void
  fileInputRef?: RefObject<HTMLInputElement | null>
  onFileChange?: (e: ChangeEvent<HTMLInputElement>) => void
}

export function AdminUsersPage<T extends UserMapping = UserMapping>({
  mappings,
  unmappedUsers,
  devTeamById = new Map(),
  userRoleAssignments = {},
  userSectionRoleAssignments = {},
  actionMessage,
  actionData,
  isSubmitting = false,
  onAdd,
  onEdit,
  onAddMapping,
  onImportClick,
  fileInputRef,
  onFileChange,
}: AdminUsersPageProps<T>) {
  const [deleteTarget, setDeleteTarget] = useState<UserMapping | null>(null)
  const deleteModalRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (actionData?.success && !isSubmitting) {
      deleteModalRef.current?.close()
      setDeleteTarget(null)
    }
  }, [actionData, isSubmitting])

  return (
    <Box padding={{ xs: 'space-16', md: 'space-24' }}>
      <VStack gap="space-24">
        <HStack justify="space-between" align="center" wrap gap="space-8">
          <Heading level="1" size="large">
            Brukermappinger
          </Heading>
          <HStack gap="space-8">
            <Button
              as="a"
              href="/admin/users/export"
              download
              variant="tertiary"
              size="small"
              icon={<DownloadIcon aria-hidden />}
              aria-label="Eksporter"
            >
              <Show above="sm">Eksporter</Show>
            </Button>
            {onImportClick && fileInputRef && onFileChange && (
              <Form method="post" encType="multipart/form-data" style={{ display: 'contents' }}>
                <input type="hidden" name="intent" value="import" />
                <input
                  ref={fileInputRef}
                  type="file"
                  name="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={onFileChange}
                />
                <Button
                  type="button"
                  variant="tertiary"
                  size="small"
                  icon={<UploadIcon aria-hidden />}
                  aria-label="Importer"
                  onClick={onImportClick}
                >
                  <Show above="sm">Importer</Show>
                </Button>
              </Form>
            )}
            {onAdd && (
              <Button
                variant="secondary"
                size="small"
                icon={<PlusIcon aria-hidden />}
                aria-label="Legg til"
                onClick={onAdd}
              >
                <Show above="sm">Legg til</Show>
              </Button>
            )}
          </HStack>
        </HStack>

        <BodyShort textColor="subtle">
          Kobler GitHub-brukernavn til Nav-identitet og Slack for visning i deployment-oversikten.
        </BodyShort>

        {actionMessage && (
          <Alert variant="success" closeButton>
            {actionMessage}
          </Alert>
        )}

        {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

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
                teamRoles={mapping.nav_ident ? (userRoleAssignments[mapping.nav_ident.toUpperCase()] ?? []) : []}
                sectionRoles={
                  mapping.nav_ident ? (userSectionRoleAssignments[mapping.nav_ident.toUpperCase()] ?? []) : []
                }
                devTeamById={devTeamById}
                onEdit={onEdit ? () => onEdit(mapping) : undefined}
                onDelete={() => {
                  setDeleteTarget(mapping)
                  deleteModalRef.current?.showModal()
                }}
              />
            ))}
          </div>
        )}

        <UnmappedUsersList users={unmappedUsers} onAddMapping={onAddMapping} />

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
              <strong>
                {deleteTarget?.display_name || deleteTarget?.display_github_username || deleteTarget?.github_username}
              </strong>
              {deleteTarget?.display_name
                ? ` (${deleteTarget.display_github_username || deleteTarget.github_username})`
                : ''}
              ?
            </BodyShort>
          </Modal.Body>
          <Modal.Footer>
            <Form method="post">
              <input type="hidden" name="github_username" value={deleteTarget?.github_username ?? ''} />
              <Button variant="danger" type="submit" name="intent" value="delete" loading={isSubmitting}>
                Slett
              </Button>
            </Form>
            <Button variant="secondary" onClick={() => deleteModalRef.current?.close()}>
              Avbryt
            </Button>
          </Modal.Footer>
        </Modal>
      </VStack>
    </Box>
  )
}
