import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, Table, TextField, VStack } from '@navikt/ds-react'
import { Form, Link, useLoaderData } from 'react-router'
import { pool } from '~/db/connection.server'
import { cleanupOldSnapshots } from '~/db/github-data.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/snapshot-cleanup'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'GitHub-snapshot opprydning - Admin' }]
}

const SNAPSHOT_TABLE_NAMES = [
  'github_pr_snapshots',
  'github_commit_snapshots',
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

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const keepCount = parseInt(String(formData.get('keepCount') ?? DEFAULT_KEEP_COUNT), 10)
  const olderThanDays = parseInt(String(formData.get('olderThanDays') ?? DEFAULT_OLDER_THAN_DAYS), 10)

  if (!Number.isFinite(keepCount) || keepCount < 1 || !Number.isFinite(olderThanDays) || olderThanDays < 0) {
    return { error: 'Ugyldige verdier for antall å beholde eller antall dager.', result: null, totalDeleted: 0 }
  }

  const result = await cleanupOldSnapshots({ keepCount, olderThanDays })
  const totalDeleted = Object.values(result).reduce((sum, n) => sum + n, 0)

  return { error: null, result, totalDeleted, keepCount, olderThanDays }
}

const RESULT_KEY_LABELS: Record<string, string> = {
  prSnapshotsDeleted: 'github_pr_snapshots',
  commitSnapshotsDeleted: 'github_commit_snapshots',
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

export default function SnapshotCleanupAdminPage({ actionData }: Route.ComponentProps) {
  const { tableSizes } = useLoaderData<typeof loader>()

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
            Beholder de <code>N</code> nyeste snapshotene per unik nøkkel (repo/PR/commit/branch) blant rader eldre enn
            valgt antall dager, og sletter resten permanent. Nyere rader enn terskelen røres aldri. Bruk lavere verdier
            for å rydde opp i et akutt vekstproblem, og la feltene stå på standardverdiene for normal
            vedlikeholdsopprydding.
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

          {actionData?.error && (
            <Alert variant="error" size="small">
              {actionData.error}
            </Alert>
          )}

          {actionData?.result && (
            <Alert variant={actionData.totalDeleted > 0 ? 'success' : 'info'} size="small">
              <VStack gap="space-8">
                <BodyShort>
                  Slettet {actionData.totalDeleted.toLocaleString('nb-NO')} rader totalt (beholdt {actionData.keepCount}{' '}
                  nyeste per nøkkel, rader eldre enn {actionData.olderThanDays} dager vurdert).
                </BodyShort>
                <VStack gap="space-4">
                  {Object.entries(actionData.result)
                    .filter(([, count]) => count > 0)
                    .map(([key, count]) => (
                      <Detail key={key}>
                        <code>{RESULT_KEY_LABELS[key] ?? key}</code>: {count.toLocaleString('nb-NO')} rader
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
