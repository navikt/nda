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
import { Form, Link, redirect, useActionData, useLoaderData, useNavigate } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { PaginationControls } from '~/components/deployments/PaginationControls'
import { ExternalLink } from '~/components/ExternalLink'
import { pool } from '~/db/connection.server'
import { requireAdmin } from '~/lib/auth.server'
import { LEGACY_STATUSES_SQL } from '~/lib/four-eyes-status'
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

interface MissingTitleRow {
  id: number
  app_name: string
  team_slug: string
  environment_name: string
  deployed_at: Date
  four_eyes_status: string
  has_pr_data: boolean
  has_commits: boolean
}

interface BaselineNoApprover {
  id: number
  app_name: string
  team_slug: string
  environment_name: string
  deployed_at: Date
}

interface CommentMissingRegisteredBy {
  comment_id: number
  deployment_id: number
  app_name: string
  team_slug: string
  environment_name: string
  comment_type: string
  created_at: Date
}

interface MappingWithoutUser {
  github_username: string
  display_github_username: string | null
  nav_ident: string
  display_name_in_mapping: string | null
}

const MISSING_PAGE_SIZE = 50

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const url = new URL(request.url)
  const rawPage = parseInt(url.searchParams.get('missingPage') ?? '1', 10)
  const missingPage = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1

  const [
    mismatchResult,
    missingResult,
    baselineNoApproverResult,
    commentsMissingRegisteredByResult,
    mappingsWithoutUserResult,
  ] = await Promise.all([
    pool.query<TitleMismatch>(
      `SELECT
         d.id,
         ma.app_name,
         ma.team_slug,
         ma.environment_name,
         d.title AS stored_title,
         LEFT(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), 500) AS pr_title,
         d.four_eyes_status,
         d.github_pr_number,
         d.detected_github_owner,
         d.detected_github_repo_name
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE COALESCE(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), '') != ''
         AND d.title IS NOT NULL
         AND d.title != LEFT(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), 500)
       ORDER BY d.id DESC`,
    ),
    pool.query<MissingSummary>(
      `SELECT
         (COUNT(*) FILTER (WHERE d.title IS NULL))::int AS total_missing,
         (COUNT(*) FILTER (
           WHERE d.title IS NULL
             AND COALESCE(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), '') != ''
         ))::int AS with_pr_data,
         (COUNT(*) FILTER (
           WHERE d.title IS NULL
             AND COALESCE(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), '') = ''
             AND d.unverified_commits IS NOT NULL
             AND jsonb_array_length(d.unverified_commits) > 0
             AND COALESCE(BTRIM(SPLIT_PART(d.unverified_commits->0->>'message', E'\n', 1), E' \t\r\n'), '') != ''
         ))::int AS with_unverified_commits,
         (COUNT(*) FILTER (
           WHERE d.title IS NULL
             AND COALESCE(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), '') = ''
             AND (d.unverified_commits IS NULL
                  OR jsonb_array_length(d.unverified_commits) = 0
                  OR COALESCE(BTRIM(SPLIT_PART(d.unverified_commits->0->>'message', E'\n', 1), E' \t\r\n'), '') = '')
         ))::int AS no_fallback
         FROM deployments d
         JOIN monitored_applications ma ON d.monitored_app_id = ma.id
         WHERE ma.audit_start_year IS NOT NULL
           AND d.created_at >= make_date(ma.audit_start_year, 1, 1)
           AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${LEGACY_STATUSES_SQL})`,
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
    pool.query<CommentMissingRegisteredBy>(
      `SELECT
         dc.id AS comment_id,
         dc.deployment_id,
         ma.app_name,
         ma.team_slug,
         ma.environment_name,
         dc.comment_type,
         dc.created_at
       FROM deployment_comments dc
       JOIN deployments d ON dc.deployment_id = d.id
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE dc.registered_by IS NULL
         AND dc.deleted_at IS NULL
       ORDER BY dc.created_at DESC`,
    ),
    pool.query<MappingWithoutUser>(
      `SELECT um.github_username,
               um.display_github_username,
               um.nav_ident,
               um.display_name AS display_name_in_mapping
        FROM user_mappings um
        LEFT JOIN users u ON u.nav_ident = um.nav_ident AND u.deleted_at IS NULL
        WHERE um.deleted_at IS NULL
          AND um.nav_ident IS NOT NULL
          AND u.nav_ident IS NULL
        ORDER BY um.github_username`,
    ),
  ])

  const missing = missingResult.rows[0] ?? {
    total_missing: 0,
    with_pr_data: 0,
    with_unverified_commits: 0,
    no_fallback: 0,
  }
  const missingTotalPages = Math.max(1, Math.ceil(Number(missing.total_missing) / MISSING_PAGE_SIZE))

  // Redirect to last valid page if requested page is out of range
  const clampedPage = Math.min(missingPage, missingTotalPages)
  if (clampedPage !== missingPage) {
    url.searchParams.set('missingPage', String(clampedPage))
    throw redirect(url.pathname + url.search)
  }

  const missingRowsResult = await pool.query<MissingTitleRow>(
    `SELECT
       d.id,
       ma.app_name,
       ma.team_slug,
       ma.environment_name,
       d.created_at AS deployed_at,
       d.four_eyes_status,
       (COALESCE(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), '') != '') AS has_pr_data,
       (d.unverified_commits IS NOT NULL
         AND jsonb_array_length(d.unverified_commits) > 0
         AND COALESCE(BTRIM(SPLIT_PART(d.unverified_commits->0->>'message', E'\n', 1), E' \t\r\n'), '') != '') AS has_commits
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.title IS NULL
       AND ma.audit_start_year IS NOT NULL
       AND d.created_at >= make_date(ma.audit_start_year, 1, 1)
       AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${LEGACY_STATUSES_SQL})
     ORDER BY d.id DESC
     LIMIT $1 OFFSET $2`,
    [MISSING_PAGE_SIZE, (clampedPage - 1) * MISSING_PAGE_SIZE],
  )

  return {
    mismatches: mismatchResult.rows,
    mismatchCount: mismatchResult.rowCount ?? 0,
    missing,
    missingRows: missingRowsResult.rows,
    missingPage: clampedPage,
    missingTotalPages,
    baselineNoApprover: baselineNoApproverResult.rows,
    commentsMissingRegisteredBy: commentsMissingRegisteredByResult.rows,
    mappingsWithoutUser: mappingsWithoutUserResult.rows,
  }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'fix_mismatches') {
    const result = await pool.query(
      `UPDATE deployments
       SET title = LEFT(BTRIM(github_pr_data->>'title', E' \t\r\n'), 500)
       WHERE COALESCE(BTRIM(github_pr_data->>'title', E' \t\r\n'), '') != ''
         AND title IS NOT NULL
         AND title != LEFT(BTRIM(github_pr_data->>'title', E' \t\r\n'), 500)`,
    )
    const count = result.rowCount ?? 0
    return { success: `Korrigerte ${count} feil titler.` }
  }

  if (intent === 'fix_missing') {
    const result = await pool.query(
      `UPDATE deployments d
       SET title = LEFT(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), 500)
       FROM monitored_applications ma
       WHERE d.monitored_app_id = ma.id
         AND d.title IS NULL
         AND COALESCE(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), '') != ''
         AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${LEGACY_STATUSES_SQL})
         AND ma.audit_start_year IS NOT NULL
         AND d.created_at >= make_date(ma.audit_start_year, 1, 1)`,
    )
    const count = result.rowCount ?? 0
    return { success: `Fylte inn ${count} manglende titler fra PR-data.` }
  }

  // ONE-TIME BACKFILL — safe to remove once all historical titles are populated
  if (intent === 'backfill_from_cache') {
    const result = await pool.query(
      // Pass 3: compare-cache backfill. Mirrors migration priority — only touches rows
      // that Pass 1 (PR title) and Pass 2 (unverified_commits) could not fill.
      // Pre-aggregates snapshots once (DISTINCT ON per head_sha) to avoid per-row lookups.
      // ONE-TIME BACKFILL: matches snapshots by head_sha only (not base_sha).
      // A snapshot may have been fetched for a different range (e.g. different env
      // or prior deployment). Acceptable for a best-effort historical backfill.
      `WITH latest_snapshots AS (
         SELECT DISTINCT ON (head_sha)
           head_sha,
           BTRIM(
             SPLIT_PART(data->'commits'->0->>'message', E'\n', 1),
             E' \t\r\n'
           ) AS derived_title
         FROM github_compare_snapshots
         WHERE head_sha IN (
           SELECT d.commit_sha FROM deployments d
           JOIN monitored_applications ma ON d.monitored_app_id = ma.id
           WHERE d.title IS NULL
            AND COALESCE(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), '') = ''
             AND (d.unverified_commits IS NULL OR jsonb_array_length(d.unverified_commits) = 0
                 OR COALESCE(BTRIM(SPLIT_PART(d.unverified_commits->0->>'message', E'\n', 1), E' \t\r\n'), '') = '')
             AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${LEGACY_STATUSES_SQL})
             AND ma.audit_start_year IS NOT NULL
             AND d.created_at >= make_date(ma.audit_start_year, 1, 1)
         )
           AND jsonb_typeof(data->'commits') = 'array'
           AND jsonb_array_length(data->'commits') > 0
          AND BTRIM(SPLIT_PART(data->'commits'->0->>'message', E'\n', 1), E' \t\r\n') != ''
        ORDER BY head_sha, fetched_at DESC
      )
      UPDATE deployments d
      SET title = LEFT(ls.derived_title, 500)
      FROM latest_snapshots ls, monitored_applications ma
      WHERE d.commit_sha = ls.head_sha
        AND d.monitored_app_id = ma.id
        AND d.title IS NULL
        AND COALESCE(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), '') = ''
        AND (d.unverified_commits IS NULL OR jsonb_array_length(d.unverified_commits) = 0
             OR COALESCE(BTRIM(SPLIT_PART(d.unverified_commits->0->>'message', E'\n', 1), E' \t\r\n'), '') = '')
        AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${LEGACY_STATUSES_SQL})
        AND ma.audit_start_year IS NOT NULL
        AND d.created_at >= make_date(ma.audit_start_year, 1, 1)`,
    )
    const count = result.rowCount ?? 0
    return {
      success:
        count > 0
          ? `Fylte inn ${count} titler fra compare-cache. Kjør igjen for å se om det gjenstår flere.`
          : 'Ingen titler å fylle inn fra compare-cache. Alle som kan fylles er allerede satt.',
    }
  }

  return { error: 'Ukjent handling' }
}

function truncate(str: string, maxLength: number) {
  if (str.length <= maxLength) return str
  return `${str.slice(0, maxLength)}…`
}

export default function DataMismatches() {
  const {
    mismatches,
    mismatchCount,
    missing,
    missingRows,
    missingPage,
    missingTotalPages,
    baselineNoApprover,
    commentsMissingRegisteredBy,
    mappingsWithoutUser,
  } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigate = useNavigate()

  const [mismatchFilter, setMismatchFilter] = useState('')
  const [mismatchSort, setMismatchSort] = useState<SortState>()

  const [baselineFilter, setBaselineFilter] = useState('')
  const [baselineSort, setBaselineSort] = useState<SortState>()

  const [commentsFilter, setCommentsFilter] = useState('')
  const [commentsSort, setCommentsSort] = useState<SortState>()

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

  const commentsWithTs = useMemo(
    () =>
      commentsMissingRegisteredBy.map((c) => {
        const d = new Date(c.created_at)
        return { ...c, createdTs: d.getTime(), createdStr: d.toLocaleDateString('nb-NO') }
      }),
    [commentsMissingRegisteredBy],
  )

  const filteredComments = useMemo(() => {
    const filtered = commentsWithTs.filter((c) => {
      if (!commentsFilter) return true
      const q = commentsFilter.toLowerCase()
      return [
        c.comment_id.toString(),
        c.deployment_id.toString(),
        c.app_name,
        c.team_slug,
        c.environment_name,
        c.comment_type,
      ].some((v) => v.toLowerCase().includes(q))
    })
    if (!commentsSort) return filtered
    const dir = commentsSort.direction === 'ascending' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (commentsSort.orderBy) {
        case 'comment_id':
          return (a.comment_id - b.comment_id) * dir
        case 'deployment_id':
          return (a.deployment_id - b.deployment_id) * dir
        case 'app_name':
          return a.app_name.localeCompare(b.app_name, 'nb') * dir
        case 'team_slug':
          return a.team_slug.localeCompare(b.team_slug, 'nb') * dir
        case 'environment_name':
          return a.environment_name.localeCompare(b.environment_name, 'nb') * dir
        case 'comment_type':
          return a.comment_type.localeCompare(b.comment_type, 'nb') * dir
        case 'created_at':
          return (a.createdTs - b.createdTs) * dir
        default:
          return 0
      }
    })
  }, [commentsWithTs, commentsFilter, commentsSort])

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
        <Box padding="space-16" borderRadius="8" borderWidth="1" borderColor="neutral-subtle">
          <VStack gap="space-4">
            <Heading size="medium">{missing.no_fallback}</Heading>
            <BodyShort size="small">Kandidater for compare-cache-oppfylling</BodyShort>
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
                <strong>Manglende tittel</strong> — deployments uten tittel og uten PR-data å hente fra.
              </BodyShort>
            </li>
            <li>
              <BodyShort size="small">
                <strong>Kandidater for compare-cache-oppfylling</strong> — deployments uten tittel og uten PR-data eller
                commit-meldinger å hente fra. Disse er kandidater for engangsjobben under, men faktisk antall som fylles
                kan være lavere siden ikke alle nødvendigvis finnes i compare-cachen.
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
        {/* ONE-TIME BACKFILL — remove this form once all historical titles are populated */}
        {missing.no_fallback > 0 && (
          <Form method="post">
            <input type="hidden" name="intent" value="backfill_from_cache" />
            <Button variant="secondary" size="small" icon={<WrenchIcon aria-hidden />}>
              [Engangsjobb] Fyll inn titler fra compare-cache ({missing.no_fallback} kandidater)
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
                    <Table.ColumnHeader sortKey="id" sortable>
                      ID
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="app_name" sortable>
                      App
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="stored_title" sortable>
                      Lagret tittel
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="pr_title" sortable>
                      PR-tittel (riktig)
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="four_eyes_status" sortable>
                      Status
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="github_pr_number" sortable>
                      PR
                    </Table.ColumnHeader>
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

      {/* Deployments without title — paginated list */}
      {missing.total_missing > 0 && (
        <VStack gap="space-12">
          <Heading level="2" size="medium">
            Deployments uten tittel ({missing.total_missing})
          </Heading>

          <div style={{ overflowX: 'auto' }}>
            <Table size="small">
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>ID</Table.HeaderCell>
                  <Table.HeaderCell>App</Table.HeaderCell>
                  <Table.HeaderCell>Team</Table.HeaderCell>
                  <Table.HeaderCell>Miljø</Table.HeaderCell>
                  <Table.HeaderCell>Deployet</Table.HeaderCell>
                  <Table.HeaderCell>Status</Table.HeaderCell>
                  <Table.HeaderCell>Data</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {missingRows.map((row) => {
                  const deployedStr = new Date(row.deployed_at).toLocaleDateString('nb-NO')
                  return (
                    <Table.Row key={row.id}>
                      <Table.DataCell>
                        <Link to={`/deployments/${row.id}`}>{row.id}</Link>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{row.app_name}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{row.team_slug}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{row.environment_name}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{deployedStr}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{row.four_eyes_status}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        {row.has_pr_data ? (
                          <Tag variant="moderate" data-color="warning" size="xsmall">
                            PR-data
                          </Tag>
                        ) : row.has_commits ? (
                          <Tag variant="moderate" data-color="info" size="xsmall">
                            Commits
                          </Tag>
                        ) : (
                          <Tag variant="moderate" data-color="neutral" size="xsmall">
                            Ingen data
                          </Tag>
                        )}
                      </Table.DataCell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </div>

          <PaginationControls
            page={missingPage}
            totalPages={missingTotalPages}
            onPageChange={(p) => navigate(`?missingPage=${p}`)}
          />
        </VStack>
      )}

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
                    <Table.ColumnHeader sortKey="id" sortable>
                      ID
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="app_name" sortable>
                      App
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="team_slug" sortable>
                      Team
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="environment_name" sortable>
                      Miljø
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="deployed_at" sortable>
                      Deployet
                    </Table.ColumnHeader>
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
                        <BodyShort size="small">{b.deployedStr}</BodyShort>
                      </Table.DataCell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          </>
        )}
      </VStack>

      {/* Comments missing registered_by section */}
      <VStack gap="space-12">
        <VStack gap="space-4">
          <Heading level="2" size="medium">
            Kommentarer uten registrert av
          </Heading>
          <BodyShort textColor="subtle">
            Kommentarer lagret før <code>registered_by</code> ble innført (PR #211) mangler forfatterinformasjon.
            Forfattervisningen på deployment-detaljsiden vil da ikke ha noe å vise for disse kommentarene.
          </BodyShort>
        </VStack>

        {commentsMissingRegisteredBy.length === 0 ? (
          <Alert variant="success">Ingen kommentarer mangler registrert av.</Alert>
        ) : (
          <>
            <Alert variant="warning">
              {commentsMissingRegisteredBy.length} kommentar
              {commentsMissingRegisteredBy.length === 1 ? '' : 'er'} mangler <code>registered_by</code>. Disse kan ikke
              repareres automatisk da forfatterinformasjonen ikke er tilgjengelig i ettertid.
            </Alert>

            <TextField
              label="Filtrer kommentarer"
              hideLabel
              placeholder="Filtrer på ID, app, team, miljø eller type…"
              size="small"
              value={commentsFilter}
              onChange={(e) => setCommentsFilter(e.target.value)}
            />

            <div style={{ overflowX: 'auto' }}>
              <Table size="small" sort={commentsSort} onSortChange={handleSort(commentsSort, setCommentsSort)}>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader sortKey="comment_id" sortable>
                      Kommentar-ID
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="deployment_id" sortable>
                      Deployment
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="app_name" sortable>
                      App
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="team_slug" sortable>
                      Team
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="environment_name" sortable>
                      Miljø
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="comment_type" sortable>
                      Type
                    </Table.ColumnHeader>
                    <Table.ColumnHeader sortKey="created_at" sortable>
                      Opprettet
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filteredComments.map((c) => (
                    <Table.Row key={c.comment_id}>
                      <Table.DataCell>
                        <BodyShort size="small">{c.comment_id}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <Link to={`/deployments/${c.deployment_id}`}>{c.deployment_id}</Link>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{c.app_name}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{c.team_slug}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{c.environment_name}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{c.comment_type}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{c.createdStr}</BodyShort>
                      </Table.DataCell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          </>
        )}

        <VStack gap="space-16">
          <HStack gap="space-8" align="center">
            <Heading level="2" size="medium">
              Brukermappinger uten users-rad
            </Heading>
            {mappingsWithoutUser.length > 0 && (
              <Tag variant="warning" size="small">
                {mappingsWithoutUser.length}
              </Tag>
            )}
          </HStack>
          {mappingsWithoutUser.length === 0 ? (
            <Alert variant="success" inline>
              Alle aktive brukermappinger har en tilhørende rad i users-tabellen.
            </Alert>
          ) : (
            <>
              <Alert variant="warning" inline>
                {mappingsWithoutUser.length} brukermapping
                {mappingsWithoutUser.length === 1 ? '' : 'er'} mangler rad i <code>users</code>-tabellen. Disse vil
                vises uten navn og e-post. <Link to="/admin/users">Gå til brukeroversikten</Link> for å importere
                manglende brukere.
              </Alert>
              <div>
                <Table size="small">
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>GitHub-brukernavn</Table.HeaderCell>
                      <Table.HeaderCell>NAV-ident</Table.HeaderCell>
                      <Table.HeaderCell>Navn i user_mappings</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {mappingsWithoutUser.map((m) => (
                      <Table.Row key={m.github_username}>
                        <Table.DataCell>
                          <BodyShort size="small">{m.display_github_username ?? m.github_username}</BodyShort>
                        </Table.DataCell>
                        <Table.DataCell>
                          <BodyShort size="small">{m.nav_ident ?? '—'}</BodyShort>
                        </Table.DataCell>
                        <Table.DataCell>
                          <BodyShort size="small">{m.display_name_in_mapping ?? '—'}</BodyShort>
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
    </VStack>
  )
}
