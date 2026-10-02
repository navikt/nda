import {
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  CopyButton,
  Heading,
  HStack,
  VStack,
} from '@navikt/ds-react'
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router'
import { pool } from '~/db/connection.server'
import { buildDevTeamSummaryStatsWithBoardsQuery } from '~/db/dashboard-stats.server'
import { resolveDevTeamScope } from '~/db/deployments/home.server'
import { getAllDevTeams } from '~/db/dev-teams.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/query-plan-dev-team-stats'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Query-plan: getDevTeamSummaryStats - Admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const devTeams = await getAllDevTeams()
  return { devTeams }
}

type ActionData = { error: string } | { planJson: string; measuredDurationMs: number; devTeamIds: number[] }

export async function action({ request }: Route.ActionArgs): Promise<ActionData> {
  await requireAdmin(request)
  const formData = await request.formData()
  const devTeamIds = formData.getAll('devTeamId').map((v) => Number(v))

  if (devTeamIds.length === 0) {
    return { error: 'Velg minst ett team' }
  }

  const devTeams = await getAllDevTeams()
  const selectedTeams = devTeams.filter((t) => devTeamIds.includes(t.id))
  const scope = await resolveDevTeamScope(selectedTeams)
  const ytdStart = new Date(new Date().getFullYear(), 0, 1)

  const { sql, params } = buildDevTeamSummaryStatsWithBoardsQuery(
    scope.naisTeamSlugs,
    scope.directAppIds,
    ytdStart,
    scope.deployerUsernames,
    devTeamIds,
  )

  const startedAt = Date.now()
  try {
    const explainResult = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params)
    const measuredDurationMs = Date.now() - startedAt
    const planJson = JSON.stringify(explainResult.rows[0]['QUERY PLAN'], null, 2)
    return { planJson, measuredDurationMs, devTeamIds }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export default function QueryPlanDevTeamStatsPage() {
  const { devTeams } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  return (
    <VStack gap="space-24">
      <div>
        <Heading size="large" level="1">
          Query-plan: getDevTeamSummaryStats
        </Heading>
        <BodyShort textColor="subtle">
          Midlertidig diagnoseverktøy for å hente en reell Postgres EXPLAIN ANALYZE-plan for den tunge
          team_apps-spørringen brukt av /my-teams, uten å påvirke vanlige brukere. Kjører kun når du selv trykker "Kjør
          EXPLAIN".
        </BodyShort>
      </div>

      <Alert variant="warning" size="small">
        Kjører EXPLAIN ANALYZE mot produksjonsdatabasen og utfører dermed spørringen reelt (ikke bare en
        kostnadsestimering). Bruk med måte.
      </Alert>

      <Form method="post">
        <VStack gap="space-16">
          <CheckboxGroup legend="Velg team(ene) som skal simuleres" size="small">
            {devTeams.map((team) => (
              <Checkbox key={team.id} name="devTeamId" value={String(team.id)}>
                {team.name} ({team.nais_team_slugs.join(', ') || 'ingen nais-team'})
              </Checkbox>
            ))}
          </CheckboxGroup>
          <HStack>
            <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
              Kjør EXPLAIN
            </Button>
          </HStack>
        </VStack>
      </Form>

      {actionData && 'error' in actionData && (
        <Alert variant="error" size="small">
          {actionData.error}
        </Alert>
      )}

      {actionData && 'planJson' in actionData && (
        <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <HStack align="center" justify="space-between">
            <BodyShort>
              Målt varighet: <strong>{actionData.measuredDurationMs} ms</strong>
            </BodyShort>
            <CopyButton copyText={actionData.planJson} size="small" text="Kopier plan" activeText="Kopiert!" />
          </HStack>
          <pre style={{ overflowX: 'auto', fontSize: '0.75rem', marginTop: '1rem' }}>{actionData.planJson}</pre>
        </Box>
      )}
    </VStack>
  )
}
