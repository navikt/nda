import { WrenchIcon } from '@navikt/aksel-icons'
import type { SortState } from '@navikt/ds-react'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Heading,
  Hide,
  HStack,
  Show,
  Table,
  Tag,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useMemo, useState } from 'react'
import { Form, Link, useActionData, useLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { ExternalLink } from '~/components/ExternalLink'
import { pool } from '~/db/connection.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/data-mismatches'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Datakvalitet - Admin - NDA' }]
}

interface TitleMismatch {
  id: number
  app_name: string
  team_slug: string
  environment_name: string
  stored_title: string
  pr_title: string
  four_eyes_status: string
  github_pr_number: number | null
  detected_github_owner: string
  detected_github_repo_name: string
}

interface MissingSummary {
  total_missing: number
  with_pr_data: number
  with_unverified_commits: number
  no_fallback: number
}

interface BaselineNoApprover {
  id: number
  app_name: string
  team_slug: string
  environment_name: string
  deployed_at: Date
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const [mismatchResult, missingResult, baselineNoApproverResult] = await Promise.all([
    pool.query<TitleMismatch>(
      `SELECT
         d.id,
         ma.app_name,
         ma.team_slug,
         ma.environment_name,
         d.title AS stored_title,
         d.github_pr_data->>'title' AS pr_title,
         d.four_eyes_status,
         d.github_pr_number,
         d.detected_github_owner,
         d.detected_github_repo_name
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.github_pr_data IS NOT NULL
         AND d.github_pr_data->>'title' IS NOT NULL
         AND d.github_pr_data->>'title' != ''
         AND d.title IS NOT NULL
         AND d.title != d.github_pr_data->>'title'
       ORDER BY d.id DESC`,
    ),
    pool.query<MissingSummary>(
      `SELECT
         (COUNT(*) FILTER (WHERE d.title IS NULL))::int AS total_missing,
         (COUNT(*) FILTER (WHERE d.title IS NULL AND d.github_pr_data IS NOT NULL AND d.github_pr_data->>'title' IS NOT NULL))::int AS with_pr_data,
         (COUNT(*) FILTER (WHERE d.title IS NULL AND (d.github_pr_data IS NULL OR d.github_pr_data->>'title' IS NULL) AND d.unverified_commits IS NOT NULL AND jsonb_array_length(d.unverified_commits) > 0))::int AS with_unverified_commits,
         (COUNT(*) FILTER (WHERE d.title IS NULL AND (d.github_pr_data IS NULL OR d.github_pr_data->>'title' IS NULL) AND (d.unverified_commits IS NULL OR jsonb_array_length(d.unverified_commits) = 0)))::int AS no_fallback
       FROM deployments d`,
    ),
    pool.query<BaselineNoApprover>(
      `SELECT
         d.id,
         ma.app_name,
         ma.team_slug,
         ma.environment_name,
         d.created_at AS deployed_at
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.four_eyes_status = 'baseline'
         AND NOT EXISTS (
           SELECT 1 FROM deployment_status_history dsh
             WHERE dsh.deployment_id = d.id
               AND dsh.change_source = 'baseline_approval'
               AND dsh.changed_by IS NOT NULL
         )
       ORDER BY d.created_at DESC`,
    ),
  ])

  return {
    mismatches: mismatchResult.rows,
    mismatchCount: mismatchResult.rowCount ?? 0,
    missing: missingResult.rows[0] ?? { total_missing: 0, with_pr_data: 0, with_unverified_commits: 0, no_fallback: 0 },
    baselineNoApprover: baselineNoApproverResult.rows,
  }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'fix_mismatches') {
    const result = await pool.query(
      `UPDATE deployments
       SET title = github_pr_data->>'title'
       WHERE github_pr_data IS NOT NULL
         AND github_pr_data->>'title' IS NOT NULL
         AND github_pr_data->>'title' != ''
         AND title IS NOT NULL
         AND title != github_pr_data->>'title'`,
    )
    const count = result.rowCount ?? 0
    return { success: `Korrigerte ${count} feil titler.` }
  }

  if (intent === 'fix_missing') {
    const result = await pool.query(
      `UPDATE deployments
       SET title = github_pr_data->>'title'
       WHERE title IS NULL
         AND github_pr_data IS NOT NULL
         AND github_pr_data->>'title' IS NOT NULL
         AND github_pr_data->>'title' != ''`,
    )
    const count = result.rowCount ?? 0
    return { success: `Fylte inn ${count} manglende titler fra PR-data.` }
  }

  return { error: 'Ukjent handling' }
}

function truncate(str: string, maxLength: number) {
  if (str.length <= maxLength) return str
  return `${str.slice(0, maxLength)}…`
}

export default function DataMismatches() {
  const { mismatches, mismatchCount, missing, baselineNoApprover } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  const [mismatchFilter, setMismatchFilter] = useState('')
  const [mismatchSort, setMismatchSort] = useState<SortState>()

  const [baselineFilter, setBaselineFilter] = useState('')
  const [baselineSort, setBaselineSort] = useState<SortState>()

  function handleSort(current: SortState | undefined, set: (s: SortState | undefined) => void) {
    return (sortKey: string | undefined) => {
      if (!sortKey) return set(undefined)
      if (current?.orderBy === sortKey) {
        current.direction === 'ascending' ? set({ orderBy: sortKey, direction: 'descending' }) : set(undefined)
      } else {
        set({ orderBy: sortKey, direction: 'ascending' })
      }
    }
  }

  const filteredMismatches = useMemo(() => {
    const filtered = mismatches.filter((m) => {
      if (!mismatchFilter) return true
      const q = mismatchFilter.toLowerCase()
      return [
        m.id.toString(),
        m.app_name,
        m.stored_title,
        m.pr_title,
        m.four_eyes_status,
        m.github_pr_number != null ? `#${m.github_pr_number}` : '',
      ].some((v) => v.toLowerCase().includes(q))
    })
    if (!mismatchSort) return filtered
    const dir = mismatchSort.direction === 'ascending' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (mismatchSort.orderBy) {
        case 'id':
          return (a.id - b.id) * dir
        case 'app_name':
          return a.app_name.localeCompare(b.app_name, 'nb') * dir
        case 'stored_title':
          return a.stored_title.localeCompare(b.stored_title, 'nb') * dir
        case 'pr_title':
          return a.pr_title.localeCompare(b.pr_title, 'nb') * dir
        case 'four_eyes_status':
          return a.four_eyes_status.localeCompare(b.four_eyes_status, 'nb') * dir
        case 'github_pr_number':
          return ((a.github_pr_number ?? 0) - (b.github_pr_number ?? 0)) * dir
        default:
          return 0
      }
    })
  }, [mismatches, mismatchFilter, mismatchSort])

  const baselineWithTs = useMemo(
    () =>
      baselineNoApprover.map((b) => {
        const d = new Date(b.deployed_at)
        return { ...b, deployedTs: d.getTime(), deployedStr: d.toLocaleDateString('nb-NO') }
      }),
    [baselineNoApprover],
  )

  const filteredBaseline = useMemo(() => {
    const filtered = baselineWithTs.filter((b) => {
      if (!baselineFilter) return true
      const q = baselineFilter.toLowerCase()
      return [b.id.toString(), b.app_name, b.team_slug, b.environment_name, b.deployedStr].some((v) =>
        v.toLowerCase().includes(q),
      )
    })
    if (!baselineSort) return filtered
    const dir = baselineSort.direction === 'ascending' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (baselineSort.orderBy) {
        case 'id':
          return (a.id - b.id) * dir
        case 'app_name':
          return a.app_name.localeCompare(b.app_name, 'nb') * dir
        case 'team_slug':
          return a.team_slug.localeCompare(b.team_slug, 'nb') * dir
        case 'environment_name':
          return a.environment_name.localeCompare(b.environment_name, 'nb') * dir
        case 'deployed_at':
          return (a.deployedTs - b.deployedTs) * dir
        default:
          return 0
      }
    })
  }, [baselineWithTs, baselineFilter, baselineSort])

  return (
    <VStack gap="space-24">
      <VStack gap="space-8">
        <Heading level="1" size="large">
          Datakvalitet
        </Heading>
        <BodyShort textColor="subtle">
          Denne siden samler datakvalitetsproblemer som kan påvirke auditrapporter og deployment-oversikter.
        </BodyShort>
      </VStack>

      <ActionAlert data={actionData} />

      <Heading level="2" size="medium">
        Tittel-avvik
      </Heading>

      {/* Summary cards */}
      <HStack gap="space-16" wrap>
        <Box
          padding="space-16"
          borderRadius="8"
          borderWidth="1"
          borderColor={mismatchCount > 0 ? 'danger-subtle' : 'success-subtle'}
        >
          <VStack gap="space-4">
            <Heading size="medium">{mismatchCount}</Heading>
            <BodyShort size="small">Feil tittel (mismatch)</BodyShort>
          </VStack>
        </Box>
        <Box
          padding="space-16"
          borderRadius="8"
          borderWidth="1"
          borderColor={Number(missing.with_pr_data) > 0 ? 'warning-subtle' : 'neutral-subtle'}
        >
          <VStack gap="space-4">
            <Heading size="medium">{missing.with_pr_data}</Heading>
            <BodyShort size="small">Kan fylles fra PR-data</BodyShort>
          </VStack>
        </Box>
        <Box padding="space-16" borderRadius="8" borderWidth="1" borderColor="neutral-subtle">
          <VStack gap="space-4">
            <Heading size="medium">{missing.total_missing}</Heading>
            <BodyShort size="small">Manglende tittel (NULL)</BodyShort>
          </VStack>
        </Box>
      </HStack>

      {/* Explanation */}
      <Box background="neutral-softA" padding="space-16" borderRadius="8">
        <VStack gap="space-8">
          <Heading level="2" size="xsmall">
            Hva betyr tallene?
          </Heading>
          <VStack as="ul" gap="space-4">
            <li>
              <BodyShort size="small">
                <strong>Feil tittel</strong> — den lagrede tittelen avviker fra PR-tittelen i GitHub. Dette kan skje
                hvis en PR-tittel endres etter at deployment ble registrert. Bør korrigeres med knappen under.
              </BodyShort>
            </li>
            <li>
              <BodyShort size="small">
                <strong>Kan fylles fra PR-data</strong> — deployments uten tittel, men der PR-data er tilgjengelig slik
                at tittelen kan fylles inn automatisk. Bør fylles med knappen under.
              </BodyShort>
            </li>
            <li>
              <BodyShort size="small">
                <strong>Manglende tittel</strong> — deployments uten tittel og uten PR-data å hente fra. Typisk eldre
                deployments fra før NDA begynte å samle PR-data, eller deployments uten tilknyttet PR (f.eks. direkte
                push til main). Krever ingen handling.
              </BodyShort>
            </li>
          </VStack>
        </VStack>
      </Box>

      {/* Fix actions */}
      <HStack gap="space-12">
        {mismatchCount > 0 && (
          <Form method="post">
            <input type="hidden" name="intent" value="fix_mismatches" />
            <Button variant="primary" size="small" icon={<WrenchIcon aria-hidden />}>
              Korriger {mismatchCount} feil titler
            </Button>
          </Form>
        )}
        {Number(missing.with_pr_data) > 0 && (
          <Form method="post">
            <input type="hidden" name="intent" value="fix_missing" />
            <Button variant="secondary" size="small" icon={<WrenchIcon aria-hidden />}>
              Fyll inn {missing.with_pr_data} manglende titler
            </Button>
          </Form>
        )}
      </HStack>

      {/* Mismatch table */}
      {mismatchCount > 0 && (
        <VStack gap="space-12">
          <Heading level="2" size="medium">
            Mismatches ({mismatchCount})
          </Heading>

          <TextField
            label="Filtrer tittel-avvik"
            hideLabel
            placeholder="Filtrer på ID, app, tittel eller status…"
            size="small"
            value={mismatchFilter}
            onChange={(e) => setMismatchFilter(e.target.value)}
          />

          <Show above="md">
            <div style={{ overflowX: 'auto' }}>
              <Table size="small" sort={mismatchSort} onSortChange={handleSort(mismatchSort, setMismatchSort)}>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader sortKey="id">ID</Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="app_name">App</Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="stored_title">Lagret tittel</Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="pr_title">PR-tittel (riktig)</Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="four_eyes_status">Status</Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="github_pr_number">PR</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filteredMismatches.map((m) => (
                    <Table.Row key={m.id}>
                      <Table.DataCell>
                        <Link to={`/deployments/${m.id}`}>{m.id}</Link>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{m.app_name}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <Tag variant="moderate" data-color="danger" size="xsmall">
                          {truncate(m.stored_title, 60)}
                        </Tag>
                      </Table.DataCell>
                      <Table.DataCell>
                        <Tag variant="moderate" data-color="success" size="xsmall">
                          {truncate(m.pr_title, 60)}
                        </Tag>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{m.four_eyes_status}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        {m.github_pr_number && (
                          <ExternalLink
                            href={`https://github.com/${m.detected_github_owner}/${m.detected_github_repo_name}/pull/${m.github_pr_number}`}
                          >
                            #{m.github_pr_number}
                          </ExternalLink>
                        )}
                      </Table.DataCell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          </Show>

          <Hide above="md">
            <VStack gap="space-12">
              {filteredMismatches.map((m) => (
                <Box key={m.id} padding="space-16" borderRadius="8" borderWidth="1" borderColor="neutral-subtle">
                  <VStack gap="space-8">
                    <HStack justify="space-between" align="center">
                      <Link to={`/deployments/${m.id}`}>
                        <BodyShort weight="semibold">#{m.id}</BodyShort>
                      </Link>
                      <BodyShort size="small" textColor="subtle">
                        {m.app_name}
                      </BodyShort>
                    </HStack>
                    <VStack gap="space-4">
                      <BodyShort size="small" textColor="subtle">
                        Lagret:
                      </BodyShort>
                      <Tag variant="moderate" data-color="danger" size="xsmall">
                        {truncate(m.stored_title, 80)}
                      </Tag>
                    </VStack>
                    <VStack gap="space-4">
                      <BodyShort size="small" textColor="subtle">
                        PR-tittel:
                      </BodyShort>
                      <Tag variant="moderate" data-color="success" size="xsmall">
                        {truncate(m.pr_title, 80)}
                      </Tag>
                    </VStack>
                  </VStack>
                </Box>
              ))}
            </VStack>
          </Hide>
        </VStack>
      )}

      {mismatchCount === 0 && (
        <Alert variant="success">
          Ingen tittel-mismatches funnet. Alle deployments med PR-data har konsistente titler.
        </Alert>
      )}

      {/* Baseline without approver section */}
      <VStack gap="space-12">
        <VStack gap="space-4">
          <Heading level="2" size="medium">
            Baseline uten godkjenner
          </Heading>
          <BodyShort textColor="subtle">
            Baseline-deployments som mangler en godkjent <code>baseline_approval</code>-rad i statushistorikken
            (godkjenner ikke logget). Disse vil kaste feil ved generering av auditrapport. Årsak: deployments godkjent
            som baseline før logging av godkjenner ble innført.
          </BodyShort>
        </VStack>

        {baselineNoApprover.length === 0 ? (
          <Alert variant="success">Ingen baseline-deployments mangler godkjenner. Auditrapporter kan genereres.</Alert>
        ) : (
          <>
            <Alert variant="warning">
              {baselineNoApprover.length} baseline-deployment
              {baselineNoApprover.length === 1 ? '' : 's'} mangler godkjenner og vil blokkere auditrapport-generering.
              Åpne hvert deployment og godkjenn på nytt for å reparere.
            </Alert>

            <TextField
              label="Filtrer baseline-deployments"
              hideLabel
              placeholder="Filtrer på ID, app, team eller miljø…"
              size="small"
              value={baselineFilter}
              onChange={(e) => setBaselineFilter(e.target.value)}
            />

            <div style={{ overflowX: 'auto' }}>
              <Table size="small" sort={baselineSort} onSortChange={handleSort(baselineSort, setBaselineSort)}>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader sortKey="id">ID</Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="app_name">App</Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="team_slug">Team</Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="environment_name">Miljø</Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="deployed_at">Deployet</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filteredBaseline.map((b) => (
                    <Table.Row key={b.id}>
                      <Table.DataCell>
                        <Link to={`/deployments/${b.id}`}>{b.id}</Link>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{b.app_name}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{b.team_slug}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{b.environment_name}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{new Date(b.deployed_at).toLocaleDateString('nb-NO')}</BodyShort>
                      </Table.DataCell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          </>
        )}
      </VStack>
    </VStack>
  )
}
