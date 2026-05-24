import { WrenchIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, Hide, HStack, Show, Table, Tag, VStack } from '@navikt/ds-react'
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
  deployed_at: string
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
         AND dsh.to_status = 'baseline'
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

          <Show above="md">
            <Box borderWidth="1" borderColor="neutral-subtle" borderRadius="8" style={{ overflow: 'auto' }}>
              <Table size="small">
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>ID</Table.HeaderCell>
                    <Table.HeaderCell>App</Table.HeaderCell>
                    <Table.HeaderCell>Lagret tittel</Table.HeaderCell>
                    <Table.HeaderCell>PR-tittel (riktig)</Table.HeaderCell>
                    <Table.HeaderCell>Status</Table.HeaderCell>
                    <Table.HeaderCell>PR</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {mismatches.map((m) => (
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
            </Box>
          </Show>

          <Hide above="md">
            <VStack gap="space-12">
              {mismatches.map((m) => (
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
            Baseline-deployments der godkjenneren mangler i statushistorikken (<code>changed_by = NULL</code>). Disse
            vil kaste feil ved generering av auditrapport. Årsak: deployments godkjent som baseline før logging av
            godkjenner ble innført.
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
            <Box borderWidth="1" borderColor="neutral-subtle" borderRadius="8" style={{ overflow: 'auto' }}>
              <Table size="small">
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>ID</Table.HeaderCell>
                    <Table.HeaderCell>App</Table.HeaderCell>
                    <Table.HeaderCell>Team</Table.HeaderCell>
                    <Table.HeaderCell>Miljø</Table.HeaderCell>
                    <Table.HeaderCell>Deployet</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {baselineNoApprover.map((b) => (
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
            </Box>
          </>
        )}
      </VStack>
    </VStack>
  )
}
