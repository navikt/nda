import { ArrowsCirclepathIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, VStack } from '@navikt/ds-react'
import { Form, Link, useActionData, useLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { ok } from '~/lib/action-result'
import { requireAdmin } from '~/lib/auth.server'
import { backfillDeploymentGithubRepoIds, countDeploymentsPendingGithubRepoIdBackfill } from '~/lib/github'
import type { Route } from './+types/backfill-github-repo-id'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Backfill github_repo_id - Admin' }]
}

const MAX_ROWS_PER_RUN = 200
const TIME_BUDGET_MS = 20_000

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const pendingCount = await countDeploymentsPendingGithubRepoIdBackfill()

  return { pendingCount }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const result = await backfillDeploymentGithubRepoIds({ maxRows: MAX_ROWS_PER_RUN, timeBudgetMs: TIME_BUDGET_MS })

  if (result.alreadyRunning) {
    return { ...ok('Backfillen kjører allerede (f.eks. i en annen fane) — prøv igjen om litt.'), result }
  }

  if (result.processed === 0) {
    return { ...ok('Ingen leveranser å behandle.'), result }
  }

  return {
    ...ok(
      `Behandlet ${result.processed} leveranser: ${result.resolved} fikk github_repo_id, ${result.unresolved} forble NULL, ${result.transientFailures} feilet midlertidig (prøves igjen ved neste kjøring).`,
    ),
    result,
  }
}

export default function BackfillGithubRepoIdAdminPage() {
  const { pendingCount } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  return (
    <VStack gap="space-24">
      <HStack align="center" justify="space-between">
        <div>
          <Heading size="large" level="1">
            Backfill github_repo_id
          </Heading>
          <BodyShort textColor="subtle">
            Fyller inn GitHubs immutable repo-id på eksisterende leveranser, via hver leverings GitHub Actions
            workflow-kjøring (trigger_url).
          </BodyShort>
        </div>
        <Button as={Link} to="/admin" variant="tertiary" size="small">
          ← Tilbake
        </Button>
      </HStack>

      <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <BodyShort>
            En workflow-kjørings-id er global og unik, og permanent knyttet til repoet den kjørte i, så oppslaget enten
            løser til riktig repo (også etter et navnebytte, via GitHubs redirect) eller feiler med 404 (f.eks. hvis
            navnet siden er gjenbrukt av et annet repo) — det kan aldri stille løse til feil repo. Leveranser uten{' '}
            <code>trigger_url</code> (f.eks. manuell <code>nais deploy</code>), eller der workflow-kjøringen ikke lenger
            finnes, beholder <code>github_repo_id</code> som NULL — dette er trygt og forventet, ikke en feil.
          </BodyShort>
          <BodyShort textColor="subtle">
            Behandler opptil {MAX_ROWS_PER_RUN} leveranser per kjøring, med et tidsbudsjett på {TIME_BUDGET_MS / 1000}{' '}
            sekunder, for å unngå at siden time'er ut. Trykk kjør flere ganger om det er mer å behandle.
          </BodyShort>
          <BodyShort>
            <strong>{pendingCount.toLocaleString('nb-NO')}</strong> leveranser gjenstår å behandle.
          </BodyShort>

          <Form method="post">
            <Button type="submit" variant="primary" size="small" icon={<ArrowsCirclepathIcon aria-hidden />}>
              Kjør backfill
            </Button>
          </Form>

          <ActionAlert data={actionData} />

          {actionData?.result && (
            <Alert variant="info" size="small">
              <VStack gap="space-8">
                {actionData.result.truncated && (
                  <BodyShort>
                    Kjøringen ble avbrutt før alt var ferdig — enten den øvre grensen per kjøring, tidsbudsjettet, eller
                    et tilkoblingsproblem mot GitHub/databasen. Trykk kjør på nytt for å fortsette.
                  </BodyShort>
                )}
                <Detail>Fikk github_repo_id: {actionData.result.resolved.toLocaleString('nb-NO')}</Detail>
                <Detail>
                  Forble NULL (ingen resolverbar workflow-kjøring):{' '}
                  {actionData.result.unresolved.toLocaleString('nb-NO')}
                </Detail>
                <Detail>
                  Midlertidig feilet (nettverk/rate-limit) — prøves igjen senere:{' '}
                  {actionData.result.transientFailures.toLocaleString('nb-NO')}
                </Detail>
                <Detail>Gjenstår totalt: {actionData.result.remaining.toLocaleString('nb-NO')}</Detail>
              </VStack>
            </Alert>
          )}
        </VStack>
      </Box>
    </VStack>
  )
}
