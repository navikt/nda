import { useEffect, useRef, useState } from 'react'
import { redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from 'react-router'
import { BulkLinkGoalModal, SelectLinkGoalModal } from '~/components/BulkLinkGoalModals'
import { CreateMappingModal } from '~/components/CreateMappingModal'
import { UserPageContent } from '~/components/UserPageContent'
import { getBoardsWithGoalsForDevTeam } from '~/db/boards.server'
import {
  bulkAddDeploymentGoalLinks,
  hasUnlinkedDependabotDeployments as checkHasUnlinkedDependabot,
  getUnlinkedDependabotDeploymentIds,
} from '~/db/deployment-goal-links.server'
import {
  type DeployerTableFilters,
  getDeployerApps,
  getDeployerDeploymentsPaginated,
  getDeployerMonthlyStats,
  getDeploymentCountByDeployer,
} from '~/db/deployments.server'
import { getUserDevTeamsByRole, getUserRolesForDisplay, type UserRoleDisplay } from '~/db/role-assignments.server'
import { getAllSectionsWithTeams } from '~/db/sections.server'
import { getUserByIdentifier, upsertUserAndGithubAccount } from '~/db/user-github-lookups.server'
import { getUserLandingPage, setUserLandingPage } from '~/db/user-settings.server'
import { requireUser } from '~/lib/auth.server'
import { canSearchUsers } from '~/lib/authorization.server'
import { getFormString, isValidGitHubUsername, isValidNavIdent } from '~/lib/form-validators'
import { getBotDescription, getBotDisplayName, isGitHubBot } from '~/lib/github-bots'
import { logger } from '~/lib/logger.server'
import { searchGraphUsers } from '~/lib/microsoft-graph.server'
import { getDateRangeForPeriod, type TimePeriod } from '~/lib/time-periods'
import { formatDisplayNameNatural } from '~/lib/user-display'
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

  // Resolve user mapping first to check for canonical URL redirect
  const mapping = isBot ? null : await getUserByIdentifier(username)

  // Redirect to canonical GitHub username URL if nav-ident resolves to a different username
  if (
    mapping?.github_username &&
    isValidGitHubUsername(mapping.github_username) &&
    mapping.github_username.toLowerCase() !== username.toLowerCase()
  ) {
    throw redirect(`/users/${encodeURIComponent(mapping.github_username)}${url.search}`)
  }

  const [deploymentCount, paginatedDeployments, monthlyStats, deployerApps] = await Promise.all([
    getDeploymentCountByDeployer(username),
    getDeployerDeploymentsPaginated(username, page, 20, dateRange?.startDate, dateRange?.endDate, filters),
    getDeployerMonthlyStats(username, dateRange?.startDate, dateRange?.endDate),
    getDeployerApps(username),
  ])

  // Check if this is the logged-in user's own profile
  const isOwnProfile = !isBot && mapping?.nav_ident === identity.navIdent

  // Check if the logged-in user is viewing their own nav-ident URL without a linked GitHub account
  const canPrefillOwnMapping =
    !isBot && !mapping?.github_username && username.toUpperCase() === identity.navIdent.toUpperCase()

  // Fetch dev teams if user has a nav_ident
  let devTeams: Awaited<ReturnType<typeof getUserDevTeamsByRole>> = []
  let userRoles: UserRoleDisplay = { sectionRoles: [], teamRoles: [] }
  if (mapping?.nav_ident) {
    const [devTeamsResult, rolesResult] = await Promise.allSettled([
      getUserDevTeamsByRole(mapping.nav_ident.toUpperCase()),
      getUserRolesForDisplay(mapping.nav_ident.toUpperCase()),
    ])
    if (devTeamsResult.status === 'fulfilled') devTeams = devTeamsResult.value
    if (rolesResult.status === 'fulfilled') userRoles = rolesResult.value
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

  // Check if there are unlinked dependabot deployments (for bulk link button)
  let hasUnlinkedDependabotDeployments = false
  if (availableBoards.length > 0) {
    hasUnlinkedDependabotDeployments = await checkHasUnlinkedDependabot(
      username,
      dateRange?.startDate,
      dateRange?.endDate,
      appFilter || undefined,
    )
  }

  let landingPage = 'my-teams'
  let allSections: { slug: string; name: string }[] = []
  if (isOwnProfile) {
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
    userRoles,
    availableBoards,
    hasUnlinkedDependabotDeployments,
    isOwnProfile,
    profileNavIdent: mapping?.nav_ident ?? null,
    canPrefillOwnMapping,
    loggedInNavIdent: canPrefillOwnMapping ? identity.navIdent : null,
    landingPage,
    allSections,
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const identity = await requireUser(request)
  const formData = await request.formData()
  const intent = formData.get('intent')

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
    const externalUrl = (formData.get('external_url') as string)?.trim() || undefined
    const comment = (formData.get('comment') as string)?.trim() || undefined

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
        { external_url: externalUrl, comment },
      )
      return { success: `Koblet ${linked} Dependabot-leveranser til endringsopphav.` }
    } catch {
      return { error: 'Kunne ikke koble leveranser.' }
    }
  }

  if (intent === 'link_selected_goal') {
    const deploymentIds = formData.getAll('deployment_ids').map(Number).filter(Number.isFinite)
    const objectiveId = formData.get('objective_id') ? Number(formData.get('objective_id')) : undefined
    const keyResultId = formData.get('key_result_id') ? Number(formData.get('key_result_id')) : undefined
    const externalUrl = (formData.get('external_url') as string)?.trim() || undefined
    const comment = (formData.get('comment') as string)?.trim() || undefined

    if (deploymentIds.length === 0) return { error: 'Ingen leveranser valgt.' }
    if (!objectiveId && !keyResultId) return { error: 'Velg et mål eller nøkkelresultat.' }

    try {
      const linked = await bulkAddDeploymentGoalLinks(
        deploymentIds,
        { objective_id: objectiveId, key_result_id: keyResultId },
        identity.navIdent,
        { external_url: externalUrl, comment },
      )
      return { success: `Koblet ${linked} leveranser til endringsopphav.` }
    } catch {
      return { error: 'Kunne ikke koble leveranser.' }
    }
  }

  if (intent === 'create-mapping') {
    const routeUsername = params.username || ''
    const isSelfService = routeUsername.toUpperCase() === identity.navIdent.toUpperCase()

    if (!isSelfService && !(await canSearchUsers(identity))) {
      return { fieldErrors: { nav_ident: 'Du har ikke tilgang til å opprette mapping for andre brukere' } }
    }

    // Server-side ownership enforcement:
    // - Self-service (own nav-ident URL): allow free-form GitHub username, force nav_ident
    // - Other profiles: derive GitHub username from route param, allow free-form nav_ident
    const githubUsernameRaw = isSelfService ? getFormString(formData, 'github_username') || '' : routeUsername
    const githubUsername = githubUsernameRaw.toLowerCase()
    const navIdentRaw = isSelfService ? identity.navIdent : getFormString(formData, 'nav_ident') || null
    const navIdentInput = navIdentRaw?.toUpperCase() || null

    const fieldErrors: { github_username?: string; nav_ident?: string } = {}

    if (!githubUsername) {
      fieldErrors.github_username = 'GitHub brukernavn er påkrevd'
    } else if (!isValidGitHubUsername(githubUsername)) {
      fieldErrors.github_username = 'Ugyldig GitHub-brukernavn (kun bokstaver, tall og bindestrek)'
    } else if (isGitHubBot(githubUsername)) {
      fieldErrors.github_username = 'Kan ikke opprette mapping for GitHub-botkontoer'
    }

    if (!navIdentInput) {
      fieldErrors.nav_ident = 'NAV-ident er påkrevd'
    } else if (!isValidNavIdent(navIdentInput)) {
      fieldErrors.nav_ident = 'Må være én bokstav etterfulgt av 6 siffer (f.eks. A123456)'
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors }
    }

    // Fetch user data from Graph API to ensure display_name and nav_email are authoritative
    // navIdentInput is guaranteed non-null here (validated above)
    const navIdent = navIdentInput as string
    let graphResults: Awaited<ReturnType<typeof searchGraphUsers>>
    try {
      graphResults = await searchGraphUsers(navIdent)
    } catch (error) {
      logger.error('Graph API lookup failed during mapping creation', error)
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
      displayGithubUsername: isSelfService ? githubUsernameRaw : null,
      displayName,
      navEmail,
      navIdent: navIdent,
      slackMemberId: getFormString(formData, 'slack_member_id') || null,
    })
    return redirect(`/users/${githubUsername}`)
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
    userRoles,
    availableBoards,
    hasUnlinkedDependabotDeployments,
    isOwnProfile,
    canPrefillOwnMapping,
    loggedInNavIdent,
    landingPage,
    allSections,
  } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'
  const modalRef = useRef<HTMLDialogElement>(null)
  const bulkLinkRef = useRef<HTMLDialogElement>(null)
  const selectLinkRef = useRef<HTMLDialogElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [pendingLinkIds, setPendingLinkIds] = useState<number[]>([])

  // Close create-mapping modal when mapping transitions from null to non-null
  const prevMappingRef = useRef(mapping)
  useEffect(() => {
    if (!prevMappingRef.current && mapping) {
      modalRef.current?.close()
    }
    prevMappingRef.current = mapping
  }, [mapping])

  // Open select-link modal when pendingLinkIds is populated
  useEffect(() => {
    if (pendingLinkIds.length > 0) {
      selectLinkRef.current?.showModal()
    }
  }, [pendingLinkIds])

  // Close goal modals and clear selection when action completes
  useEffect(() => {
    if ((actionData?.success || actionData?.error) && navigation.state === 'idle') {
      bulkLinkRef.current?.close()
      selectLinkRef.current?.close()
      if (actionData?.success) {
        setPendingLinkIds([])
      }
    }
  }, [actionData, navigation.state])

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams)
    const defaultValues: Record<string, string> = { goal: 'all', dependabot: 'all', approval: 'all', app: '' }
    if (value === (defaultValues[key] ?? '')) {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    params.delete('page')
    setSearchParams(params)
  }

  return (
    <>
      <UserPageContent
        username={username}
        mapping={mapping}
        isBot={isBot}
        botDisplayName={botDisplayName}
        botDescription={botDescription}
        devTeams={devTeams}
        userRoles={userRoles}
        deploymentCount={deploymentCount}
        paginatedDeployments={paginatedDeployments}
        monthlyStats={monthlyStats}
        deployerApps={deployerApps}
        period={period}
        goalFilter={goalFilter}
        dependabotFilter={dependabotFilter}
        approvalFilter={approvalFilter}
        appFilter={appFilter}
        hasFilters={hasFilters}
        availableBoards={availableBoards}
        isOwnProfile={isOwnProfile}
        landingPage={landingPage}
        allSections={allSections}
        actionData={actionData}
        isSubmitting={isSubmitting}
        onFilterChange={updateFilter}
        onPeriodChange={(value) => {
          const params = new URLSearchParams(searchParams)
          params.set('period', value)
          params.delete('page')
          setSearchParams(params)
        }}
        onPageChange={(page) => {
          const params = new URLSearchParams(searchParams)
          params.set('page', String(page))
          setSearchParams(params)
        }}
        onCreateMapping={() => modalRef.current?.showModal()}
        onBulkLink={() => bulkLinkRef.current?.showModal()}
        onSelectLink={(ids) => {
          setPendingLinkIds(ids)
        }}
      />

      {/* Create mapping modal - only for non-bots */}
      {!isBot && (
        <CreateMappingModal
          ref={modalRef}
          username={username}
          canPrefillOwnMapping={canPrefillOwnMapping}
          loggedInNavIdent={loggedInNavIdent}
          isSubmitting={isSubmitting}
          fieldErrors={actionData?.fieldErrors}
        />
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
          hasUnlinkedDeployments={hasUnlinkedDependabotDeployments}
        />
      )}

      {/* Link selected deployments to goal modal */}
      {availableBoards.length > 0 && (
        <SelectLinkGoalModal
          ref={selectLinkRef}
          selectedIds={pendingLinkIds}
          selectedDates={paginatedDeployments.deployments
            .filter((d) => pendingLinkIds.includes(d.id))
            .map((d) => (d.created_at instanceof Date ? d.created_at.toISOString() : String(d.created_at)))}
          availableBoards={availableBoards}
          isSubmitting={isSubmitting}
        />
      )}
    </>
  )
}
