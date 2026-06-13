import { DownloadIcon, EyeIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  Hide,
  HStack,
  Show,
  Table,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Link, useLoaderData } from 'react-router'
import { getAllAuditReports } from '~/db/audit-reports.server'
import { getAllUsersWithAccounts } from '~/db/user-github-lookups.server'
import { requireAdmin } from '~/lib/auth.server'
import styles from '~/styles/common.module.css'
import type { Route } from './+types/audit-reports'

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const [reports, userMappings] = await Promise.all([getAllAuditReports(), getAllUsersWithAccounts()])

  const displayNameMap: Record<string, string> = Object.fromEntries(
    userMappings.map((u) => [u.nav_ident.toUpperCase(), u.display_name]),
  )

  return { reports, displayNameMap }
}

export function meta() {
  return [{ title: 'Leveranserapporter - Admin' }]
}

function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminAuditReports() {
  const { reports, displayNameMap } = useLoaderData<typeof loader>()

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Leveranserapport
        </Heading>
        <BodyShort textColor="subtle">
          Oversikt over genererte leveranserapporter. For å generere ny rapport, gå til admin-siden for den aktuelle
          applikasjonen.
        </BodyShort>
      </div>

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading level="2" size="medium" spacing>
              Utstedte leveranserapport
            </Heading>
            <BodyShort textColor="subtle">{reports.length} leveranserapport er generert.</BodyShort>
          </div>

          {reports.length === 0 ? (
            <BodyShort textColor="subtle">Ingen leveranserapport er generert enda.</BodyShort>
          ) : (
            <>
              {/* Desktop table */}
              <Show above="md">
                <Table size="small">
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Dokument-ID</Table.HeaderCell>
                      <Table.HeaderCell>Applikasjon</Table.HeaderCell>
                      <Table.HeaderCell>Periode</Table.HeaderCell>
                      <Table.HeaderCell>Deployments</Table.HeaderCell>
                      <Table.HeaderCell>Generert</Table.HeaderCell>
                      <Table.HeaderCell>Handlinger</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {reports.map((report) => (
                      <Table.Row
                        key={report.id}
                        style={report.archived_at || report.superseded_at ? { opacity: 0.5 } : undefined}
                      >
                        <Table.DataCell>
                          <code style={{ fontSize: '0.75rem' }}>{report.report_id}</code>
                          {report.superseded_at && (
                            <Detail textColor="subtle">
                              Erstattet
                              {report.superseded_by
                                ? ` av ${displayNameMap[report.superseded_by.toUpperCase()] ?? report.superseded_by}`
                                : ''}
                              {report.supersede_reason ? `: ${report.supersede_reason}` : ''}
                            </Detail>
                          )}
                          {report.archived_at && !report.superseded_at && (
                            <Detail textColor="subtle">
                              Arkivert
                              {report.archived_by
                                ? ` av ${displayNameMap[report.archived_by.toUpperCase()] ?? report.archived_by}`
                                : ''}
                              : {report.archive_reason}
                            </Detail>
                          )}
                        </Table.DataCell>
                        <Table.DataCell>
                          <VStack gap="space-2">
                            <AkselLink
                              as={Link}
                              to={`/team/${report.team_slug}/env/${report.environment_name}/app/${report.app_name}/admin`}
                            >
                              {report.app_name}
                            </AkselLink>
                            <Detail>{report.environment_name}</Detail>
                          </VStack>
                        </Table.DataCell>
                        <Table.DataCell>{report.period_label || report.year}</Table.DataCell>
                        <Table.DataCell>
                          <VStack gap="space-2">
                            <BodyShort size="small">{report.total_deployments} totalt</BodyShort>
                            <Detail>
                              {report.pr_approved_count} PR, {report.manually_approved_count} manuell
                            </Detail>
                          </VStack>
                        </Table.DataCell>
                        <Table.DataCell>{formatDateTime(report.generated_at)}</Table.DataCell>
                        <Table.DataCell>
                          <HStack gap="space-8">
                            <Button
                              as="a"
                              href={`/admin/audit-reports/${report.id}/view`}
                              target="_blank"
                              size="small"
                              variant="tertiary"
                              icon={<EyeIcon aria-hidden />}
                            >
                              Vis
                            </Button>
                            <Button
                              as="a"
                              href={`/admin/audit-reports/${report.id}/pdf`}
                              size="small"
                              variant="tertiary"
                              icon={<DownloadIcon aria-hidden />}
                            >
                              Last ned
                            </Button>
                          </HStack>
                        </Table.DataCell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </Show>

              {/* Mobile cards */}
              <Hide above="md">
                <div>
                  {reports.map((report) => (
                    <Box
                      key={report.id}
                      padding="space-16"
                      background="default"
                      className={styles.stackedListItem}
                      style={report.archived_at || report.superseded_at ? { opacity: 0.5 } : undefined}
                    >
                      <VStack gap="space-8">
                        <HStack justify="space-between" align="start" wrap>
                          <div>
                            <AkselLink
                              as={Link}
                              to={`/team/${report.team_slug}/env/${report.environment_name}/app/${report.app_name}/admin`}
                            >
                              {report.app_name}
                            </AkselLink>
                            <Detail>
                              {report.environment_name} • {report.period_label || report.year}
                            </Detail>
                          </div>
                          <Tag variant="success" size="small">
                            {report.total_deployments} deployments
                          </Tag>
                        </HStack>
                        {report.superseded_at && (
                          <Detail textColor="subtle">
                            Erstattet
                            {report.superseded_by
                              ? ` av ${displayNameMap[report.superseded_by.toUpperCase()] ?? report.superseded_by}`
                              : ''}
                            {report.supersede_reason ? `: ${report.supersede_reason}` : ''}
                          </Detail>
                        )}
                        {report.archived_at && !report.superseded_at && (
                          <Detail textColor="subtle">
                            Arkivert
                            {report.archived_by
                              ? ` av ${displayNameMap[report.archived_by.toUpperCase()] ?? report.archived_by}`
                              : ''}
                            : {report.archive_reason}
                          </Detail>
                        )}
                        <Detail>Generert: {formatDateTime(report.generated_at)}</Detail>
                        <code style={{ fontSize: '0.65rem', wordBreak: 'break-all' }}>{report.report_id}</code>
                        <HStack gap="space-8">
                          <Button
                            as="a"
                            href={`/admin/audit-reports/${report.id}/view`}
                            target="_blank"
                            size="small"
                            variant="secondary"
                            icon={<EyeIcon aria-hidden />}
                          >
                            Vis
                          </Button>
                          <Button
                            as="a"
                            href={`/admin/audit-reports/${report.id}/pdf`}
                            size="small"
                            variant="secondary"
                            icon={<DownloadIcon aria-hidden />}
                          >
                            Last ned
                          </Button>
                        </HStack>
                      </VStack>
                    </Box>
                  ))}
                </div>
              </Hide>
            </>
          )}
        </VStack>
      </Box>
    </VStack>
  )
}
