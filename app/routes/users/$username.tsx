import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, LinkIcon, PlusIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Detail,
  Heading,
  HGrid,
  HStack,
  Modal,
  Radio,
  RadioGroup,
  Select,
  Tag,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from 'react-router'
import { DeploymentActivityChart } from '~/components/DeploymentActivityChart'
import { MethodTag, StatusTag } from '~/components/deployment-tags'
import { getBoardsWithGoalsForDevTeam } from '~/db/boards.server'
import { bulkAddDeploymentGoalLinks, getUnlinkedDependabotDeploymentIds } from '~/db/deployment-goal-links.server'
import {
  type DeployerTableFilters,
  getDeployerApps,
  getDeployerDeploymentsPaginated,
  getDeployerMonthlyStats,
  getDeploymentCountByDeployer,
} from '~/db/deployments.server'
import { getAllDevTeams } from '~/db/dev-teams.server'
import { getAllSectionsWithTeams } from '~/db/sections.server'
import { addUserDevTeam, getUserDevTeams, removeUserDevTeam } from '~/db/user-dev-team-preference.server'
import { getUserMapping, upsertUserMapping } from '~/db/user-mappings.server'
import { getUserLandingPage, setUserLandingPage } from '~/db/user-settings.server'
import { requireUser } from '~/lib/auth.server'
import { isValidEmail, isValidNavIdent } from '~/lib/form-validators'
import type { FourEyesStatus } from '~/lib/four-eyes-status'
import { getBotDescription, getBotDisplayName, isGitHubBot } from '~/lib/github-bots'
import { getDateRangeForPeriod, TIME_PERIOD_OPTIONS, type TimePeriod } from '~/lib/time-periods'
import styles from '~/styles/common.module.css'
import type { Route } from './+types/$username'

export function meta({ data }: { data: { username: string } }) {
  return [{ title: `${data?.username || 'Bruker'} - NDA` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const identity = await requireUser(request)
  const username = params.username
  if (!username) {
    throw new Response('Username required', { status: 400 })
  }

  const url = new URL(request.url)
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10))
  const period = (url.searchParams.get('period') || 'all') as TimePeriod
  const dateRange = getDateRangeForPeriod(period)

  const goalFilter = (url.searchParams.get('goal') || 'all') as DeployerTableFilters['goal']
  const dependabotFilter = (url.searchParams.get('dependabot') || 'all') as DeployerTableFilters['dependabot']
  const approvalFilter = (url.searchParams.get('approval') || 'all') as DeployerTableFilters['approval']
  const appFilter = url.searchParams.get('app') || ''

  const filters: DeployerTableFilters = {
    goal: goalFilter,
    dependabot: dependabotFilter,
    approval: approvalFilter,
    appName: appFilter || undefined,
  }
  const hasFilters = goalFilter !== 'all' || dependabotFilter !== 'all' || approvalFilter !== 'all' || !!appFilter

  const isBot = isGitHubBot(username)
  const botDisplayName = getBotDisplayName(username)
  const botDescription = getBotDescription(username)

  const [mapping, deploymentCount, paginatedDeployments, monthlyStats, deployerApps] = await Promise.all([
    isBot ? Promise.resolve(null) : getUserMapping(username),
    getDeploymentCountByDeployer(username),
    getDeployerDeploymentsPaginated(username, page, 20, dateRange?.startDate, dateRange?.endDate, filters),
    getDeployerMonthlyStats(username, dateRange?.startDate, dateRange?.endDate),
    getDeployerApps(username),
  ])

  // Check if this is the logged-in user's own profile
  const isOwnProfile = !isBot && mapping?.nav_ident === identity.navIdent

  // Fetch dev teams if user has a nav_ident
  let devTeams: Awaited<ReturnType<typeof getUserDevTeams>> = []
  if (mapping?.nav_ident) {
    try {
      devTeams = await getUserDevTeams(mapping.nav_ident)
    } catch {
      // Table may not exist yet
    }
  }

  // Load available boards for bulk goal linking
  type BoardWithGoals = Awaited<ReturnType<typeof getBoardsWithGoalsForDevTeam>>[number] & { dev_team_name: string }
  let availableBoards: BoardWithGoals[] = []
  if (devTeams.length > 0) {
    const boardsPerTeam = await Promise.all(devTeams.map((dt) => getBoardsWithGoalsForDevTeam(dt.id)))
    availableBoards = boardsPerTeam.flatMap((boards, i) =>
      boards.map((b) => ({ ...b, dev_team_name: devTeams[i].name })),
    )
  }

  // Fetch all available teams if viewing own profile
  let availableDevTeams: Awaited<ReturnType<typeof getAllDevTeams>> = []
  let landingPage = 'my-teams'
  let allSections: { slug: string; name: string }[] = []
  if (isOwnProfile) {
    availableDevTeams = await getAllDevTeams()
    try {
      const [lp, sections] = await Promise.all([getUserLandingPage(identity.navIdent), getAllSectionsWithTeams()])
      landingPage = lp
      allSections = sections.map((s) => ({ slug: s.slug, name: s.name }))
    } catch {
      // user_settings table may not exist yet
    }
  }

  return {
    username,
    mapping,
    deploymentCount,
    paginatedDeployments,
    monthlyStats,
    period,
    goalFilter: goalFilter ?? 'all',
    dependabotFilter: dependabotFilter ?? 'all',
    approvalFilter: approvalFilter ?? 'all',
    appFilter,
    hasFilters,
    deployerApps,
    isBot,
    botDisplayName,
    botDescription,
    devTeams,
    availableBoards,
    isOwnProfile,
    availableDevTeams,
    landingPage,
    allSections,
  }
}

export async function action({ request }: Route.ActionArgs) {
  const identity = await requireUser(request)
  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'add-dev-team') {
    const devTeamId = Number(formData.get('devTeamId'))
    if (!devTeamId || Number.isNaN(devTeamId)) {
      return { error: 'Ugyldig team-valg' }
    }
    try {
      await addUserDevTeam(identity.navIdent, devTeamId)
    } catch {
      return { error: 'Kunne ikke legge til team.' }
    }
    return { success: true }
  }

  if (intent === 'remove-dev-team') {
    const devTeamId = Number(formData.get('devTeamId'))
    if (!devTeamId || Number.isNaN(devTeamId)) {
      return { error: 'Ugyldig team-valg' }
    }
    try {
      await removeUserDevTeam(identity.navIdent, devTeamId)
    } catch {
      return { error: 'Kunne ikke fjerne team.' }
    }
    return { success: true }
  }

  if (intent === 'set-landing-page') {
    const landingPage = formData.get('landingPage') as string
    if (!landingPage) {
      return { error: 'Landingsside er påkrevd' }
    }
    try {
      await setUserLandingPage(identity.navIdent, landingPage as Parameters<typeof setUserLandingPage>[1])
    } catch {
      return { error: 'Kunne ikke lagre landingsside.' }
    }
    return { success: true }
  }

  if (intent === 'bulk_link_goal') {
    const username = formData.get('username') as string
    const objectiveId = formData.get('objective_id') ? Number(formData.get('objective_id')) : undefined
    const keyResultId = formData.get('key_result_id') ? Number(formData.get('key_result_id')) : undefined
    const periodValue = (formData.get('period') || 'all') as TimePeriod
    const appName = (formData.get('app_name') as string) || undefined

    if (!username) return { error: 'Brukernavn mangler.' }
    if (!objectiveId && !keyResultId) return { error: 'Velg et mål eller nøkkelresultat.' }

    const dateRange = getDateRangeForPeriod(periodValue)
    const deploymentIds = await getUnlinkedDependabotDeploymentIds(
      username,
      dateRange?.startDate,
      dateRange?.endDate,
      appName,
    )

    if (deploymentIds.length === 0) {
      return { error: 'Ingen Dependabot-leveranser uten endringsopphav funnet.' }
    }

    try {
      const linked = await bulkAddDeploymentGoalLinks(
        deploymentIds,
        { objective_id: objectiveId, key_result_id: keyResultId },
        identity.navIdent,
      )
      return { success: `Koblet ${linked} Dependabot-leveranser til endringsopphav.` }
    } catch {
      return { error: 'Kunne ikke koble leveranser.' }
    }
  }

  if (intent === 'create-mapping') {
    const githubUsername = formData.get('github_username') as string
    const navEmail = (formData.get('nav_email') as string) || null
    const navIdent = (formData.get('nav_ident') as string) || null

    const fieldErrors: { nav_email?: string; nav_ident?: string } = {}

    if (!githubUsername) {
      return { error: 'GitHub brukernavn er påkrevd' }
    }

    if (isGitHubBot(githubUsername)) {
      return { error: 'Kan ikke opprette mapping for GitHub-botkontoer' }
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

  return { error: 'Ukjent handling' }
}

export default function UserPage() {
  const {
    username,
    mapping,
    deploymentCount,
    paginatedDeployments,
    monthlyStats,
    period,
    goalFilter,
    dependabotFilter,
    approvalFilter,
    appFilter,
    hasFilters,
    deployerApps,
    isBot,
    botDisplayName,
    botDescription,
    devTeams,
    availableBoards,
    isOwnProfile,
    availableDevTeams,
    landingPage,
    allSections,
  } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'
  const modalRef = useRef<HTMLDialogElement>(null)
  const bulkLinkRef = useRef<HTMLDialogElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const updateFilter = (key: string, value: string, defaultValue: string) => {
    const params = new URLSearchParams(searchParams)
    if (value === defaultValue) {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    params.delete('page')
    setSearchParams(params)
  }

  // Close modals when action succeeds
  useEffect(() => {
    if (actionData?.success && navigation.state === 'idle') {
      modalRef.current?.close()
      bulkLinkRef.current?.close()
    }
  }, [actionData, navigation.state])

  const formatDate = (date: string | Date) => {
    const d = new Date(date)
    return d.toLocaleDateString('nb-NO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <VStack gap="space-32">
      {/* Header */}
      <VStack gap="space-8">
        <HStack gap="space-12" align="center">
          <Heading level="1" size="large">
            {mapping?.display_name || botDisplayName || username}
          </Heading>
          {isBot && (
            <Tag variant="neutral" size="small">
              Bot
            </Tag>
          )}
        </HStack>
        {isBot && botDescription && <BodyShort textColor="subtle">{botDescription}</BodyShort>}
      </VStack>

      {/* Stats and links */}
      <HGrid gap="space-16" columns={{ xs: 2, md: 4 }}>
        <Box padding="space-16" borderRadius="8" background="sunken">
          <VStack gap="space-4">
            <Detail textColor="subtle">GitHub</Detail>
            <AkselLink href={`https://github.com/${username}`} target="_blank">
              {username} <ExternalLinkIcon aria-hidden />
            </AkselLink>
          </VStack>
        </Box>

        {mapping?.nav_email && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">E-post</Detail>
              <BodyShort>{mapping.nav_email}</BodyShort>
            </VStack>
          </Box>
        )}

        {mapping?.nav_ident && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">Teamkatalogen</Detail>
              <AkselLink href={`https://teamkatalogen.nav.no/resource/${mapping.nav_ident}`} target="_blank">
                {mapping.nav_ident} <ExternalLinkIcon aria-hidden />
              </AkselLink>
            </VStack>
          </Box>
        )}

        {mapping?.slack_member_id && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">Slack</Detail>
              <AkselLink href={`https://nav-it.slack.com/team/${mapping.slack_member_id}`} target="_blank">
                Åpne i Slack <ExternalLinkIcon aria-hidden />
              </AkselLink>
            </VStack>
          </Box>
        )}
      </HGrid>

      {/* Dev team memberships */}
      {isOwnProfile && availableDevTeams.length > 0 ? (
        <VStack gap="space-12">
          <Heading level="2" size="small">
            Mine utviklingsteam
          </Heading>
          <Box background="raised" padding="space-16" borderRadius="4">
            <CheckboxGroup legend="Velg team du tilhører" hideLegend>
              <HStack gap="space-16" wrap>
                {availableDevTeams.map((team) => {
                  const isSelected = devTeams.some((t) => t.id === team.id)
                  return (
                    <Form method="post" key={team.id}>
                      <input type="hidden" name="intent" value={isSelected ? 'remove-dev-team' : 'add-dev-team'} />
                      <input type="hidden" name="devTeamId" value={team.id} />
                      <Checkbox
                        value={String(team.id)}
                        checked={isSelected}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      >
                        {team.name}
                      </Checkbox>
                    </Form>
                  )
                })}
              </HStack>
            </CheckboxGroup>
          </Box>
        </VStack>
      ) : (
        devTeams.length > 0 && (
          <VStack gap="space-8">
            <Detail textColor="subtle">Utviklingsteam</Detail>
            <HStack gap="space-8" wrap>
              {devTeams.map((team) => (
                <Tag key={team.id} variant="moderate" size="small">
                  <Link
                    to={`/sections/${team.section_slug}/teams/${team.slug}`}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    {team.name}
                  </Link>
                </Tag>
              ))}
            </HStack>
          </VStack>
        )
      )}

      {/* Landing page preference — only for own profile */}
      {isOwnProfile && (
        <VStack gap="space-12">
          <Heading level="2" size="small">
            Landingsside
          </Heading>
          <Box background="raised" padding="space-16" borderRadius="4">
            <RadioGroup
              legend="Velg hvilken side som vises når du åpner Deployment Audit"
              hideLegend
              value={landingPage}
              onChange={(value) => {
                const form = document.getElementById('landing-page-form') as HTMLFormElement | null
                const input = form?.querySelector<HTMLInputElement>('input[name="landingPage"]')
                if (input && form) {
                  input.value = value
                  form.requestSubmit()
                }
              }}
            >
              <Radio value="my-teams">Mine team</Radio>
              <Radio value="sections">Alle seksjoner</Radio>
              {allSections.map((section) => (
                <Radio key={section.slug} value={`sections/${section.slug}`}>
                  {section.name}
                </Radio>
              ))}
            </RadioGroup>
            <Form method="post" id="landing-page-form" style={{ display: 'none' }}>
              <input type="hidden" name="intent" value="set-landing-page" />
              <input type="hidden" name="landingPage" value={landingPage} />
            </Form>
          </Box>
        </VStack>
      )}

      {/* No mapping warning - only for non-bots */}
      {!mapping && !isBot && (
        <Alert variant="warning">
          <HStack gap="space-16" align="center" justify="space-between" wrap>
            <BodyShort>Ingen brukermapping funnet for denne brukeren.</BodyShort>
            <Button
              variant="secondary"
              size="small"
              icon={<PlusIcon aria-hidden />}
              onClick={() => modalRef.current?.showModal()}
            >
              Opprett mapping
            </Button>
          </HStack>
        </Alert>
      )}

      {/* Time period selector + chart + deployments */}
      <VStack gap="space-24">
        <HStack justify="space-between" align="end" wrap>
          <Heading level="2" size="small">
            Leveranser {hasFilters ? `(${paginatedDeployments.total} av ${deploymentCount})` : `(${deploymentCount})`}
          </Heading>
          <Select
            label="Tidsperiode"
            size="small"
            value={period}
            onChange={(e) => {
              const params = new URLSearchParams(searchParams)
              params.set('period', e.target.value)
              params.delete('page')
              setSearchParams(params)
            }}
            style={{ width: '14rem' }}
          >
            {TIME_PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </HStack>

        {/* Deployment activity chart */}
        {monthlyStats.length > 0 && (
          <Box background="raised" padding="space-16" borderRadius="4">
            <DeploymentActivityChart data={monthlyStats} />
          </Box>
        )}

        {/* Table filters */}
        <HStack gap="space-12" align="end" wrap>
          <Select
            label="Endringsopphav"
            size="small"
            value={goalFilter}
            onChange={(e) => updateFilter('goal', e.target.value, 'all')}
            style={{ width: '14rem' }}
          >
            <option value="all">Alle</option>
            <option value="with_goal">Med endringsopphav</option>
            <option value="without_goal">Uten endringsopphav</option>
          </Select>
          <Select
            label="Dependabot"
            size="small"
            value={dependabotFilter}
            onChange={(e) => updateFilter('dependabot', e.target.value, 'all')}
            style={{ width: '10rem' }}
          >
            <option value="all">Alle</option>
            <option value="only">Kun Dependabot</option>
          </Select>
          <Select
            label="Godkjenning"
            size="small"
            value={approvalFilter}
            onChange={(e) => updateFilter('approval', e.target.value, 'all')}
            style={{ width: '12rem' }}
          >
            <option value="all">Alle</option>
            <option value="approved">Godkjent</option>
            <option value="not_approved">Ikke godkjent</option>
            <option value="pending">Venter</option>
          </Select>
          {deployerApps.length > 1 && (
            <Select
              label="Applikasjon"
              size="small"
              value={appFilter}
              onChange={(e) => updateFilter('app', e.target.value, '')}
              style={{ width: '16rem' }}
            >
              <option value="">Alle applikasjoner</option>
              {deployerApps.map((app) => (
                <option key={app} value={app}>
                  {app}
                </option>
              ))}
            </Select>
          )}
        </HStack>

        {/* Bulk link action + feedback */}
        {availableBoards.length > 0 && (
          <HStack gap="space-12" align="center">
            <Button
              variant="secondary"
              size="small"
              icon={<LinkIcon aria-hidden />}
              onClick={() => bulkLinkRef.current?.showModal()}
            >
              Koble Dependabot til endringsopphav
            </Button>
            {actionData?.success && typeof actionData.success === 'string' && (
              <Alert variant="success" size="small" inline>
                {actionData.success}
              </Alert>
            )}
            {actionData?.error && typeof actionData.error === 'string' && (
              <Alert variant="error" size="small" inline>
                {actionData.error}
              </Alert>
            )}
          </HStack>
        )}

        {/* Deployments (paginated) */}
        {paginatedDeployments.deployments.length === 0 ? (
          <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort>Ingen leveranser funnet for denne brukeren.</BodyShort>
          </Box>
        ) : (
          <>
            <div>
              {paginatedDeployments.deployments.map((deployment) => (
                <Box key={deployment.id} padding="space-16" background="raised" className={styles.stackedListItem}>
                  <HStack gap="space-12" align="center" justify="space-between" wrap>
                    <HStack gap="space-12" align="center" wrap>
                      <Link to={`/deployments/${deployment.id}`}>
                        <BodyShort weight="semibold" style={{ whiteSpace: 'nowrap' }}>
                          {formatDate(deployment.created_at)}
                        </BodyShort>
                      </Link>
                      <Link
                        to={`/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}`}
                      >
                        <BodyShort>{deployment.app_name}</BodyShort>
                      </Link>
                      <StatusTag four_eyes_status={deployment.four_eyes_status as FourEyesStatus} />
                      <MethodTag
                        github_pr_number={deployment.github_pr_number}
                        four_eyes_status={deployment.four_eyes_status as FourEyesStatus}
                      />
                      {deployment.has_goal_link && (
                        <Tag variant="moderate" size="xsmall" data-color="success">
                          <HStack gap="space-4" align="center">
                            <LinkIcon aria-hidden style={{ fontSize: '0.75rem' }} />
                            Endringsopphav
                          </HStack>
                        </Tag>
                      )}
                      {deployment.is_dependabot && (
                        <Tag variant="moderate" size="xsmall" data-color="neutral">
                          Dependabot
                        </Tag>
                      )}
                    </HStack>
                    <Detail textColor="subtle">{deployment.environment_name}</Detail>
                  </HStack>
                </Box>
              ))}
            </div>

            {/* Pagination */}
            {paginatedDeployments.total_pages > 1 && (
              <HStack gap="space-16" justify="center" align="center">
                <Button
                  variant="tertiary"
                  size="small"
                  icon={<ChevronLeftIcon aria-hidden />}
                  disabled={paginatedDeployments.page <= 1}
                  onClick={() => {
                    const params = new URLSearchParams(searchParams)
                    params.set('page', String(paginatedDeployments.page - 1))
                    setSearchParams(params)
                  }}
                >
                  Forrige
                </Button>
                <BodyShort>
                  Side {paginatedDeployments.page} av {paginatedDeployments.total_pages}
                </BodyShort>
                <Button
                  variant="tertiary"
                  size="small"
                  icon={<ChevronRightIcon aria-hidden />}
                  iconPosition="right"
                  disabled={paginatedDeployments.page >= paginatedDeployments.total_pages}
                  onClick={() => {
                    const params = new URLSearchParams(searchParams)
                    params.set('page', String(paginatedDeployments.page + 1))
                    setSearchParams(params)
                  }}
                >
                  Neste
                </Button>
              </HStack>
            )}
          </>
        )}
      </VStack>

      {/* Create mapping modal - only for non-bots */}
      {!isBot && (
        <Modal ref={modalRef} header={{ heading: 'Opprett brukermapping' }}>
          <Modal.Body>
            <Form method="post" id="create-mapping-form">
              <input type="hidden" name="intent" value="create-mapping" />
              <input type="hidden" name="github_username" value={username} />
              <VStack gap="space-16">
                <TextField label="GitHub brukernavn" value={username} disabled />
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
            <Button type="submit" form="create-mapping-form" loading={isSubmitting}>
              Lagre
            </Button>
            <Button variant="secondary" onClick={() => modalRef.current?.close()}>
              Avbryt
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Bulk link dependabot to goal modal */}
      {availableBoards.length > 0 && (
        <BulkLinkGoalModal
          ref={bulkLinkRef}
          username={username}
          period={period}
          appFilter={appFilter}
          availableBoards={availableBoards}
          isSubmitting={isSubmitting}
        />
      )}
    </VStack>
  )
}

import { forwardRef } from 'react'

type AvailableBoard = {
  id: number
  title: string
  period_label: string
  dev_team_name: string
  objectives: Array<{ id: number; title: string; key_results: Array<{ id: number; title: string }> }>
}

const BulkLinkGoalModal = forwardRef<
  HTMLDialogElement,
  {
    username: string
    period: string
    appFilter: string
    availableBoards: AvailableBoard[]
    isSubmitting: boolean
  }
>(function BulkLinkGoalModal({ username, period, appFilter, availableBoards, isSubmitting }, ref) {
  const [selectedBoardId, setSelectedBoardId] = useState<string>('')
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string>('')
  const [selectedKeyResultId, setSelectedKeyResultId] = useState<string>('')

  const selectedBoard = availableBoards.find((b) => String(b.id) === selectedBoardId)
  const selectedObjective = selectedBoard?.objectives.find((o) => String(o.id) === selectedObjectiveId)

  return (
    <Modal ref={ref} header={{ heading: 'Koble Dependabot-leveranser til endringsopphav' }} closeOnBackdropClick>
      <Form method="post" id="bulk-link-form">
        <input type="hidden" name="intent" value="bulk_link_goal" />
        <input type="hidden" name="username" value={username} />
        <input type="hidden" name="period" value={period} />
        {appFilter && <input type="hidden" name="app_name" value={appFilter} />}
        <Modal.Body>
          <VStack gap="space-16">
            <BodyShort>
              Kobler alle Dependabot-leveranser uten endringsopphav til det valgte målet
              {period !== 'all' ? ' (innenfor valgt tidsperiode)' : ''}
              {appFilter ? ` for ${appFilter}` : ''}.
            </BodyShort>

            <Select
              label="Tavle"
              size="small"
              value={selectedBoardId}
              onChange={(e) => {
                setSelectedBoardId(e.target.value)
                setSelectedObjectiveId('')
                setSelectedKeyResultId('')
              }}
            >
              <option value="">Velg tavle...</option>
              {availableBoards.map((board) => (
                <option key={board.id} value={String(board.id)}>
                  {board.dev_team_name} – {board.title} ({board.period_label})
                </option>
              ))}
            </Select>

            {selectedBoard && selectedBoard.objectives.length > 0 && (
              <Select
                label="Mål"
                name="objective_id"
                size="small"
                value={selectedObjectiveId}
                onChange={(e) => {
                  setSelectedObjectiveId(e.target.value)
                  setSelectedKeyResultId('')
                }}
              >
                <option value="">Velg mål...</option>
                {selectedBoard.objectives.map((obj) => (
                  <option key={obj.id} value={String(obj.id)}>
                    {obj.title}
                  </option>
                ))}
              </Select>
            )}

            {selectedObjective && selectedObjective.key_results.length > 0 && (
              <Select
                label="Nøkkelresultat (valgfritt)"
                name="key_result_id"
                size="small"
                value={selectedKeyResultId}
                onChange={(e) => setSelectedKeyResultId(e.target.value)}
              >
                <option value="">Ingen spesifikt nøkkelresultat</option>
                {selectedObjective.key_results.map((kr) => (
                  <option key={kr.id} value={String(kr.id)}>
                    {kr.title}
                  </option>
                ))}
              </Select>
            )}
          </VStack>
        </Modal.Body>
        <Modal.Footer>
          <Button
            type="submit"
            form="bulk-link-form"
            size="small"
            loading={isSubmitting}
            disabled={!selectedObjectiveId}
          >
            Koble alle
          </Button>
          <Button
            variant="secondary"
            size="small"
            type="button"
            onClick={() => {
              if (typeof ref === 'object' && ref?.current) ref.current.close()
            }}
          >
            Avbryt
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
})
