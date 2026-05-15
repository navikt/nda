import { DownloadIcon, PencilIcon, PlusIcon, TrashIcon, UploadIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Button, Detail, HStack, Modal, Show, Tag, TextField, VStack } from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { type AdminUsersMapping, AdminUsersPage } from '~/components/AdminUsersPage'
import { getAllDevTeams } from '~/db/dev-teams.server'
import { getAllSectionRoleAssignments, getAllUserRoleAssignments } from '~/db/role-assignments.server'
import { deleteUserMapping, getAllUserMappings, getUnmappedUsers, upsertUserMapping } from '~/db/user-mappings.server'
import { requireAdmin } from '~/lib/auth.server'
import { isTeamLeaderRole, SECTION_ROLE_LABELS, TEAM_ROLE_LABELS } from '~/lib/authorization-types'
import { isValidEmail, isValidNavIdent } from '~/lib/form-validators'
import { isGitHubBot } from '~/lib/github-bots'
import type { Route } from './+types/users'

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const [mappings, unmappedUsers, allDevTeams, userRoleAssignments, userSectionRoleAssignments] = await Promise.all([
    getAllUserMappings(),
    getUnmappedUsers(),
    getAllDevTeams(),
    getAllUserRoleAssignments().catch(() => new Map<string, Array<{ dev_team_id: number; role: string }>>()),
    getAllSectionRoleAssignments().catch(
      () => new Map<string, Array<{ section_id: number; section_name: string; role: string }>>(),
    ),
  ])
  return {
    mappings,
    unmappedUsers,
    allDevTeams,
    userRoleAssignments: Object.fromEntries(userRoleAssignments),
    userSectionRoleAssignments: Object.fromEntries(userSectionRoleAssignments),
  }
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request)

  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'delete') {
    const githubUsername = formData.get('github_username')
    const normalized = typeof githubUsername === 'string' ? githubUsername.trim() : ''
    if (!normalized) {
      return { fieldErrors: { github_username: 'GitHub brukernavn er påkrevd' } }
    }
    await deleteUserMapping(normalized, admin.navIdent)
    return { success: true }
  }

  if (intent === 'upsert') {
    const githubUsername = formData.get('github_username') as string
    const navEmail = (formData.get('nav_email') as string) || null
    const navIdent = (formData.get('nav_ident') as string) || null

    const fieldErrors: { github_username?: string; nav_email?: string; nav_ident?: string } = {}

    if (!githubUsername) {
      fieldErrors.github_username = 'GitHub brukernavn er påkrevd'
    } else if (isGitHubBot(githubUsername)) {
      fieldErrors.github_username = 'Kan ikke opprette mapping for GitHub-botkontoer'
    }

    if (navEmail && !isValidEmail(navEmail)) {
      fieldErrors.nav_email = 'Ugyldig e-postformat'
    }

    if (navIdent && !isValidNavIdent(navIdent)) {
      fieldErrors.nav_ident = 'Må være én bokstav etterfulgt av 6 siffer (f.eks. A123456)'
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors }
    }

    await upsertUserMapping({
      githubUsername,
      displayName: (formData.get('display_name') as string) || null,
      navEmail,
      navIdent,
      slackMemberId: (formData.get('slack_member_id') as string) || null,
    })
    return { success: true }
  }

  if (intent === 'import') {
    const file = formData.get('file') as File
    if (!file || file.size === 0) {
      return { error: 'Ingen fil valgt' }
    }

    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (!data.mappings || !Array.isArray(data.mappings)) {
        return { error: 'Ugyldig filformat - mangler mappings array' }
      }

      let imported = 0
      for (const mapping of data.mappings) {
        if (!mapping.github_username) continue
        await upsertUserMapping({
          githubUsername: mapping.github_username,
          displayName: mapping.display_name || null,
          navEmail: mapping.nav_email || null,
          navIdent: mapping.nav_ident || null,
          slackMemberId: mapping.slack_member_id || null,
        })
        imported++
      }

      return { success: true, message: `Importerte ${imported} brukermappinger` }
    } catch (e) {
      return { error: `Kunne ikke lese fil: ${e instanceof Error ? e.message : 'Ukjent feil'}` }
    }
  }

  return { error: 'Ukjent handling' }
}

export function meta() {
  return [{ title: 'Brukermappinger - Admin' }]
}

export default function AdminUsers() {
  const { mappings, unmappedUsers, allDevTeams, userRoleAssignments, userSectionRoleAssignments } =
    useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  const [editMapping, setEditMapping] = useState<AdminUsersMapping | null>(null)
  const [addFormKey, setAddFormKey] = useState(0)
  const [prefillUsername, setPrefillUsername] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AdminUsersMapping | null>(null)
  const deleteModalRef = useRef<HTMLDialogElement>(null)
  const modalRef = useRef<HTMLDialogElement>(null)
  const addModalRef = useRef<HTMLDialogElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const devTeamById = new Map(allDevTeams.map((t) => [t.id, t]))

  useEffect(() => {
    if (actionData?.success && navigation.state === 'idle') {
      setAddFormKey((k) => k + 1)
      addModalRef.current?.close()
      modalRef.current?.close()
      deleteModalRef.current?.close()
    }
  }, [actionData, navigation.state])

  const openEdit = (mapping: AdminUsersMapping) => {
    setEditMapping(mapping)
    modalRef.current?.showModal()
  }

  const openAdd = () => {
    setPrefillUsername('')
    setAddFormKey((k) => k + 1)
    addModalRef.current?.showModal()
  }

  const openAddWithUsername = (username: string) => {
    setPrefillUsername(username)
    setAddFormKey((k) => k + 1)
    addModalRef.current?.showModal()
  }

  return (
    <AdminUsersPage
      mappings={mappings}
      unmappedUsers={unmappedUsers}
      topActions={
        <HStack gap="space-8">
          <Button
            as="a"
            href="/admin/users/export"
            download
            variant="tertiary"
            size="small"
            icon={<DownloadIcon aria-hidden />}
          >
            <Show above="sm">Eksporter</Show>
          </Button>
          <Form method="post" encType="multipart/form-data" style={{ display: 'contents' }}>
            <input type="hidden" name="intent" value="import" />
            <input
              ref={fileInputRef}
              type="file"
              name="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.length) {
                  e.target.form?.requestSubmit()
                }
              }}
            />
            <Button
              type="button"
              variant="tertiary"
              size="small"
              icon={<UploadIcon aria-hidden />}
              onClick={() => fileInputRef.current?.click()}
            >
              <Show above="sm">Importer</Show>
            </Button>
          </Form>
          <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={openAdd}>
            <Show above="sm">Legg til</Show>
          </Button>
        </HStack>
      }
      renderMappingActions={(mapping) => (
        <>
          <Button variant="tertiary" size="small" icon={<PencilIcon aria-hidden />} onClick={() => openEdit(mapping)}>
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
      renderMappingDetails={(mapping) => (
        <>
          {mapping.nav_ident &&
            ((userRoleAssignments[mapping.nav_ident.toUpperCase()] ?? []).length > 0 ||
              (userSectionRoleAssignments[mapping.nav_ident.toUpperCase()] ?? []).length > 0) && (
              <HStack gap="space-8" align="center" wrap>
                <Detail textColor="subtle">Roller:</Detail>
                {(userSectionRoleAssignments[mapping.nav_ident.toUpperCase()] ?? []).map((ra) => (
                  <Tag key={`s-${ra.section_id}-${ra.role}`} variant="warning" size="xsmall">
                    {SECTION_ROLE_LABELS[ra.role] ?? ra.role} – {ra.section_name}
                  </Tag>
                ))}
                {(userRoleAssignments[mapping.nav_ident.toUpperCase()] ?? []).map((ra) => {
                  const team = devTeamById.get(ra.dev_team_id)
                  return team ? (
                    <Tag
                      key={`t-${ra.dev_team_id}-${ra.role}`}
                      variant={isTeamLeaderRole(ra.role) ? 'warning' : 'info'}
                      size="xsmall"
                    >
                      {TEAM_ROLE_LABELS[ra.role] ?? ra.role} – {team.name}
                    </Tag>
                  ) : null
                })}
              </HStack>
            )}
        </>
      )}
      renderUnmappedActions={(user) => (
        <Button
          variant="secondary"
          size="small"
          icon={<PlusIcon aria-hidden />}
          onClick={() => openAddWithUsername(user.github_username)}
        >
          <Show above="sm">Legg til mapping</Show>
        </Button>
      )}
    >
      {actionData?.message && (
        <Alert variant="success" closeButton>
          {actionData.message}
        </Alert>
      )}

      <ActionAlert data={actionData} />

      <Modal ref={addModalRef} header={{ heading: 'Legg til brukermapping' }} width="medium">
        <Modal.Body>
          <Form method="post" id="add-form" key={addFormKey}>
            <input type="hidden" name="intent" value="upsert" />
            <VStack gap="space-16">
              <TextField
                label="GitHub brukernavn"
                name="github_username"
                required
                defaultValue={prefillUsername}
                error={actionData?.fieldErrors?.github_username}
              />
              <TextField label="Navn" name="display_name" />
              <TextField label="Nav e-post" name="nav_email" error={actionData?.fieldErrors?.nav_email} />
              <TextField
                label="Nav-ident"
                name="nav_ident"
                description="Format: én bokstav etterfulgt av 6 siffer (f.eks. A123456)"
                error={actionData?.fieldErrors?.nav_ident}
              />
              <TextField label="Slack member ID" name="slack_member_id" />
            </VStack>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button type="submit" form="add-form" loading={isSubmitting}>
            Lagre
          </Button>
          <Button variant="secondary" onClick={() => addModalRef.current?.close()}>
            Avbryt
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        ref={modalRef}
        header={{ heading: 'Rediger brukermapping' }}
        width="medium"
        onClose={() => setEditMapping(null)}
      >
        <Modal.Body>
          {editMapping && (
            <Form method="post" id="edit-form">
              <input type="hidden" name="intent" value="upsert" />
              <input type="hidden" name="github_username" value={editMapping.github_username} />
              <VStack gap="space-16">
                <TextField label="GitHub brukernavn" value={editMapping.github_username} disabled />
                <TextField label="Navn" name="display_name" defaultValue={editMapping.display_name || ''} />
                <TextField
                  label="Nav e-post"
                  name="nav_email"
                  defaultValue={editMapping.nav_email || ''}
                  error={actionData?.fieldErrors?.nav_email}
                />
                <TextField
                  label="Nav-ident"
                  name="nav_ident"
                  description="Format: én bokstav etterfulgt av 6 siffer (f.eks. A123456)"
                  defaultValue={editMapping.nav_ident || ''}
                  error={actionData?.fieldErrors?.nav_ident}
                />
                <TextField
                  label="Slack member ID"
                  name="slack_member_id"
                  defaultValue={editMapping.slack_member_id || ''}
                />
              </VStack>
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button type="submit" form="edit-form" loading={isSubmitting}>
            Lagre
          </Button>
          <Button variant="secondary" onClick={() => modalRef.current?.close()}>
            Avbryt
          </Button>
        </Modal.Footer>
      </Modal>

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
