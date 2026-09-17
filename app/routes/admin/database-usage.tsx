import { BodyShort, Box, Button, Detail, Heading, HStack, Table, VStack } from '@navikt/ds-react'
import type { ChartData, ChartOptions } from 'chart.js'
import { CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js'
import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import { Link, useLoaderData } from 'react-router'
import { pool } from '~/db/connection.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/database-usage'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend)

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Databasebruk - Admin' }]
}

interface TableSizeRow {
  table_name: string
  total_bytes: string
  table_bytes: string
  index_bytes: string
  toast_bytes: string
  row_estimate: string
}

interface GrowthTableInfo {
  tableName: string
  timeColumn: string
  totalBytes: number
  rowEstimate: number
}

interface GrowthRow {
  tableName: string
  rowsLast24h: number
  avgRowsPerDay7d: number
  avgRowBytes: number
  estimatedDailyGrowthBytes: number
  oldestRow: string | null
  newestRow: string | null
  dailyCounts: Array<{ day: string; count: number }>
}

// Growth analysis is limited to tables above this size: below this threshold a table can't be a
// meaningful contributor to a ~20 GB/day growth problem, and skipping them keeps the number of
// per-table queries bounded.
const GROWTH_ANALYSIS_MIN_BYTES = 5 * 1024 * 1024
const GROWTH_ANALYSIS_MAX_TABLES = 12
const GROWTH_WINDOW_DAYS = 35

// Preferred timestamp column to use for growth-over-time analysis, in priority order.
const TIME_COLUMN_CANDIDATES = ['fetched_at', 'created_at', 'observed_at', 'run_at']

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const dbSizeResult = await pool.query<{ total_bytes: string }>(
    `SELECT pg_database_size(current_database())::text AS total_bytes`,
  )
  const databaseTotalBytes = parseInt(dbSizeResult.rows[0].total_bytes, 10)

  const tableSizesResult = await pool.query<TableSizeRow>(
    `SELECT
       c.relname AS table_name,
       pg_total_relation_size(c.oid)::text AS total_bytes,
       pg_relation_size(c.oid)::text AS table_bytes,
       pg_indexes_size(c.oid)::text AS index_bytes,
       COALESCE(pg_total_relation_size(c.reltoastrelid), 0)::text AS toast_bytes,
       GREATEST(c.reltuples, 0)::bigint::text AS row_estimate
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY pg_total_relation_size(c.oid) DESC`,
  )

  const tableSizes = tableSizesResult.rows.map((row) => ({
    tableName: row.table_name,
    totalBytes: parseInt(row.total_bytes, 10),
    tableBytes: parseInt(row.table_bytes, 10),
    indexBytes: parseInt(row.index_bytes, 10),
    toastBytes: parseInt(row.toast_bytes, 10),
    rowEstimate: parseInt(row.row_estimate, 10),
  }))

  const timeColumnsResult = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name = ANY($1::text[])
       AND data_type IN ('timestamp with time zone', 'timestamp without time zone')`,
    [TIME_COLUMN_CANDIDATES],
  )
  const timeColumnsByTable = new Map<string, string[]>()
  for (const row of timeColumnsResult.rows) {
    const existing = timeColumnsByTable.get(row.table_name) ?? []
    existing.push(row.column_name)
    timeColumnsByTable.set(row.table_name, existing)
  }

  const growthCandidates: GrowthTableInfo[] = tableSizes
    .filter((t) => t.totalBytes >= GROWTH_ANALYSIS_MIN_BYTES)
    .map((t) => {
      const columns = timeColumnsByTable.get(t.tableName)
      const timeColumn = columns && TIME_COLUMN_CANDIDATES.find((c) => columns.includes(c))
      if (!timeColumn) return null
      return { tableName: t.tableName, timeColumn, totalBytes: t.totalBytes, rowEstimate: t.rowEstimate }
    })
    .filter((t): t is GrowthTableInfo => t !== null)
    .slice(0, GROWTH_ANALYSIS_MAX_TABLES)

  const growthRows: GrowthRow[] = []
  for (const candidate of growthCandidates) {
    // Table/column names here come from pg_catalog/information_schema (trusted DB metadata), not
    // user input, so interpolating them directly into the SQL is safe.
    const { tableName, timeColumn } = candidate
    const dailyResult = await pool.query<{ day: string; cnt: string }>(
      `SELECT date_trunc('day', "${timeColumn}")::text AS day, count(*)::text AS cnt
       FROM "${tableName}"
       WHERE "${timeColumn}" > now() - interval '${GROWTH_WINDOW_DAYS} days'
       GROUP BY 1
       ORDER BY 1`,
    )
    const dailyCounts = dailyResult.rows.map((r) => ({ day: r.day, count: parseInt(r.cnt, 10) }))

    const rangeResult = await pool.query<{ oldest: string | null; newest: string | null }>(
      `SELECT MIN("${timeColumn}")::text AS oldest, MAX("${timeColumn}")::text AS newest FROM "${tableName}"`,
    )
    const oldestRow = rangeResult.rows[0]?.oldest ?? null
    const newestRow = rangeResult.rows[0]?.newest ?? null

    const last24hCount = dailyCounts.length > 0 ? (dailyCounts[dailyCounts.length - 1]?.count ?? 0) : 0
    const last7Days = dailyCounts.slice(-7)
    const avgRowsPerDay7d = last7Days.length > 0 ? last7Days.reduce((sum, d) => sum + d.count, 0) / last7Days.length : 0

    const avgRowBytes = candidate.rowEstimate > 0 ? candidate.totalBytes / candidate.rowEstimate : 0
    const estimatedDailyGrowthBytes = avgRowBytes * avgRowsPerDay7d

    growthRows.push({
      tableName,
      rowsLast24h: last24hCount,
      avgRowsPerDay7d,
      avgRowBytes,
      estimatedDailyGrowthBytes,
      oldestRow,
      newestRow,
      dailyCounts,
    })
  }

  growthRows.sort((a, b) => b.estimatedDailyGrowthBytes - a.estimatedDailyGrowthBytes)

  return { databaseTotalBytes, tableSizes, growthRows }
}

const GROWTH_CHART_COLORS = [
  'rgba(51, 170, 95, 1)',
  'rgba(255, 99, 71, 1)',
  'rgba(51, 130, 220, 1)',
  'rgba(255, 181, 46, 1)',
  'rgba(150, 90, 200, 1)',
  'rgba(90, 90, 90, 1)',
]

function GrowthChart({ growthRows }: { growthRows: GrowthRow[] }) {
  const topRows = growthRows.slice(0, 6)

  const allDays = useMemo(() => {
    const days = new Set<string>()
    for (const row of topRows) {
      for (const d of row.dailyCounts) days.add(d.day)
    }
    return [...days].sort()
  }, [topRows])

  const chartData = useMemo((): ChartData<'line'> => {
    return {
      labels: allDays.map((d) => new Date(d).toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit' })),
      datasets: topRows.map((row, index) => {
        const byDay = new Map(row.dailyCounts.map((d) => [d.day, d.count]))
        return {
          label: row.tableName,
          data: allDays.map((d) => byDay.get(d) ?? 0),
          borderColor: GROWTH_CHART_COLORS[index % GROWTH_CHART_COLORS.length],
          backgroundColor: GROWTH_CHART_COLORS[index % GROWTH_CHART_COLORS.length],
          tension: 0.1,
        }
      }),
    }
  }, [allDays, topRows])

  const options = useMemo(
    (): ChartOptions<'line'> => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top' as const },
        tooltip: { mode: 'index' as const, intersect: false },
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Rader per dag' } },
      },
    }),
    [],
  )

  if (topRows.length === 0) return null

  return (
    <div style={{ height: '320px', position: 'relative' }} role="img" aria-label="Rader lagret per dag per tabell">
      <Line options={options} data={chartData} />
    </div>
  )
}

export default function DatabaseUsageAdminPage() {
  const { databaseTotalBytes, tableSizes, growthRows } = useLoaderData<typeof loader>()

  return (
    <VStack gap="space-24">
      <HStack align="center" justify="space-between">
        <div>
          <Heading size="large" level="1">
            Databasebruk
          </Heading>
          <BodyShort textColor="subtle">
            Oversikt over hvor diskplass i databasen brukes, for å finne kilden til uventet vekst i diskbruk.
          </BodyShort>
        </div>
        <Button as={Link} to="/admin" variant="tertiary" size="small">
          ← Tilbake
        </Button>
      </HStack>

      <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <Detail textColor="subtle">Total databasestørrelse</Detail>
        <Heading level="2" size="medium">
          {formatBytes(databaseTotalBytes)}
        </Heading>
      </Box>

      <div>
        <Heading level="2" size="small" spacing>
          Estimert daglig vekst per tabell
        </Heading>
        <BodyShort textColor="subtle" spacing>
          Basert på antall rader lagret per dag siste 7 dager, ganget med estimert gjennomsnittlig radstørrelse (total
          tabellstørrelse delt på antall rader). Kun tabeller over {formatBytes(GROWTH_ANALYSIS_MIN_BYTES)} med et
          tidsstempel-felt (<code>fetched_at</code>/<code>created_at</code>/<code>observed_at</code>/<code>run_at</code>
          ) er inkludert.
        </BodyShort>

        {growthRows.length === 0 ? (
          <BodyShort textColor="subtle">
            Ingen tabeller over størrelsesterskelen har et gjenkjennbart tidsstempel-felt.
          </BodyShort>
        ) : (
          <VStack gap="space-24">
            <GrowthChart growthRows={growthRows} />
            <Table size="small">
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Tabell</Table.HeaderCell>
                  <Table.HeaderCell align="right">Rader siste 24t</Table.HeaderCell>
                  <Table.HeaderCell align="right">Snitt rader/dag (7d)</Table.HeaderCell>
                  <Table.HeaderCell align="right">Estimert byte/rad</Table.HeaderCell>
                  <Table.HeaderCell align="right">Estimert vekst/dag</Table.HeaderCell>
                  <Table.HeaderCell>Eldste rad</Table.HeaderCell>
                  <Table.HeaderCell>Nyeste rad</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {growthRows.map((row) => (
                  <Table.Row key={row.tableName}>
                    <Table.DataCell>
                      <code>{row.tableName}</code>
                    </Table.DataCell>
                    <Table.DataCell align="right">{row.rowsLast24h.toLocaleString('nb-NO')}</Table.DataCell>
                    <Table.DataCell align="right">
                      {row.avgRowsPerDay7d.toLocaleString('nb-NO', { maximumFractionDigits: 0 })}
                    </Table.DataCell>
                    <Table.DataCell align="right">{formatBytes(row.avgRowBytes)}</Table.DataCell>
                    <Table.DataCell align="right">
                      <strong>{formatBytes(row.estimatedDailyGrowthBytes)}</strong>
                    </Table.DataCell>
                    <Table.DataCell>
                      <Detail>{row.oldestRow ? new Date(row.oldestRow).toLocaleString('nb-NO') : '–'}</Detail>
                    </Table.DataCell>
                    <Table.DataCell>
                      <Detail>{row.newestRow ? new Date(row.newestRow).toLocaleString('nb-NO') : '–'}</Detail>
                    </Table.DataCell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </VStack>
        )}
      </div>

      <div>
        <Heading level="2" size="small" spacing>
          Alle tabeller etter total størrelse
        </Heading>
        <Table size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Tabell</Table.HeaderCell>
              <Table.HeaderCell align="right">Total størrelse</Table.HeaderCell>
              <Table.HeaderCell align="right">Data</Table.HeaderCell>
              <Table.HeaderCell align="right">Indekser</Table.HeaderCell>
              <Table.HeaderCell align="right">TOAST</Table.HeaderCell>
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
                <Table.DataCell align="right">{formatBytes(t.tableBytes)}</Table.DataCell>
                <Table.DataCell align="right">{formatBytes(t.indexBytes)}</Table.DataCell>
                <Table.DataCell align="right">{formatBytes(t.toastBytes)}</Table.DataCell>
                <Table.DataCell align="right">{t.rowEstimate.toLocaleString('nb-NO')}</Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </VStack>
  )
}
