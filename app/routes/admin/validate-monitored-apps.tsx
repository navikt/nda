import { ArrowsCirclepathIcon, CheckmarkCircleIcon, ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Select, Table, Tag, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { Form, useActionData, useLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import {
  getAllMonitoredApplications,
  updateMonitoredApplication,
  updateMonitoredApplicationIdentity,
} from '~/db/monitored-applications.server'
import { type ActionResult, fail, ok } from '~/lib/action-result'
import { requireAdmin } from '~/lib/auth.server'
import { getFormString } from '~/lib/form-validators'
import { logger } from '~/lib/logger.server'
import { classifyAll, type ValidationStatus } from '~/lib/monitored-app-validator'
import { fetchAllTeamsAndApplications } from '~/lib/nais.server'
import type { Route } from './+types/validate-monitored-apps'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Valider apper mot Nais - Admin - NDA' }]
}

const STATUS_LABEL: Record<ValidationStatus, string> = {
  ok: 'OK',
  swapped: 'Team og app byttet om',
  wrong_env: 'Feil miljø',
  swapped_wrong_env: 'Byttet om + feil miljø',
  missing: 'Finnes ikke i Nais',
}

const STATUS_TAG_VARIANT: Record<ValidationStatus, 'success' | 'warning' | 'error'> = {
  ok: 'success',
  swapped: 'warning',
  wrong_env: 'warning',
  swapped_wrong_env: 'warning',
  missing: 'error',
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const monitored = await getAllMonitoredApplications()

  let naisError: string | null = null
  let naisApps: Array<{ teamSlug: string; appName: string; environmentName: string }> = []
  try {
    naisApps = await fetchAllTeamsAndApplications()
  } catch (error) {
    logger.error('Kunne ikke hente Nais-katalog for validering:', error)
    naisError = error instanceof Error ? error.message : String(error)
  }

  const results = naisError ? [] : classifyAll(monitored, naisApps)
  const summary = {
    total: monitored.length,
    ok: results.filter((r) => r.status === 'ok').length,
    swapped: results.filter((r) => r.status === 'swapped').length,
    wrong_env: results.filter((r) => r.status === 'wrong_env').length,
    swapped_wrong_env: results.filter((r) => r.status === 'swapped_wrong_env').length,
    missing: results.filter((r) => r.status === 'missing').length,
  }

  return { results, summary, naisError }
}

export async function action({ request }: Route.ActionArgs): Promise<ActionResult> {
  await requireAdmin(request)
  const formData = await request.formData()
  const intent = formData.get('intent')
  const idStr = getFormString(formData, 'id')
  const id = idStr ? Number(idStr) : Number.NaN
  if (!Number.isInteger(id) || id <= 0) {
    return fail('Ugyldig id.')
  }

  if (intent === 'apply_fix') {
    const team = getFormString(formData, 'team_slug')
    const env = getFormString(formData, 'environment_name')
    const app = getFormString(formData, 'app_name')
    if (!team || !env || !app) {
      return fail('Mangler felter for fiks.')
    }
    try {
      await updateMonitoredApplicationIdentity(id, { team_slug: team, environment_name: env, app_name: app })
      return ok(`Oppdatert til ${team}/${env}/${app}.`)
    } catch (error) {
      return fail(`Kunne ikke oppdatere: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (intent === 'deactivate') {
    try {
      await updateMonitoredApplication(id, { is_active: false })
      return ok('Applikasjonen er deaktivert.')
    } catch (error) {
      return fail(`Kunne ikke deaktivere: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return fail('Ukjent intent.')
}

export default function ValidateMonitoredApps() {
  const { results, summary, naisError } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  const problems = results.filter((r) => r.status !== 'ok')

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Valider apper mot Nais
        </Heading>
        <BodyShort textColor="subtle">
          Sammenligner alle aktive <code>monitored_applications</code>-rader mot Nais-katalogen og foreslår rettelser
          når team/app er byttet om eller miljøet er feil.
        </BodyShort>
      </div>

      <ActionAlert data={actionData} />

      {naisError && (
        <Alert variant="error">Kunne ikke hente data fra Nais: {naisError}. Validering ble ikke utført.</Alert>
      )}

      <HStack gap="space-12" wrap>
        <SummaryTile icon={<CheckmarkCircleIcon aria-hidden />} label="OK" value={summary.ok} />
        <SummaryTile icon={<ExclamationmarkTriangleIcon aria-hidden />} label="Byttet om" value={summary.swapped} />
        <SummaryTile icon={<ExclamationmarkTriangleIcon aria-hidden />} label="Feil miljø" value={summary.wrong_env} />
        <SummaryTile
          icon={<ExclamationmarkTriangleIcon aria-hidden />}
          label="Byttet om + feil miljø"
          value={summary.swapped_wrong_env}
        />
        <SummaryTile
          icon={<ExclamationmarkTriangleIcon aria-hidden />}
          label="Mangler i Nais"
          value={summary.missing}
        />
        <SummaryTile icon={<ArrowsCirclepathIcon aria-hidden />} label="Totalt" value={summary.total} />
      </HStack>

      {problems.length === 0 && !naisError ? (
        <Alert variant="success">Alle aktive apper matcher Nais-katalogen.</Alert>
      ) : (
        <Box background="raised" borderRadius="8" borderColor="neutral-subtle" borderWidth="1" padding="space-16">
          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell scope="col">Status</Table.HeaderCell>
                <Table.HeaderCell scope="col">Lagret (team / miljø / app)</Table.HeaderCell>
                <Table.HeaderCell scope="col">Foreslått</Table.HeaderCell>
                <Table.HeaderCell scope="col">Handling</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {problems.map((row) => (
                <Table.Row key={row.id}>
                  <Table.DataCell>
                    <Tag size="small" variant={STATUS_TAG_VARIANT[row.status]}>
                      {STATUS_LABEL[row.status]}
                    </Tag>
                  </Table.DataCell>
                  <Table.DataCell>
                    <code>
                      {row.stored.team_slug} / {row.stored.environment_name} / {row.stored.app_name}
                    </code>
                  </Table.DataCell>
                  <Table.DataCell>
                    {row.suggested ? (
                      <code>
                        {row.suggested.team_slug} / {row.suggested.environment_name} / {row.suggested.app_name}
                      </code>
                    ) : row.candidates.length > 0 ? (
                      <BodyShort size="small" textColor="subtle">
                        Flere mulige miljøer, velg ett →
                      </BodyShort>
                    ) : (
                      <BodyShort textColor="subtle">—</BodyShort>
                    )}
                  </Table.DataCell>
                  <Table.DataCell>
                    <HStack gap="space-8" align="end">
                      {row.suggested && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="apply_fix" />
                          <input type="hidden" name="id" value={row.id} />
                          <input type="hidden" name="team_slug" value={row.suggested.team_slug} />
                          <input type="hidden" name="environment_name" value={row.suggested.environment_name} />
                          <input type="hidden" name="app_name" value={row.suggested.app_name} />
                          <Button size="small" type="submit" variant="primary">
                            Bruk forslag
                          </Button>
                        </Form>
                      )}
                      {!row.suggested && row.candidates.length > 0 && (
                        <CandidatePicker id={row.id} candidates={row.candidates} />
                      )}
                      <Form method="post">
                        <input type="hidden" name="intent" value="deactivate" />
                        <input type="hidden" name="id" value={row.id} />
                        <Button size="small" type="submit" variant="secondary">
                          Deaktiver
                        </Button>
                      </Form>
                    </HStack>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Box>
      )}
    </VStack>
  )
}

function SummaryTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Box
      background="raised"
      borderRadius="8"
      borderColor="neutral-subtle"
      borderWidth="1"
      padding="space-12"
      style={{ minWidth: '11rem' }}
    >
      <HStack gap="space-8" align="center">
        {icon}
        <VStack gap="space-0">
          <Heading level="2" size="small">
            {value}
          </Heading>
          <BodyShort size="small" textColor="subtle">
            {label}
          </BodyShort>
        </VStack>
      </HStack>
    </Box>
  )
}

function CandidatePicker({
  id,
  candidates,
}: {
  id: number
  candidates: { team_slug: string; environment_name: string; app_name: string }[]
}) {
  const [selected, setSelected] = useState(candidates[0].environment_name)
  const chosen = candidates.find((c) => c.environment_name === selected) ?? candidates[0]

  return (
    <Form method="post">
      <HStack gap="space-8" align="end">
        <input type="hidden" name="intent" value="apply_fix" />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="team_slug" value={chosen.team_slug} />
        <input type="hidden" name="environment_name" value={chosen.environment_name} />
        <input type="hidden" name="app_name" value={chosen.app_name} />
        <Select size="small" label="Miljø" hideLabel value={selected} onChange={(e) => setSelected(e.target.value)}>
          {candidates.map((c) => (
            <option key={c.environment_name} value={c.environment_name}>
              {c.environment_name}
            </option>
          ))}
        </Select>
        <Button size="small" type="submit" variant="primary">
          Bruk valgt miljø
        </Button>
      </HStack>
    </Form>
  )
}
