import { ChevronLeftIcon, ChevronRightIcon, LinkIcon, PlusIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  Detail,
  Heading,
  Hide,
  HStack,
  Radio,
  RadioGroup,
  Select,
  Show,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useState } from 'react'
import { Form, Link } from 'react-router'
import { DeploymentActivityChart } from '~/components/DeploymentActivityChart'
import { MethodTag, StatusTag } from '~/components/deployment-tags'
import { UserProfileHeader } from '~/components/UserProfileHeader'
import { UserRolesDisplay } from '~/components/UserRolesDisplay'
import { isValidNavIdent } from '~/lib/form-validators'
import type { FourEyesStatus } from '~/lib/four-eyes-status'
import { TIME_PERIOD_OPTIONS, type TimePeriod } from '~/lib/time-periods'
import styles from '~/styles/common.module.css'

interface UserMapping {
  github_username: string | null
  display_name: string | null
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
}

interface DevTeam {
  id: number
  name: string
  slug: string
  section_slug: string | null
}

interface UserRoleDisplay {
  sectionRoles: Array<{ role: string; sectionName: string; sectionSlug: string }>
  teamRoles: Array<{ role: string; teamName: string; teamSlug: string; sectionSlug: string | null }>
}

interface MonthlyStats {
  month: string
  total: number
  with_goal: number
  without_goal: number
  dependabot: number
}

interface Deployment {
  id: number
  app_name: string
  environment_name: string
  team_slug: string
  created_at: string | Date
  title: string | null
  github_pr_number: number | null
  four_eyes_status: string
  has_goal_link: boolean
  is_dependabot: boolean
}

interface PaginatedDeployments {
  deployments: Deployment[]
  total: number
  page: number
  total_pages: number
}

interface Board {
  id: number
  period_label: string
  dev_team_name: string
}

interface Section {
  slug: string
  name: string
}

interface UserPageContentProps {
  username: string
  mapping: UserMapping | null
  isBot: boolean
  botDisplayName?: string | null
  botDescription?: string | null
  devTeams: DevTeam[]
  userRoles: UserRoleDisplay
  deploymentCount: number
  paginatedDeployments: PaginatedDeployments
  monthlyStats: MonthlyStats[]
  deployerApps: string[]
  period: TimePeriod
  goalFilter: string
  dependabotFilter: string
  approvalFilter: string
  appFilter: string
  hasFilters: boolean
  availableBoards: Board[]
  isOwnProfile: boolean
  landingPage: string
  allSections: Section[]
  actionData?: { success?: boolean | string; error?: string } | null
  isSubmitting?: boolean
  onFilterChange?: (key: string, value: string) => void
  onPeriodChange?: (value: string) => void
  onPageChange?: (page: number) => void
  onCreateMapping?: () => void
  onBulkLink?: () => void
  onSelectLink?: (ids: number[]) => void
  onLandingPageChange?: (value: string) => void
}

export function UserPageContent({
  username,
  mapping,
  isBot,
  botDisplayName,
  botDescription,
  devTeams,
  userRoles,
  deploymentCount,
  paginatedDeployments,
  monthlyStats,
  deployerApps,
  period,
  goalFilter,
  dependabotFilter,
  approvalFilter,
  appFilter,
  hasFilters,
  availableBoards,
  isOwnProfile,
  landingPage,
  allSections,
  actionData,
  isSubmitting = false,
  onFilterChange,
  onPeriodChange,
  onPageChange,
  onCreateMapping,
  onBulkLink,
  onSelectLink,
  onLandingPageChange,
}: UserPageContentProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Clear selection when action completes successfully
  useEffect(() => {
    if (actionData?.success && typeof actionData.success === 'string') {
      setSelectedIds(new Set())
    }
  }, [actionData])

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

  const unlinkableOnPage = paginatedDeployments.deployments.filter((d) => !d.has_goal_link)
  const allOnPageSelected = unlinkableOnPage.length > 0 && unlinkableOnPage.every((d) => selectedIds.has(d.id))

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (allOnPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const d of unlinkableOnPage) next.delete(d.id)
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const d of unlinkableOnPage) next.add(d.id)
        return next
      })
    }
  }

  return (
    <VStack gap="space-32">
      <UserProfileHeader
        username={username}
        githubUsername={mapping?.github_username ?? (isValidNavIdent(username) ? null : username)}
        displayName={mapping?.display_name || botDisplayName}
        identity={mapping}
        isBot={isBot}
        botDescription={botDescription}
      />

      <UserRolesDisplay userRoles={userRoles} />

      {devTeams.length > 0 && (
        <VStack gap="space-8">
          <Detail textColor="subtle">Utviklingsteam</Detail>
          <HStack gap="space-8" wrap>
            {devTeams.map((team) =>
              team.section_slug ? (
                <Tag key={team.id} variant="moderate" size="small">
                  <Link
                    to={`/sections/${team.section_slug}/teams/${team.slug}`}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    {team.name}
                  </Link>
                </Tag>
              ) : (
                <Tag key={team.id} variant="moderate" size="small">
                  {team.name}
                </Tag>
              ),
            )}
          </HStack>
        </VStack>
      )}

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
                if (onLandingPageChange) {
                  onLandingPageChange(value)
                } else {
                  const form = document.getElementById('landing-page-form') as HTMLFormElement | null
                  const input = form?.querySelector<HTMLInputElement>('input[name="landingPage"]')
                  if (input && form) {
                    input.value = value
                    form.requestSubmit()
                  }
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

      {!mapping && !isBot && (
        <Alert variant="warning">
          <HStack gap="space-16" align="center" justify="space-between" wrap>
            <BodyShort>Ingen brukermapping funnet for denne brukeren.</BodyShort>
            <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={onCreateMapping}>
              Opprett mapping
            </Button>
          </HStack>
        </Alert>
      )}

      <VStack gap="space-24">
        <HStack justify="space-between" align="end" wrap>
          <Heading level="2" size="small">
            Leveranser {hasFilters ? `(${paginatedDeployments.total} av ${deploymentCount})` : `(${deploymentCount})`}
          </Heading>
          <Select
            label="Tidsperiode"
            size="small"
            value={period}
            onChange={(e) => onPeriodChange?.(e.target.value)}
            style={{ width: '14rem' }}
          >
            {TIME_PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </HStack>

        {monthlyStats.length > 0 && (
          <Box background="raised" padding="space-16" borderRadius="4">
            <DeploymentActivityChart data={monthlyStats} />
          </Box>
        )}

        <HStack gap="space-12" align="end" wrap>
          <Select
            label="Endringsopphav"
            size="small"
            value={goalFilter}
            onChange={(e) => onFilterChange?.('goal', e.target.value)}
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
            onChange={(e) => onFilterChange?.('dependabot', e.target.value)}
            style={{ width: '10rem' }}
          >
            <option value="all">Alle</option>
            <option value="only">Kun Dependabot</option>
          </Select>
          <Select
            label="Godkjenning"
            size="small"
            value={approvalFilter}
            onChange={(e) => onFilterChange?.('approval', e.target.value)}
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
              onChange={(e) => onFilterChange?.('app', e.target.value)}
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

        {availableBoards.length > 0 && (
          <HStack gap="space-12" align="center" wrap>
            <Button
              variant="secondary"
              size="small"
              icon={<LinkIcon aria-hidden />}
              disabled={isSubmitting}
              onClick={onBulkLink}
            >
              Koble Dependabot til endringsopphav
            </Button>
            {unlinkableOnPage.length > 0 && (
              <Checkbox size="small" checked={allOnPageSelected} onChange={toggleSelectAll}>
                Velg alle uten endringsopphav på siden
              </Checkbox>
            )}
            {selectedIds.size > 0 && (
              <Button
                variant="primary"
                size="small"
                icon={<LinkIcon aria-hidden />}
                disabled={isSubmitting}
                onClick={() => onSelectLink?.([...selectedIds])}
              >
                Koble {selectedIds.size} markerte
              </Button>
            )}
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

        {paginatedDeployments.deployments.length === 0 ? (
          <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort>Ingen leveranser funnet for denne brukeren.</BodyShort>
          </Box>
        ) : (
          <>
            <div>
              {paginatedDeployments.deployments.map((deployment) => (
                <Box key={deployment.id} padding="space-20" background="raised" className={styles.stackedListItem}>
                  <HStack gap="space-12" align="start">
                    {availableBoards.length > 0 && !deployment.has_goal_link && (
                      <Checkbox
                        size="small"
                        checked={selectedIds.has(deployment.id)}
                        onChange={() => toggleSelect(deployment.id)}
                        hideLabel
                      >
                        Velg leveranse {deployment.id}
                      </Checkbox>
                    )}
                    <VStack gap="space-12" style={{ flex: 1, minWidth: 0 }}>
                      <HStack gap="space-8" align="center" justify="space-between">
                        <HStack gap="space-8" align="center" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                          <Link to={`/deployments/${deployment.id}`}>
                            <BodyShort weight="semibold" style={{ whiteSpace: 'nowrap' }}>
                              {formatDate(deployment.created_at)}
                            </BodyShort>
                          </Link>
                          <Show above="md">
                            {deployment.title && (
                              <BodyShort className={styles.truncateText} style={{ flex: 1, minWidth: 0 }}>
                                {deployment.title}
                              </BodyShort>
                            )}
                          </Show>
                        </HStack>
                        <HStack gap="space-8" style={{ flexShrink: 0 }}>
                          <MethodTag
                            github_pr_number={deployment.github_pr_number}
                            four_eyes_status={deployment.four_eyes_status as FourEyesStatus}
                          />
                          <StatusTag four_eyes_status={deployment.four_eyes_status as FourEyesStatus} />
                          {deployment.has_goal_link && (
                            <Tag variant="outline" size="xsmall" data-color="success">
                              <HStack gap="space-4" align="center">
                                <LinkIcon aria-hidden style={{ fontSize: '0.75rem' }} />
                                Endringsopphav
                              </HStack>
                            </Tag>
                          )}
                          {deployment.is_dependabot && (
                            <Tag variant="outline" size="xsmall" data-color="neutral">
                              Dependabot
                            </Tag>
                          )}
                        </HStack>
                      </HStack>

                      <Hide above="md">
                        {deployment.title && <BodyShort className={styles.truncateText}>{deployment.title}</BodyShort>}
                      </Hide>

                      <HStack gap="space-16" align="center" wrap>
                        <Detail textColor="subtle">
                          <Link
                            to={`/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}`}
                          >
                            {deployment.app_name}
                          </Link>
                        </Detail>
                        <Detail textColor="subtle">{deployment.environment_name}</Detail>
                      </HStack>
                    </VStack>
                  </HStack>
                </Box>
              ))}
            </div>

            {paginatedDeployments.total_pages > 1 && (
              <HStack gap="space-16" justify="center" align="center">
                <Button
                  variant="tertiary"
                  size="small"
                  icon={<ChevronLeftIcon aria-hidden />}
                  disabled={paginatedDeployments.page <= 1}
                  onClick={() => onPageChange?.(paginatedDeployments.page - 1)}
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
                  onClick={() => onPageChange?.(paginatedDeployments.page + 1)}
                >
                  Neste
                </Button>
              </HStack>
            )}
          </>
        )}
      </VStack>
    </VStack>
  )
}
