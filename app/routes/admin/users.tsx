import { Button, Modal, TextField, VStack } from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router'
import { AdminUsersPage } from '~/components/AdminUsersPage'
import { CreateMappingModal } from '~/components/CreateMappingModal'
import { getAllDevTeams } from '~/db/dev-teams.server'
import { getAllSectionRoleAssignments, getAllUserRoleAssignments } from '~/db/role-assignments.server'
import {
  deleteUser,
  deleteUserMapping,
  getAllUserMappings,
  getUnmappedUsers,
  getUserMappingByNavIdent,
  type UserMapping,
  upsertUser,
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
    const navIdentRaw = formData.get('nav_ident')
    const normalized = typeof githubUsername === 'string' ? githubUsername.trim() : ''
    const navIdent = typeof navIdentRaw === 'string' ? navIdentRaw.trim().toUpperCase() : ''

    if (navIdent) {
      if (!isValidNavIdent(navIdent)) {
        return { fieldErrors: { nav_ident: 'Ugyldig NAV-ident-format' } }
      }
      // Full delete: revokes all role assignments atomically in one transaction.
      // This covers users with and without a GitHub account.
      await deleteUser(navIdent, admin.navIdent)
    } else if (normalized) {
      if (!isValidGitHubUsername(normalized)) {
        return { fieldErrors: { github_username: 'Ugyldig GitHub brukernavn' } }
      }
      // No nav_ident — unlinked deployer with only a GitHub account (no NAV identity).
      // Only the GitHub account row is removed; no role assignments exist for these accounts.
      await deleteUserMapping(normalized, admin.navIdent)
    } else {
      return { fieldErrors: { github_username: 'GitHub brukernavn eller NAV-ident er påkrevd' } }
    }
    return { success: true }
  }

  if (intent === 'unlink-github') {
    const githubUsernameRaw = getFormString(formData, 'github_username')
    const normalized = githubUsernameRaw?.trim() ?? ''
    if (!normalized || !isValidGitHubUsername(normalized)) {
      return { fieldErrors: { github_username: 'Ugyldig GitHub brukernavn' } }
    }
    // Unlink GitHub account from user without deleting the user row or revoking roles.
    await deleteUserMapping(normalized, admin.navIdent)
    return { success: true }
  }

  if (intent === 'create-user') {
    const navIdentRaw = getFormString(formData, 'nav_ident')?.toUpperCase() || null
    const fieldErrors: { nav_ident?: string } = {}

    if (!navIdentRaw) {
      fieldErrors.nav_ident = 'NAV-ident er påkrevd'
    } else if (!isValidNavIdent(navIdentRaw)) {
      fieldErrors.nav_ident = 'Må være én bokstav etterfulgt av 6 siffer'
    }

    if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

    const navIdent = navIdentRaw as string
    let graphResults: Awaited<ReturnType<typeof searchGraphUsers>>
    try {
      graphResults = await searchGraphUsers(navIdent)
    } catch (error) {
      logger.error('Graph API lookup failed during user creation', error)
      return { fieldErrors: { nav_ident: 'Kunne ikke verifisere NAV-ident (Graph API utilgjengelig)' } }
    }

    const graphUser = graphResults.find((u) => u.navIdent?.toUpperCase() === navIdent.toUpperCase())
    if (!graphUser) {
      return { fieldErrors: { nav_ident: 'NAV-ident ble ikke funnet i Active Directory' } }
    }
    if (!graphUser.displayName) {
      return { fieldErrors: { nav_ident: 'Brukeren mangler visningsnavn i Active Directory' } }
    }
    if (!graphUser.email) {
      return { fieldErrors: { nav_ident: 'Brukeren mangler e-postadresse i Active Directory' } }
    }

    await upsertUser({
      navIdent,
      displayName: formatDisplayNameNatural(graphUser.displayName),
      navEmail: graphUser.email,
      slackMemberId: getFormString(formData, 'slack_member_id') || null,
    })
    return { success: true }
  }

  if (intent === 'create-mapping') {
    const githubUsernameRaw = getFormString(formData, 'github_username') || ''
    const githubUsername = githubUsernameRaw.toLowerCase()
    const navIdentRaw = getFormString(formData, 'nav_ident')?.toUpperCase() || null

    const fieldErrors: { github_username?: string; nav_email?: string; nav_ident?: string } = {}

    if (githubUsername) {
      if (!isValidGitHubUsername(githubUsername)) {
        fieldErrors.github_username = 'Ugyldig GitHub-brukernavn (kun bokstaver, tall og bindestrek)'
      } else if (isGitHubBot(githubUsername)) {
        fieldErrors.github_username = 'Kan ikke opprette mapping for GitHub-botkontoer'
      }
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
    if (!graphUser.displayName) {
      return { fieldErrors: { nav_ident: 'Brukeren mangler visningsnavn i Active Directory' } }
    }
    if (!graphUser.email) {
      return { fieldErrors: { nav_ident: 'Brukeren mangler e-postadresse i Active Directory' } }
    }

    const displayName = formatDisplayNameNatural(graphUser.displayName)
    const navEmail = graphUser.email
    const slackMemberId = getFormString(formData, 'slack_member_id') || null

    if (githubUsername) {
      await upsertUserMapping({
        githubUsername,
        displayGithubUsername: githubUsernameRaw,
        displayName,
        navEmail,
        navIdent,
        slackMemberId,
      })
    } else {
      await upsertUser({ navIdent, displayName, navEmail, slackMemberId })
    }
    return { success: true }
  }

  if (intent === 'update-user') {
    // Update profile fields for a user identified by nav_ident only.
    // Used by the edit modal for users without a GitHub account.
    const navIdentRaw = getFormString(formData, 'nav_ident')?.toUpperCase() || null
    const fieldErrors: { nav_ident?: string } = {}

    if (!navIdentRaw) {
      fieldErrors.nav_ident = 'NAV-ident er påkrevd'
    } else if (!isValidNavIdent(navIdentRaw)) {
      fieldErrors.nav_ident = 'Må være én bokstav etterfulgt av 6 siffer'
    }

    if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

    const navIdent = navIdentRaw as string

    // Guard: update-user must only modify existing active users, never create or revive.
    // Without this check, a crafted POST could bypass the Graph API verification
    // enforced by create-user and create-mapping.
    const existingUser = await getUserMappingByNavIdent(navIdent)
    if (!existingUser) {
      return { fieldErrors: { nav_ident: 'Bruker finnes ikke eller er slettet' } }
    }

    const navEmail = getFormString(formData, 'nav_email')
    if (!navEmail) {
      return { fieldErrors: { nav_email: 'E-post er påkrevd' } }
    }
    if (!isValidEmail(navEmail)) {
      return { fieldErrors: { nav_email: 'Ugyldig e-postformat' } }
    }

    const displayName = getFormString(formData, 'display_name')
    if (!displayName) {
      return { fieldErrors: { display_name: 'Navn er påkrevd' } }
    }

    await upsertUser({
      navIdent,
      displayName,
      navEmail,
      slackMemberId: getFormString(formData, 'slack_member_id'),
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
      displayGithubUsername: null,
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
              <input type="hidden" name="intent" value={editMapping.github_username ? 'upsert' : 'update-user'} />
              <input type="hidden" name="github_username" value={editMapping.github_username ?? ''} />
              {/* nav_ident is the primary key and must not change — send as hidden for update-user intent */}
              {!editMapping.github_username && (
                <input type="hidden" name="nav_ident" value={editMapping.nav_ident ?? ''} />
              )}
              <VStack gap="space-16">
                <TextField
                  label="GitHub brukernavn"
                  value={editMapping.display_github_username || editMapping.github_username || ''}
                  disabled
                />
                <TextField
                  label="Navn"
                  name="display_name"
                  defaultValue={editMapping.display_name || ''}
                  error={
                    actionData && 'fieldErrors' in actionData
                      ? (actionData.fieldErrors as Record<string, string | undefined>)?.display_name
                      : undefined
                  }
                />
                <TextField
                  label="Nav e-post"
                  name="nav_email"
                  defaultValue={editMapping.nav_email || ''}
                  error={
                    actionData && 'fieldErrors' in actionData
                      ? (actionData.fieldErrors as Record<string, string | undefined>)?.nav_email
                      : undefined
                  }
                />
                <TextField
                  label="Nav-ident"
                  name={editMapping.github_username ? 'nav_ident' : undefined}
                  description="Format: én bokstav etterfulgt av 6 siffer (f.eks. A123456)"
                  defaultValue={editMapping.nav_ident || ''}
                  disabled={!editMapping.github_username}
                  error={
                    actionData && 'fieldErrors' in actionData
                      ? (actionData.fieldErrors as Record<string, string | undefined>)?.nav_ident
                      : undefined
                  }
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
