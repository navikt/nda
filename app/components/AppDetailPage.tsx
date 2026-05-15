import { BarChartIcon, ExclamationmarkTriangleIcon, FileTextIcon, PackageIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HGrid,
  HStack,
  Label,
  Select,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Form, Link } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import { StatCard } from '~/components/StatCard'
import { TIME_PERIOD_OPTIONS } from '~/lib/time-periods'

type AppDetailRepository = {
  id: number
  github_owner: string
  github_repo_name: string
  status: 'active' | 'pending_approval' | 'historical'
  redirects_to_owner: string | null
  redirects_to_repo: string | null
  created_at: string
}

type AppDetailAlert = {
  id: number
  deployment_id: number
  alert_type: string
  expected_github_owner: string
  expected_github_repo_name: string
  detected_github_owner: string
  detected_github_repo_name: string
  created_at: string
}

type AppDetailAuditReport = {
  id: number
  report_id: string
  year: number
  total_deployments: number
  pr_approved_count: number
  manually_approved_count: number
  generated_at: string
}

type AppDetailDeploymentStats = {
  total: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  four_eyes_percentage: number
  last_deployment: string | null
  last_deployment_id: number | null
}

type AppDetailApp = {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  default_branch: string
}

interface AppDetailPageProps {
  app: AppDetailApp
  activeRepo: AppDetailRepository | null
  pendingRepos: AppDetailRepository[]
  deploymentStats: AppDetailDeploymentStats
  alerts: AppDetailAlert[]
  auditReports: AppDetailAuditReport[]
  isAdmin?: boolean
}

export function AppDetailPage({
  app,
  activeRepo,
  pendingRepos,
  deploymentStats,
  alerts,
  auditReports,
  isAdmin = false,
}: AppDetailPageProps) {
  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`
  const naisConsoleUrl = `https://console.nav.cloud.nais.io/team/${app.team_slug}/${app.environment_name}/app/${app.app_name}`

  return (
    <VStack gap="space-32">
      <HStack justify="space-between" align="start" wrap>
        <div>
          <Heading level="1" size="large">
            {app.app_name}
          </Heading>
          <HStack gap="space-16" align="center" wrap>
            <BodyShort textColor="subtle">
              Team: <code style={{ fontSize: '0.75rem' }}>{app.team_slug}</code> | Miljø:{' '}
              <code style={{ fontSize: '0.75rem' }}>{app.environment_name}</code> | Branch:{' '}
              <code style={{ fontSize: '0.75rem' }}>{app.default_branch}</code>
            </BodyShort>
            <ExternalLink href={naisConsoleUrl}>Nais Console</ExternalLink>
          </HStack>
        </div>
        {isAdmin && (
          <Button as={Link} to={`${appUrl}/admin`} variant="tertiary" size="small">
            Administrer
          </Button>
        )}
      </HStack>

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-20">
          <HStack justify="space-between" align="center" wrap>
            <Heading level="2" size="medium">
              <BarChartIcon aria-hidden /> Statistikk
            </Heading>
            <Form method="get">
              <Select label="Tidsperiode" name="period" defaultValue="last-week" size="small" hideLabel>
                {TIME_PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Form>
          </HStack>
          <HGrid gap="space-16" columns={{ xs: 2, md: 3, lg: 5 }}>
            <StatCard label="Totalt deployments" value={deploymentStats.total} compact />
            <StatCard
              label="Godkjent"
              value={`${deploymentStats.with_four_eyes} (${deploymentStats.four_eyes_percentage}%)`}
              variant="success"
              compact
            />
            <StatCard label="Mangler godkjenning" value={deploymentStats.without_four_eyes} variant="danger" compact />
            <StatCard
              label="Venter verifisering"
              value={deploymentStats.pending_verification}
              variant="warning"
              compact
            />
            <StatCard
              label="Siste deployment"
              value={
                deploymentStats.last_deployment
                  ? new Date(deploymentStats.last_deployment).toLocaleString('no-NO')
                  : 'Ingen'
              }
              compact
            />
          </HGrid>
        </VStack>
      </Box>

      {app.environment_name.startsWith('prod-') && auditReports.length > 0 && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-20">
            <Heading level="2" size="medium">
              <FileTextIcon aria-hidden /> Leveranserapport
            </Heading>
            <VStack gap="space-12">
              {auditReports.map((report) => (
                <Box key={report.id} padding="space-16" borderRadius="8" background="sunken">
                  <HStack gap="space-16" align="center" justify="space-between" wrap>
                    <VStack gap="space-4">
                      <HStack gap="space-8" align="center">
                        <Tag data-color="success" size="xsmall" variant="moderate">
                          {report.year}
                        </Tag>
                        <BodyShort weight="semibold">{report.total_deployments} deployments</BodyShort>
                      </HStack>
                      <Detail textColor="subtle">
                        Generert: {new Date(report.generated_at).toLocaleDateString('nb-NO')} •{' '}
                        {report.pr_approved_count} PR, {report.manually_approved_count} manuell
                      </Detail>
                    </VStack>
                    <HStack gap="space-8">
                      <Button size="small" variant="tertiary">
                        Vis
                      </Button>
                      <Button size="small" variant="tertiary">
                        Last ned
                      </Button>
                    </HStack>
                  </HStack>
                </Box>
              ))}
            </VStack>
          </VStack>
        </Box>
      )}

      {alerts.length > 0 && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="warning-subtle" borderWidth="1">
          <VStack gap="space-16">
            <Heading level="2" size="medium">
              <ExclamationmarkTriangleIcon aria-hidden /> Åpne varsler ({alerts.length})
            </Heading>
            <VStack gap="space-12">
              {alerts.map((alert) => (
                <Box key={alert.id} padding="space-16" borderRadius="8" background="sunken">
                  <VStack gap="space-12">
                    <HStack gap="space-8" align="center" justify="space-between" wrap>
                      <HStack gap="space-12" align="center">
                        <Tag data-color="warning" size="xsmall" variant="outline">
                          {alert.alert_type === 'repository_mismatch' && 'Ukjent repo'}
                        </Tag>
                        <Detail textColor="subtle">{new Date(alert.created_at).toLocaleDateString('no-NO')}</Detail>
                      </HStack>
                      <HStack gap="space-8">
                        <Button size="xsmall" variant="tertiary">
                          Se deployment
                        </Button>
                        <Button size="xsmall" variant="secondary">
                          Løs
                        </Button>
                      </HStack>
                    </HStack>
                    <VStack gap="space-4">
                      <HStack gap="space-8" wrap>
                        <Detail textColor="subtle">Forventet:</Detail>
                        <code style={{ fontSize: '0.75rem' }}>
                          {alert.expected_github_owner}/{alert.expected_github_repo_name}
                        </code>
                      </HStack>
                      <HStack gap="space-8" wrap>
                        <Detail textColor="subtle">Detektert:</Detail>
                        <code style={{ fontSize: '0.75rem', color: 'var(--ax-text-danger)' }}>
                          {alert.detected_github_owner}/{alert.detected_github_repo_name}
                        </code>
                      </HStack>
                    </VStack>
                  </VStack>
                </Box>
              ))}
            </VStack>
          </VStack>
        </Box>
      )}

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-20">
          <Heading level="2" size="medium">
            <PackageIcon aria-hidden /> Repositories
          </Heading>

          {activeRepo && (
            <VStack gap="space-8">
              <Label>Aktivt repository</Label>
              <HStack gap="space-8" align="center">
                <ExternalLink href={`https://github.com/${activeRepo.github_owner}/${activeRepo.github_repo_name}`}>
                  {activeRepo.github_owner}/{activeRepo.github_repo_name}
                </ExternalLink>
                <Tag data-color="success" size="xsmall" variant="outline">
                  AKTIV
                </Tag>
              </HStack>
            </VStack>
          )}

          {!activeRepo && (
            <Alert variant="warning" size="small">
              Ingen aktivt repository satt for denne applikasjonen
            </Alert>
          )}

          {pendingRepos.length > 0 && (
            <VStack gap="space-12">
              <Label>Venter godkjenning ({pendingRepos.length})</Label>
              {pendingRepos.map((repo) => (
                <Box key={repo.id} padding="space-16" borderRadius="8" background="sunken">
                  <HStack gap="space-8" align="center" justify="space-between" wrap>
                    <HStack gap="space-8" align="center">
                      <BodyShort weight="semibold">
                        {repo.github_owner}/{repo.github_repo_name}
                      </BodyShort>
                      <Tag data-color="warning" size="xsmall" variant="outline">
                        Venter
                      </Tag>
                    </HStack>
                    <HStack gap="space-8">
                      <Button size="xsmall" variant="primary">
                        Godkjenn
                      </Button>
                      <Button size="xsmall" variant="danger">
                        Avvis
                      </Button>
                    </HStack>
                  </HStack>
                </Box>
              ))}
            </VStack>
          )}
        </VStack>
      </Box>
    </VStack>
  )
}
