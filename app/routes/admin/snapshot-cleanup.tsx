import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, Table, TextField, VStack } from '@navikt/ds-react'
import { Form, Link, useActionData, useLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { pool } from '~/db/connection.server'
import { cleanupOldSnapshots } from '~/db/github-data.server'
import { fail, ok } from '~/lib/action-result'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/snapshot-cleanup'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'GitHub-snapshot opprydning - Admin' }]
}

const SNAPSHOT_TABLE_NAMES = [
  'github_pr_snapshots',
  'github_commit_snapshots',
  'github_compare_snapshots',
  'github_pr_raw_snapshots',
  'github_compare_raw_snapshots',
  'github_checks_raw_snapshots',
  'github_workflow_runs_raw_snapshots',
  'github_commit_raw_snapshots',
  'github_commit_on_branch_raw_snapshots',
  'github_commit_associated_prs_raw_snapshots',
  'github_pr_window_raw_snapshots',
  'github_check_annotations_raw_snapshots',
]

const DEFAULT_KEEP_COUNT = 5
const DEFAULT_OLDER_THAN_DAYS = 90

interface SnapshotTableSize {
  tableName: string
  totalBytes: number
  rowEstimate: number
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const sizesResult = await pool.query<{ table_name: string; total_bytes: string; row_estimate: string }>(
    `SELECT
       c.relname AS table_name,
       pg_total_relation_size(c.oid)::text AS total_bytes,
       GREATEST(c.reltuples, 0)::bigint::text AS row_estimate
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])
     ORDER BY pg_total_relation_size(c.oid) DESC`,
    [SNAPSHOT_TABLE_NAMES],
  )

  const tableSizes: SnapshotTableSize[] = sizesResult.rows.map((row) => ({
    tableName: row.table_name,
    totalBytes: parseInt(row.total_bytes, 10),
    rowEstimate: parseInt(row.row_estimate, 10),
  }))

  return { tableSizes }
}

const INTEGER_PATTERN = /^\d+$/

function parseStrictInteger(rawValue: FormDataEntryValue | null, defaultValue: number): number | null {
  if (rawValue === null) return defaultValue
  const trimmed = String(rawValue).trim()
  if (!INTEGER_PATTERN.test(trimmed)) return null
  const parsed = parseInt(trimmed, 10)
  if (!Number.isSafeInteger(parsed)) return null
  return parsed
}

const MAX_OLDER_THAN_DAYS = 3650

function parseAndValidateOptions(formData: FormData): { keepCount: number; olderThanDays: number } | null {
  const keepCount = parseStrictInteger(formData.get('keepCount'), DEFAULT_KEEP_COUNT)
  const olderThanDays = parseStrictInteger(formData.get('olderThanDays'), DEFAULT_OLDER_THAN_DAYS)

  if (
    keepCount === null ||
    keepCount < 1 ||
    olderThanDays === null ||
    olderThanDays < 0 ||
    olderThanDays > MAX_OLDER_THAN_DAYS
  ) {
    return null
  }
  return { keepCount, olderThanDays }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const options = parseAndValidateOptions(formData)

  if (!options) {
    return { ...fail('Ugyldige verdier for antall å beholde eller antall dager.'), result: null }
  }

  const result = await cleanupOldSnapshots(options)
  const totalDeleted = Object.values(result.counts).reduce((sum, n) => sum + n, 0)
  return {
    ...ok(`Slettet ${totalDeleted.toLocaleString('nb-NO')} rader totalt.`),
    result: result.counts,
    totalDeleted,
    truncated: result.truncated,
    ...options,
  }
}

const RESULT_KEY_LABELS: Record<string, string> = {
  prRawSnapshotsDeleted: 'github_pr_raw_snapshots',
  compareRawSnapshotsDeleted: 'github_compare_raw_snapshots',
  checksRawSnapshotsDeleted: 'github_checks_raw_snapshots',
  workflowRunsRawSnapshotsDeleted: 'github_workflow_runs_raw_snapshots',
  commitRawSnapshotsDeleted: 'github_commit_raw_snapshots',
  commitOnBranchRawSnapshotsDeleted: 'github_commit_on_branch_raw_snapshots',
  commitAssociatedPrsRawSnapshotsDeleted: 'github_commit_associated_prs_raw_snapshots',
  prWindowRawSnapshotsDeleted: 'github_pr_window_raw_snapshots',
  checkAnnotationsRawSnapshotsDeleted: 'github_check_annotations_raw_snapshots',
}

export default function SnapshotCleanupAdminPage() {
  const { tableSizes } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  return (
    <VStack gap="space-24">
      <HStack align="center" justify="space-between">
        <div>
          <Heading size="large" level="1">
            GitHub-snapshot opprydning
          </Heading>
          <BodyShort textColor="subtle">
            Rydder opp i historiske GitHub-snapshots (PR-data, compare, checks, commit-on-branch m.m.) som brukes til å
            re-utlede firøyeverifisering uten å måtte hente på nytt fra GitHub.
          </BodyShort>
        </div>
        <Button as={Link} to="/admin" variant="tertiary" size="small">
          ← Tilbake
        </Button>
      </HStack>

      <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <BodyShort>
            Beholder alltid det nyeste snapshotet per unik nøkkel (repo/PR/commit/branch), uansett alder. Kun{' '}
            <strong>eldre rader for samme nøkkel</strong> blant rader eldre enn valgt antall dager, blir slettet.
            Innholdet (<code>data</code>) sammenlignes ikke — en eldre rad kan avvike fra den nyeste selv om nøkkelen er
            lik. Verifiseringskoden for de fleste snapshot-typene henter alltid nyeste rad per nøkkel, så data den kan
            trenge for å revalidere en leveranse rører vi ikke. Noen få typer (blant annet <code>commit_on_branch</code>
            -rådata) er derimot et revisjonsspor av historiske GitHub-svar, ikke en gjenbrukbar cache — vurder terskelen
            for antall dager med det i mente.
          </BodyShort>
          <BodyShort textColor="subtle">
            Sletting skjer i batcher på 5 000 rader om gangen, med en øvre grense på 50 000 rader per tabell og et
            tidsbudsjett på 20 sekunder per kjøring, for å unngå lange låser på tabellene og for at siden ikke skal time
            ut. Trykk kjør flere ganger om det er mer å rydde opp i.
          </BodyShort>
          <BodyShort textColor="subtle">
            <code>github_pr_snapshots</code>, <code>github_commit_snapshots</code> og{' '}
            <code>github_compare_snapshots</code> ryddes foreløpig ikke: de identifiserer repo kun med det foranderlige{' '}
            <code>owner/repo</code>-navnet, ikke GitHubs immutable repo-id, så rader fra et slettet og gjenopprettet
            repo med samme navn kan i teorien blandes sammen. De øvrige tabellene bruker allerede
            <code>github_repo_id</code> og er trygge å rydde i.
          </BodyShort>

          <Form method="post">
            <HStack gap="space-16" align="end" wrap>
              <TextField
                label="Antall å beholde per nøkkel"
                name="keepCount"
                type="number"
                min={1}
                size="small"
                defaultValue={DEFAULT_KEEP_COUNT}
                style={{ width: '12rem' }}
              />
              <TextField
                label="Slett rader eldre enn (dager)"
                name="olderThanDays"
                type="number"
                min={0}
                size="small"
                defaultValue={DEFAULT_OLDER_THAN_DAYS}
                style={{ width: '12rem' }}
              />
              <Button type="submit" variant="danger" size="small">
                Kjør opprydning
              </Button>
            </HStack>
          </Form>

          <ActionAlert data={actionData} />

          {actionData?.result && (
            <Alert variant="info" size="small">
              <VStack gap="space-8">
                <BodyShort>
                  Beholdt {actionData.keepCount} nyeste per nøkkel, rader eldre enn {actionData.olderThanDays} dager
                  vurdert.
                </BodyShort>
                {actionData.truncated && (
                  <BodyShort>
                    Kjøringen ble avbrutt før alt var ferdig — enten en øvre grense per tabell, tidsbudsjettet, eller et
                    tilkoblingsproblem mot databasen. Trykk kjør på nytt for å fortsette oppryddingen.
                  </BodyShort>
                )}
                <VStack gap="space-4">
                  {Object.entries(actionData.result)
                    .filter(([, count]) => (count as number) > 0)
                    .map(([key, count]) => (
                      <Detail key={key}>
                        <code>{RESULT_KEY_LABELS[key] ?? key}</code>: {(count as number).toLocaleString('nb-NO')} rader
                      </Detail>
                    ))}
                </VStack>
              </VStack>
            </Alert>
          )}
        </VStack>
      </Box>

      <div>
        <Heading level="2" size="small" spacing>
          Nåværende størrelse på snapshot-tabeller
        </Heading>
        <Table size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Tabell</Table.HeaderCell>
              <Table.HeaderCell align="right">Total størrelse</Table.HeaderCell>
              <Table.HeaderCell align="right">Rader (estimat)</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {tableSizes.map((t) => (
              <Table.Row key={t.tableName}>
                <Table.DataCell>
                  <code>{t.tableName}</code>
                </Table.DataCell>
                <Table.DataCell align="right">
                  <strong>{formatBytes(t.totalBytes)}</strong>
                </Table.DataCell>
                <Table.DataCell align="right">{t.rowEstimate.toLocaleString('nb-NO')}</Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </VStack>
  )
}
