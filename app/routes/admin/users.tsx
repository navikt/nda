import { Button, Modal, TextField, VStack } from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router'
import { AdminUsersPage } from '~/components/AdminUsersPage'
import { CreateMappingModal } from '~/components/CreateMappingModal'
import { getAllDevTeams } from '~/db/dev-teams.server'
import { getAllSectionRoleAssignments, getAllUserRoleAssignments } from '~/db/role-assignments.server'
import {
  deleteUserMapping,
  getAllUserMappings,
  getUnmappedUsers,
  type UserMapping,
  upsertUserMapping,
} from '~/db/user-mappings.server'
import { requireAdmin } from '~/lib/auth.server'
import { getFormString, isValidEmail, isValidGitHubUsername, isValidNavIdent } from '~/lib/form-validators'
import { isGitHubBot } from '~/lib/github-bots'
import { logger } from '~/lib/logger.server'
import { searchGraphUsers } from '~/lib/microsoft-graph.server'
import { formatDisplayNameNatural } from '~/lib/user-display'
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

  if (intent === 'create-mapping') {
    const githubUsername = getFormString(formData, 'github_username')?.toLowerCase() || ''
    const navIdentRaw = getFormString(formData, 'nav_ident')?.toUpperCase() || null

    // nav_email included for TypeScript compatibility — both create-mapping and upsert branches
    // contribute to the same inferred action return type used by the Edit modal (line ~484)
    const fieldErrors: { github_username?: string; nav_email?: string; nav_ident?: string } = {}

    if (!githubUsername) {
      fieldErrors.github_username = 'GitHub brukernavn er påkrevd'
    } else if (!isValidGitHubUsername(githubUsername)) {
      fieldErrors.github_username = 'Ugyldig GitHub-brukernavn (kun bokstaver, tall og bindestrek)'
    } else if (isGitHubBot(githubUsername)) {
      fieldErrors.github_username = 'Kan ikke opprette mapping for GitHub-botkontoer'
    }

    if (!navIdentRaw) {
      fieldErrors.nav_ident = 'NAV-ident er påkrevd'
    } else if (!isValidNavIdent(navIdentRaw)) {
      fieldErrors.nav_ident = 'Må være én bokstav etterfulgt av 6 siffer'
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors }
    }

    const navIdent = navIdentRaw as string
    let graphResults: Awaited<ReturnType<typeof searchGraphUsers>>
    try {
      graphResults = await searchGraphUsers(navIdent)
    } catch (error) {
      logger.error('Graph API lookup failed during admin mapping creation', error)
      return { fieldErrors: { nav_ident: 'Kunne ikke verifisere NAV-ident (Graph API utilgjengelig)' } }
    }

    const graphUser = graphResults.find((u) => u.navIdent?.toUpperCase() === navIdent.toUpperCase())
    if (!graphUser) {
      return { fieldErrors: { nav_ident: 'NAV-ident ble ikke funnet i Active Directory' } }
    }

    const displayName = graphUser.displayName ? formatDisplayNameNatural(graphUser.displayName) : null
    const navEmail = graphUser.email ?? null

    await upsertUserMapping({
      githubUsername,
      displayName,
      navEmail,
      navIdent,
      slackMemberId: getFormString(formData, 'slack_member_id') || null,
    })
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

    // Validate email format
    if (navEmail && !isValidEmail(navEmail)) {
      fieldErrors.nav_email = 'Ugyldig e-postformat'
    }

    // Validate Nav-ident format (one letter followed by 6 digits)
    if (navIdent && !isValidNavIdent(navIdent)) {
      fieldErrors.nav_ident = 'Må være én bokstav etterfulgt av 6 siffer'
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

  const [editMapping, setEditMapping] = useState<UserMapping | null>(null)
  const [addFormKey, setAddFormKey] = useState(0)
  const [prefillUsername, setPrefillUsername] = useState('')
  const modalRef = useRef<HTMLDialogElement>(null)
  const addModalRef = useRef<HTMLDialogElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const devTeamById = new Map(allDevTeams.map((t) => [t.id, t]))

  // Reset add form and close modals when action succeeds
  useEffect(() => {
    if (actionData?.success && navigation.state === 'idle') {
      setAddFormKey((k) => k + 1)
      addModalRef.current?.close()
      modalRef.current?.close()
    }
  }, [actionData, navigation.state])

  const openEdit = (mapping: UserMapping) => {
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
    <>
      <AdminUsersPage
        mappings={mappings}
        unmappedUsers={unmappedUsers}
        devTeamById={devTeamById}
        userRoleAssignments={userRoleAssignments}
        userSectionRoleAssignments={userSectionRoleAssignments}
        actionMessage={actionData?.message}
        actionData={actionData}
        isSubmitting={isSubmitting}
        onAdd={openAdd}
        onEdit={openEdit}
        onAddMapping={openAddWithUsername}
        onImportClick={() => fileInputRef.current?.click()}
        fileInputRef={fileInputRef}
        onFileChange={(e) => {
          if (e.target.files?.length) {
            e.target.form?.requestSubmit()
          }
        }}
      />

      {/* Add Modal */}
      <CreateMappingModal
        ref={addModalRef}
        key={addFormKey}
        username={prefillUsername}
        canPrefillOwnMapping={false}
        githubEditable
        isSubmitting={isSubmitting}
        fieldErrors={actionData?.fieldErrors}
        intent="create-mapping"
        heading="Legg til brukermapping"
        formId="add-form"
        width="medium"
      />

      {/* Edit Modal */}
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
                <TextField label="GitHub brukernavn" value={editMapping.display_github_username} disabled />
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
    </>
  )
}
