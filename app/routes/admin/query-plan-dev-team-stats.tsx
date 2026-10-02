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
import { ActionAlert } from '~/components/ActionAlert'
import { pool } from '~/db/connection.server'
import { resolveDevTeamScope } from '~/db/deployments/home.server'
import { getAllDevTeams } from '~/db/dev-teams.server'
import { effectiveAuditStartYearSql } from '~/db/repository-settings-sql'
import { lowerUsernames } from '~/db/user-deployment-match'
import { fail } from '~/lib/action-result'
import { requireAdmin } from '~/lib/auth.server'
import { APPROVED_STATUSES_SQL, PENDING_STATUSES_SQL } from '~/lib/four-eyes-status'
import type { Route } from './+types/query-plan-dev-team-stats'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Query-plan: getDevTeamSummaryStats - Admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const devTeams = await getAllDevTeams()
  return { devTeams }
}

type ActionData = ReturnType<typeof fail> | { planJson: string; measuredDurationMs: number; devTeamIds: number[] }

function buildDiagnosticQuery(
  naisTeamSlugs: string[],
  directAppIds: number[] | undefined,
  startDate: Date,
  deployerUsernames: string[] | undefined,
  devTeamIds: number[],
): { sql: string; params: unknown[] } {
  const params: unknown[] = [naisTeamSlugs, directAppIds ?? [], startDate]
  params.push(devTeamIds)
  const devTeamIdParam = params.length
  params.push(lowerUsernames(deployerUsernames ?? []))
  const deployerParam = params.length

  const sql = `WITH team_apps AS (
         SELECT ma.id, ${effectiveAuditStartYearSql('ma')} AS audit_start_year
         FROM monitored_applications ma
         WHERE ma.is_active = true
           AND (ma.team_slug = ANY($1::text[]) OR ma.id = ANY($2::int[]))
       ),
       board_linked AS (
         SELECT DISTINCT d.id AS deployment_id
         FROM boards b
         JOIN board_objectives bo ON bo.board_id = b.id AND bo.is_active = true
         JOIN deployment_goal_links dgl ON dgl.is_active = true
           AND (dgl.objective_id = bo.id
                OR dgl.key_result_id IN (SELECT bkr.id FROM board_key_results bkr WHERE bkr.objective_id = bo.id AND bkr.is_active = true))
         JOIN deployments d ON d.id = dgl.deployment_id
           AND ($3::timestamptz IS NULL OR d.created_at >= $3)
         JOIN team_apps ta ON ta.id = d.monitored_app_id
         WHERE b.dev_team_id = ANY($${devTeamIdParam}::int[]) AND b.is_active = true
           AND (ta.audit_start_year IS NULL OR d.created_at >= make_date(ta.audit_start_year, 1, 1))
       ),
       unlinked_member AS (
         SELECT DISTINCT d.id AS deployment_id
         FROM team_apps ta
         JOIN deployments d ON d.monitored_app_id = ta.id
           AND ($3::timestamptz IS NULL OR d.created_at >= $3)
           AND (ta.audit_start_year IS NULL OR d.created_at >= make_date(ta.audit_start_year, 1, 1))
           AND (LOWER(d.deployer_username) = ANY($${deployerParam}::text[])
                OR d.pr_creator_username = ANY($${deployerParam}::text[]))
         WHERE NOT EXISTS (
           SELECT 1 FROM deployment_goal_links dgl
           JOIN board_objectives bo ON (dgl.objective_id = bo.id
             OR dgl.key_result_id IN (SELECT bkr.id FROM board_key_results bkr WHERE bkr.objective_id = bo.id AND bkr.is_active = true))
           JOIN boards b ON b.id = bo.board_id AND b.is_active = true
           WHERE dgl.deployment_id = d.id AND dgl.is_active = true AND bo.is_active = true
         )
       ),
       team_deployments AS (
         SELECT deployment_id FROM board_linked
         UNION
         SELECT deployment_id FROM unlinked_member
       ),
       app_stats AS (
         SELECT d.monitored_app_id,
                COUNT(DISTINCT d.id) AS total_deployments,
                COUNT(DISTINCT d.id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL})) AS with_four_eyes,
                COUNT(DISTINCT d.id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL})) AS pending_verification,
                COUNT(DISTINCT d.id) FILTER (WHERE EXISTS (
                  SELECT 1 FROM deployment_goal_links dgl
                  WHERE dgl.deployment_id = d.id AND dgl.is_active = true
                    AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
                )) AS linked_to_goal
         FROM team_deployments td
         JOIN deployments d ON d.id = td.deployment_id
         GROUP BY d.monitored_app_id
       ),
       app_alerts AS (
         SELECT ra.monitored_app_id, COUNT(*) AS alert_count
         FROM team_apps ta
         JOIN repository_alerts ra ON ra.monitored_app_id = ta.id AND ra.resolved_at IS NULL
         GROUP BY ra.monitored_app_id
       )
       SELECT
         (SELECT COUNT(*) FROM team_apps)::int AS total_apps,
         COALESCE(SUM(s.total_deployments), 0)::int AS total_deployments,
         COALESCE(SUM(s.with_four_eyes), 0)::int AS with_four_eyes,
         (COALESCE(SUM(s.total_deployments), 0) - COALESCE(SUM(s.with_four_eyes), 0) - COALESCE(SUM(s.pending_verification), 0))::int AS without_four_eyes,
         COALESCE(SUM(s.pending_verification), 0)::int AS pending_verification,
         COALESCE(SUM(s.linked_to_goal), 0)::int AS linked_to_goal,
         COUNT(*) FILTER (WHERE COALESCE(s.total_deployments, 0) - COALESCE(s.with_four_eyes, 0) - COALESCE(s.pending_verification, 0) > 0 OR COALESCE(s.pending_verification, 0) > 0 OR COALESCE(a.alert_count, 0) > 0 OR (COALESCE(s.total_deployments, 0) > 0 AND COALESCE(s.linked_to_goal, 0) < COALESCE(s.total_deployments, 0)))::int AS apps_with_issues
       FROM team_apps ta
       LEFT JOIN app_stats s ON s.monitored_app_id = ta.id
       LEFT JOIN app_alerts a ON a.monitored_app_id = ta.id`

  return { sql, params }
}

export async function action({ request }: Route.ActionArgs): Promise<ActionData> {
  await requireAdmin(request)
  const formData = await request.formData()
  const devTeamIds = formData.getAll('devTeamId').map((v) => Number(v))

  if (devTeamIds.length === 0) {
    return fail('Velg minst ett team')
  }

  const devTeams = await getAllDevTeams()
  const selectedTeams = devTeams.filter((t) => devTeamIds.includes(t.id))
  const validatedDevTeamIds = selectedTeams.map((t) => t.id)

  if (validatedDevTeamIds.length === 0) {
    return fail('Fant ingen gyldige team blant de valgte')
  }

  const scope = await resolveDevTeamScope(selectedTeams)
  const ytdStart = new Date(new Date().getFullYear(), 0, 1)

  const { sql, params } = buildDiagnosticQuery(
    scope.naisTeamSlugs,
    scope.directAppIds,
    ytdStart,
    scope.deployerUsernames,
    validatedDevTeamIds,
  )

  const startedAt = Date.now()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL statement_timeout = '15s'")
    const explainResult = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params)
    const measuredDurationMs = Date.now() - startedAt
    const planJson = JSON.stringify(explainResult.rows[0]['QUERY PLAN'], null, 2)
    return { planJson, measuredDurationMs, devTeamIds: validatedDevTeamIds }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
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
          EXPLAIN". Spørringsteksten er en frittstående kopi (ikke delt med prod-koden) for å unngå enhver endring av
          den ekte /my-teams-spørringen.
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

      <ActionAlert data={actionData} />

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
