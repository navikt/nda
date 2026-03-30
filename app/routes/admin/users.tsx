import { DownloadIcon, ExternalLinkIcon, PencilIcon, PlusIcon, TrashIcon, UploadIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Detail,
  Heading,
  HStack,
  Modal,
  Show,
  Tag,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Form, Link, useActionData, useLoaderData, useNavigation } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { getAllDevTeams } from '~/db/dev-teams.server'
import { getAllUserDevTeamMappings, setUserDevTeams } from '~/db/user-dev-team-preference.server'
import {
  deleteUserMapping,
  getAllUserMappings,
  getUnmappedUsers,
  type UserMapping,
  upsertUserMapping,
} from '~/db/user-mappings.server'
import { requireAdmin } from '~/lib/auth.server'
import { isValidEmail, isValidNavIdent } from '~/lib/form-validators'
import { isGitHubBot } from '~/lib/github-bots'
import styles from '~/styles/common.module.css'
import type { Route } from './+types/users'

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const [mappings, unmappedUsers, allDevTeams, userDevTeamMap] = await Promise.all([
    getAllUserMappings(),
    getUnmappedUsers(),
    getAllDevTeams(),
    getAllUserDevTeamMappings().catch(() => new Map<string, number[]>()),
  ])
  return { mappings, unmappedUsers, allDevTeams, userDevTeamMap: Object.fromEntries(userDevTeamMap) }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'delete') {
    const githubUsername = formData.get('github_username') as string
    await deleteUserMapping(githubUsername)
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

  if (intent === 'set-dev-teams') {
    const navIdent = formData.get('nav_ident') as string
    if (!navIdent) return { error: 'Nav-ident er påkrevd' }
    const devTeamIds = formData.getAll('dev_team_ids').map(Number).filter(Boolean)
    try {
      await setUserDevTeams(navIdent, devTeamIds)
    } catch {
      return { error: 'Kunne ikke oppdatere teamtilhørighet.' }
    }
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
  const { mappings, unmappedUsers, allDevTeams, userDevTeamMap } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  const [editMapping, setEditMapping] = useState<UserMapping | null>(null)
  const [addFormKey, setAddFormKey] = useState(0)
  const [prefillUsername, setPrefillUsername] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<UserMapping | null>(null)
  const [teamsTarget, setTeamsTarget] = useState<UserMapping | null>(null)
  const deleteModalRef = useRef<HTMLDialogElement>(null)
  const modalRef = useRef<HTMLDialogElement>(null)
  const addModalRef = useRef<HTMLDialogElement>(null)
  const teamsModalRef = useRef<HTMLDialogElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const devTeamById = new Map(allDevTeams.map((t) => [t.id, t]))

  // Reset add form and close modals when action succeeds
  useEffect(() => {
    if (actionData?.success && navigation.state === 'idle') {
      setAddFormKey((k) => k + 1)
      addModalRef.current?.close()
      modalRef.current?.close()
      deleteModalRef.current?.close()
      teamsModalRef.current?.close()
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
        </HStack>

        <BodyShort textColor="subtle">
          Kobler GitHub-brukernavn til Nav-identitet og Slack for visning i deployment-oversikten.
        </BodyShort>

        {/* Success message from import */}
        {actionData?.message && (
          <Alert variant="success" closeButton>
            {actionData.message}
          </Alert>
        )}

        <ActionAlert data={actionData} />

        {/* Warning alert for unmapped users */}
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
                  {/* First row: Display name heading, actions */}
                  <HStack gap="space-8" align="center" justify="space-between" wrap>
                    <Link to={`/users/${mapping.github_username}`} style={{ textDecoration: 'none' }}>
                      <Heading level="3" size="xsmall">
                        {mapping.display_name || mapping.github_username}
                      </Heading>
                    </Link>
                    <HStack gap="space-8">
                      <Button
                        variant="tertiary"
                        size="small"
                        icon={<PencilIcon aria-hidden />}
                        onClick={() => openEdit(mapping)}
                      >
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

                  {/* Details row */}
                  <HStack gap="space-16" wrap>
                    <a href={`https://github.com/${mapping.github_username}`} target="_blank" rel="noopener noreferrer">
                      <Detail textColor="subtle">
                        GitHub: {mapping.github_username} <ExternalLinkIcon aria-hidden fontSize="0.75rem" />
                      </Detail>
                    </a>
                    {mapping.nav_email && <Detail textColor="subtle">{mapping.nav_email}</Detail>}
                    {mapping.nav_ident && (
                      <a
                        href={`https://teamkatalogen.nav.no/resource/${mapping.nav_ident}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Detail textColor="subtle">
                          Teamkatalogen: {mapping.nav_ident} <ExternalLinkIcon aria-hidden fontSize="0.75rem" />
                        </Detail>
                      </a>
                    )}
                    {mapping.slack_member_id && (
                      <a
                        href={`https://nav-it.slack.com/team/${mapping.slack_member_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Detail textColor="subtle">
                          Slack: {mapping.slack_member_id} <ExternalLinkIcon aria-hidden fontSize="0.75rem" />
                        </Detail>
                      </a>
                    )}
                    {!mapping.nav_email && !mapping.nav_ident && !mapping.slack_member_id && (
                      <Detail textColor="subtle">Ingen tilleggsinformasjon</Detail>
                    )}
                  </HStack>

                  {/* Dev team row */}
                  {mapping.nav_ident && (
                    <HStack gap="space-8" align="center" wrap>
                      <Detail textColor="subtle">Team:</Detail>
                      {(userDevTeamMap[mapping.nav_ident] ?? []).length > 0 ? (
                        (userDevTeamMap[mapping.nav_ident] ?? []).map((teamId) => {
                          const team = devTeamById.get(teamId)
                          return team ? (
                            <Tag key={teamId} variant="moderate" size="xsmall">
                              {team.name}
                            </Tag>
                          ) : null
                        })
                      ) : (
                        <Detail textColor="subtle">Ingen team</Detail>
                      )}
                      <Button
                        variant="tertiary"
                        size="xsmall"
                        icon={<PencilIcon aria-hidden />}
                        onClick={() => {
                          setTeamsTarget(mapping)
                          teamsModalRef.current?.showModal()
                        }}
                      >
                        Endre
                      </Button>
                    </HStack>
                  )}
                </VStack>
              </Box>
            ))}
          </div>
        )}

        {/* Unmapped users section at bottom */}
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
                    <Button
                      variant="secondary"
                      size="small"
                      icon={<PlusIcon aria-hidden />}
                      onClick={() => openAddWithUsername(user.github_username)}
                    >
                      <Show above="sm">Legg til mapping</Show>
                    </Button>
                  </HStack>
                </Box>
              ))}
            </div>
          </VStack>
        )}

        {/* Add Modal */}
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

        {/* Dev Teams Modal */}
        <Modal
          ref={teamsModalRef}
          header={{ heading: `Teamtilhørighet — ${teamsTarget?.display_name || teamsTarget?.github_username || ''}` }}
          width="medium"
          onClose={() => setTeamsTarget(null)}
        >
          <Modal.Body>
            {teamsTarget?.nav_ident && (
              <Form method="post" id="teams-form">
                <input type="hidden" name="intent" value="set-dev-teams" />
                <input type="hidden" name="nav_ident" value={teamsTarget.nav_ident} />
                <CheckboxGroup legend="Velg utviklingsteam" size="small">
                  {allDevTeams.map((team) => (
                    <Checkbox
                      key={team.id}
                      name="dev_team_ids"
                      value={String(team.id)}
                      defaultChecked={(userDevTeamMap[teamsTarget.nav_ident ?? ''] ?? []).includes(team.id)}
                    >
                      {team.name}
                    </Checkbox>
                  ))}
                </CheckboxGroup>
              </Form>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button type="submit" form="teams-form" loading={isSubmitting}>
              Lagre
            </Button>
            <Button variant="secondary" onClick={() => teamsModalRef.current?.close()}>
              Avbryt
            </Button>
          </Modal.Footer>
        </Modal>
      </VStack>
    </Box>
  )
}
