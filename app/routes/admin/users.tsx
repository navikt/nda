import { Alert, BodyShort, Box, Button, Heading, HStack, Modal, TextField, VStack } from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router'
import { AdminUsersPage } from '~/components/AdminUsersPage'
import { CreateMappingModal } from '~/components/CreateMappingModal'
import { pool } from '~/db/connection.server'
import { getAllDevTeams } from '~/db/dev-teams.server'
import { getAllSectionRoleAssignments, getAllUserRoleAssignments } from '~/db/role-assignments.server'
import {
  getAllUsersWithAccounts,
  getUnmappedDeployers,
  getUsersWithoutGithub,
  populateUsersFromGraph,
  softDeleteGithubAccount,
  type UserWithAccount,
  upsertUser,
  upsertUserAndGithubAccount,
} from '~/db/user-github-lookups.server'
import { requireAdmin } from '~/lib/auth.server'
import { getFormString, isValidEmail, isValidGitHubUsername, isValidNavIdent } from '~/lib/form-validators'
import { isGitHubBot } from '~/lib/github-bots'
import { logger } from '~/lib/logger.server'
import { searchGraphUsers } from '~/lib/microsoft-graph.server'
import { formatDisplayNameNatural } from '~/lib/user-display'
import styles from '~/styles/common.module.css'
import type { Route } from './+types/users'

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const [
    mappings,
    unmappedUsers,
    usersWithoutGithub,
    allDevTeams,
    userRoleAssignments,
    userSectionRoleAssignments,
    usersCountResult,
  ] = await Promise.all([
    getAllUsersWithAccounts(),
    getUnmappedDeployers(),
    getUsersWithoutGithub(),
    getAllDevTeams(),
    getAllUserRoleAssignments().catch(() => new Map<string, Array<{ dev_team_id: number; role: string }>>()),
    getAllSectionRoleAssignments().catch(
      () => new Map<string, Array<{ section_id: number; section_name: string; role: string }>>(),
    ),
    pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users WHERE deleted_at IS NULL'),
  ])
  return {
    mappings,
    unmappedUsers,
    usersWithoutGithub,
    allDevTeams,
    userRoleAssignments: Object.fromEntries(userRoleAssignments),
    userSectionRoleAssignments: Object.fromEntries(userSectionRoleAssignments),
    usersCount: parseInt(usersCountResult.rows[0].count, 10),
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
    const deleted = await softDeleteGithubAccount(normalized, admin.navIdent)
    if (!deleted) {
      return { error: 'GitHub-kontoen ble ikke funnet eller er allerede slettet' }
    }
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

    if (Object.keys(fieldErrors).length > 0) {
      return { createUserFieldErrors: fieldErrors }
    }

    const navIdent = navIdentRaw as string
    let graphResults: Awaited<ReturnType<typeof searchGraphUsers>>
    try {
      graphResults = await searchGraphUsers(navIdent)
    } catch (error) {
      logger.error('Graph API lookup failed during create-user', error)
      return { createUserFieldErrors: { nav_ident: 'Kunne ikke verifisere NAV-ident (Graph API utilgjengelig)' } }
    }

    const graphUser = graphResults.find((u) => u.navIdent?.toUpperCase() === navIdent.toUpperCase())
    if (!graphUser) {
      return { createUserFieldErrors: { nav_ident: 'NAV-ident ble ikke funnet i Active Directory' } }
    }

    const displayName = graphUser.displayName ? formatDisplayNameNatural(graphUser.displayName) : null
    const navEmail = graphUser.email ?? null

    if (!displayName || !navEmail) {
      return { createUserFieldErrors: { nav_ident: 'Brukeren mangler navn eller e-post i Active Directory' } }
    }

    await upsertUser({ navIdent, displayName, navEmail })
    return { createUserSuccess: true, createUserNavIdent: navIdent }
  }

  if (intent === 'create-mapping') {
    const githubUsernameRaw = getFormString(formData, 'github_username') || ''
    const githubUsername = githubUsernameRaw.toLowerCase()
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

    await upsertUserAndGithubAccount({
      githubUsername,
      displayGithubUsername: githubUsernameRaw,
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

    await upsertUserAndGithubAccount({
      githubUsername,
      displayGithubUsername: null,
      displayName: getFormString(formData, 'display_name') || null,
      navEmail,
      navIdent,
      slackMemberId: getFormString(formData, 'slack_member_id') || null,
    })
    return { success: true }
  }
  if (intent === 'populate-users') {
    try {
      const result = await populateUsersFromGraph()
      return {
        success: true,
        message: `Importerte ${result.success} brukere fra Graph API (${result.skipped} hoppet over, ${result.errors} feil)`,
      }
    } catch (error) {
      logger.error('populate-users action failed', error)
      return { error: 'Kunne ikke importere brukere fra Graph API' }
    }
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
        if (!mapping.github_username || typeof mapping.github_username !== 'string') continue
        await upsertUserAndGithubAccount({
          githubUsername: mapping.github_username,
          displayName: typeof mapping.display_name === 'string' ? mapping.display_name || null : null,
          navEmail: typeof mapping.nav_email === 'string' ? mapping.nav_email || null : null,
          navIdent: typeof mapping.nav_ident === 'string' ? mapping.nav_ident || null : null,
          slackMemberId: typeof mapping.slack_member_id === 'string' ? mapping.slack_member_id || null : null,
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
  const {
    mappings,
    unmappedUsers,
    usersWithoutGithub,
    allDevTeams,
    userRoleAssignments,
    userSectionRoleAssignments,
    usersCount,
  } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  const [editMapping, setEditMapping] = useState<UserWithAccount | null>(null)
  const [addFormKey, setAddFormKey] = useState(0)
  const [addModalTrigger, setAddModalTrigger] = useState(0)
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

  // Open add modal after remount triggered by key change
  useEffect(() => {
    if (addModalTrigger > 0) {
      addModalRef.current?.showModal()
    }
  }, [addModalTrigger])

  const openEdit = (mapping: UserWithAccount) => {
    setEditMapping(mapping)
    modalRef.current?.showModal()
  }

  const openAdd = () => {
    setPrefillUsername('')
    setAddFormKey((k) => k + 1)
    setAddModalTrigger((t) => t + 1)
  }

  const openAddWithUsername = (username: string) => {
    setPrefillUsername(username)
    setAddFormKey((k) => k + 1)
    setAddModalTrigger((t) => t + 1)
  }

  const isPopulating = navigation.state === 'submitting' && navigation.formData?.get('intent') === 'populate-users'

  return (
    <>
      <VStack gap="space-16">
        <div>
          <Heading level="2" size="small" spacing>
            Importer brukere fra Entra ID
          </Heading>
          <VStack gap="space-8">
            <p>
              Henter alle aktive NAV-identer fra <code>users</code>-tabellen, slår opp i Graph API og oppdaterer
              brukerdata. Idempotent — trygt å kjøre flere ganger.
              {usersCount > 0 && ` (${usersCount} brukere i tabellen nå)`}
            </p>
            {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}
            {actionData?.message && <Alert variant="success">{actionData.message}</Alert>}
            <HStack>
              <Form method="post">
                <input type="hidden" name="intent" value="populate-users" />
                <Button type="submit" variant="secondary" loading={isPopulating}>
                  Importer brukere fra Graph API
                </Button>
              </Form>
            </HStack>
          </VStack>
        </div>

        <div>
          <Heading level="2" size="small" spacing>
            Legg til bruker uten GitHub-konto
          </Heading>
          <VStack gap="space-8">
            <p>
              Opprett en bruker i <code>users</code>-tabellen kun fra NAV-ident — uten å kreve GitHub-konto. Nyttig for
              produktledere og andre som ikke bruker GitHub. GitHub-konto kan kobles til på et senere tidspunkt.
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="create-user" />
              <HStack gap="space-4" align="end">
                <TextField
                  label="NAV-ident"
                  name="nav_ident"
                  placeholder="A123456"
                  size="small"
                  error={actionData?.createUserFieldErrors?.nav_ident}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="small"
                  loading={navigation.state === 'submitting' && navigation.formData?.get('intent') === 'create-user'}
                >
                  Legg til bruker
                </Button>
              </HStack>
            </Form>
            {actionData?.createUserSuccess && (
              <Alert variant="success">{actionData.createUserNavIdent} er lagt til i brukerdatabasen.</Alert>
            )}
          </VStack>
        </div>

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

        {usersWithoutGithub.length > 0 && (
          <div>
            <Heading level="2" size="medium" spacing>
              Brukere uten GitHub-konto ({usersWithoutGithub.length})
            </Heading>
            <div>
              {usersWithoutGithub.map((u) => (
                <Box key={u.nav_ident} padding="space-16" background="raised" className={styles.stackedListItem}>
                  <HStack justify="space-between" align="center">
                    <VStack gap="space-2">
                      <BodyShort weight="semibold">{u.display_name}</BodyShort>
                      <BodyShort size="small" textColor="subtle">
                        {u.nav_ident} · {u.nav_email}
                      </BodyShort>
                    </VStack>
                  </HStack>
                </Box>
              ))}
            </div>
          </div>
        )}
      </VStack>

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
                <TextField
                  label="GitHub brukernavn"
                  value={editMapping.display_github_username || editMapping.github_username}
                  disabled
                />
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
