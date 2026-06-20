import { Alert, BodyShort, Box, Button, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { pool } from '~/db/connection.server'
import { getDeploymentById } from '~/db/deployments.server'
import { getUserIdentity } from '~/lib/auth.server'
import { endOfDay } from '~/lib/date-utils'
import { matchCommitKeywords } from '~/lib/goal-keyword-matcher'
import { extractCommitInfos } from '~/lib/sync/github-verify.server'
import { findDevTeamsForDeployment, loadBoardKeywords } from '~/lib/sync/goal-keyword-helpers.server'
import type { Route } from './+types/$team.env.$env.app.$app.deployments.$deploymentId.debug-keywords'

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await getUserIdentity(request)
  if (user?.role !== 'admin') {
    throw new Response('Admin access required', { status: 403 })
  }

  const deploymentId = Number.parseInt(params.deploymentId, 10)
  if (Number.isNaN(deploymentId)) {
    throw new Response('Invalid deployment ID', { status: 400 })
  }

  const deployment = await getDeploymentById(deploymentId)
  if (!deployment) {
    throw new Response('Deployment not found', { status: 404 })
  }

  const commitInfos = extractCommitInfos(deployment as Parameters<typeof extractCommitInfos>[0])

  if (!deployment.monitored_app_id) {
    return {
      deployment: {
        id: deployment.id,
        title: deployment.title,
        team_slug: deployment.team_slug,
        environment_name: deployment.environment_name,
        app_name: deployment.app_name,
        created_at: deployment.created_at,
        commit_sha: deployment.commit_sha,
        monitored_app_id: null as number | null,
      },
      commitInfos: [] as Array<{ message: string; date: string }>,
      devTeams: [] as Array<{ id: number; name: string }>,
      ambiguousKeywords: [] as string[],
      boardKeywords: [] as Array<{
        boardId: number
        boardName: string
        periodStart: string
        periodEnd: string
        objectiveId: number
        objectiveTitle: string
        keyResultId: number | null
        keyResultTitle: string | null
        keyword: string
      }>,
      matches: [] as Array<{
        boardId: number
        objectiveId: number
        keyResultId: number | null
        keyword: string
        objectiveTitle: string
        keyResultTitle: string | null
      }>,
      existingLinks: [] as Array<{
        objective_id: number
        key_result_id: number | null
        link_method: string
        objective_title: string | null
        key_result_title: string | null
      }>,
      error: 'Deployment er ikke koblet til en overvåket applikasjon',
    }
  }

  const devTeams = await findDevTeamsForDeployment(deployment.team_slug, deployment.monitored_app_id)

  const devTeamIds = devTeams.map((r) => r.id)
  const { rows: boardKeywordsRaw, parsed: boardKeywords } = await loadBoardKeywords(devTeamIds)

  const matches = matchCommitKeywords(commitInfos, boardKeywords)

  const ambiguousKeywords: string[] = []
  if (commitInfos.length > 0 && boardKeywords.length > 0) {
    const keywordBoardHits = new Map<string, Set<number>>()
    for (const commit of commitInfos) {
      const msgLower = commit.message.toLowerCase()
      for (const bk of boardKeywords) {
        if (commit.date < bk.periodStart || commit.date > endOfDay(bk.periodEnd)) continue
        if (msgLower.includes(bk.keyword.toLowerCase())) {
          const hits = keywordBoardHits.get(bk.keyword.toLowerCase()) ?? new Set()
          hits.add(bk.boardId)
          keywordBoardHits.set(bk.keyword.toLowerCase(), hits)
        }
      }
    }
    for (const [kw, boards] of keywordBoardHits) {
      if (boards.size > 1) ambiguousKeywords.push(kw)
    }
  }

  const existingLinksResult = await pool.query(
    `SELECT dgl.objective_id, dgl.key_result_id, dgl.link_method,
            bo.title AS objective_title, bkr.title AS key_result_title
     FROM deployment_goal_links dgl
     LEFT JOIN board_objectives bo ON bo.id = dgl.objective_id
     LEFT JOIN board_key_results bkr ON bkr.id = dgl.key_result_id
     WHERE dgl.deployment_id = $1 AND dgl.is_active = true`,
    [deploymentId],
  )

  return {
    deployment: {
      id: deployment.id,
      title: deployment.title,
      team_slug: deployment.team_slug,
      environment_name: deployment.environment_name,
      app_name: deployment.app_name,
      created_at: deployment.created_at,
      commit_sha: deployment.commit_sha,
      monitored_app_id: deployment.monitored_app_id,
    },
    commitInfos: commitInfos.map((c) => ({ message: c.message, date: c.date.toISOString() })),
    devTeams,
    ambiguousKeywords,
    boardKeywords: boardKeywordsRaw.map((r) => ({
      boardId: r.board_id,
      boardName: r.board_name,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      objectiveId: r.objective_id,
      objectiveTitle: r.objective_title,
      keyResultId: r.key_result_id,
      keyResultTitle: r.key_result_title,
      keyword: r.keyword,
    })),
    matches: matches.map((m) => ({
      ...m,
      objectiveTitle: boardKeywordsRaw.find((bk) => bk.objective_id === m.objectiveId)?.objective_title ?? '',
      keyResultTitle: boardKeywordsRaw.find((bk) => bk.key_result_id === m.keyResultId)?.key_result_title ?? null,
    })),
    existingLinks: existingLinksResult.rows as Array<{
      objective_id: number
      key_result_id: number | null
      link_method: string
      objective_title: string | null
      key_result_title: string | null
    }>,
  }
}

export function meta() {
  return [{ title: 'Debug Nøkkelord-kobling' }]
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function DebugKeywordsPage({ loaderData }: Route.ComponentProps) {
  const { deployment, commitInfos, devTeams, boardKeywords, matches, existingLinks, ambiguousKeywords } = loaderData
  const error = 'error' in loaderData ? (loaderData.error as string) : null
  const appUrl = `/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}`

  const handleExport = () => {
    const filename = `debug-keywords-${deployment.id}-${new Date().toISOString().slice(0, 10)}.json`
    downloadJson(loaderData, filename)
  }

  const keywordsByBoard = new Map<number, { boardName: string; keywords: typeof boardKeywords }>()
  for (const bk of boardKeywords) {
    const entry = keywordsByBoard.get(bk.boardId) ?? { boardName: bk.boardName, keywords: [] }
    entry.keywords.push(bk)
    keywordsByBoard.set(bk.boardId, entry)
  }

  const ambiguousSet = new Set(ambiguousKeywords)

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-6">
        <HStack justify="space-between" align="center">
          <VStack gap="space-2">
            <Heading size="large" level="1">
              🔑 Debug Nøkkelord-kobling
            </Heading>
            <BodyShort>
              Deployment #{deployment.id} — {deployment.title ?? deployment.commit_sha?.substring(0, 7) ?? 'ukjent'}
            </BodyShort>
          </VStack>
          <HStack gap="space-4" align="center">
            <Button variant="secondary" size="small" onClick={handleExport}>
              📥 Eksporter JSON
            </Button>
            <Link to={`${appUrl}/deployments/${deployment.id}`}>
              <Button variant="secondary" size="small">
                ← Tilbake
              </Button>
            </Link>
          </HStack>
        </HStack>

        {error && (
          <Alert variant="error">
            <BodyShort>{error}</BodyShort>
          </Alert>
        )}

        {/* Summary */}
        <Box background={matches.length > 0 ? 'success-soft' : 'warning-soft'} padding="space-4" borderRadius="8">
          <HStack gap="space-4" align="center">
            <Tag variant={matches.length > 0 ? 'success' : 'warning'}>
              {matches.length > 0 ? `${matches.length} treff` : 'Ingen treff'}
            </Tag>
            <BodyShort>
              {matches.length > 0
                ? `Fant ${matches.length} nøkkelord-kobling(er) basert på commit-meldinger`
                : 'Ingen nøkkelord i commit-meldinger matchet tavlens mål'}
            </BodyShort>
          </HStack>
        </Box>

        {/* Step 1: Dev teams found */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8">
          <VStack gap="space-4">
            <Heading size="small" level="2">
              Steg 1: Finn utviklingsteam
            </Heading>
            {devTeams.length > 0 ? (
              <HStack gap="space-2">
                {devTeams.map((t) => (
                  <Tag key={t.id} variant="info">
                    {t.name}
                  </Tag>
                ))}
              </HStack>
            ) : (
              <Alert variant="error" size="small">
                Ingen utviklingsteam funnet for team_slug=&quot;{deployment.team_slug}&quot; / monitored_app_id=
                {deployment.monitored_app_id}
              </Alert>
            )}
          </VStack>
        </Box>

        {/* Step 2: Commit messages extracted */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8">
          <VStack gap="space-4">
            <Heading size="small" level="2">
              Steg 2: Commit-meldinger ({commitInfos.length})
            </Heading>
            {commitInfos.length === 0 ? (
              <Alert variant="warning" size="small">
                Ingen commit-meldinger funnet (PR-tittel, unverified_commits, eller PR-commits)
              </Alert>
            ) : (
              <VStack gap="space-2">
                {commitInfos.map((c) => (
                  <Box key={`${c.date}-${c.message}`} padding="space-2" background="raised" borderRadius="4">
                    <VStack gap="space-1">
                      <BodyShort size="small" weight="semibold">
                        {c.message.split('\n')[0]}
                      </BodyShort>
                      <BodyShort size="small" textColor="subtle">
                        Dato: {new Date(c.date).toLocaleDateString('nb-NO')}
                      </BodyShort>
                    </VStack>
                  </Box>
                ))}
              </VStack>
            )}
          </VStack>
        </Box>

        {/* Step 3: Board keywords */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8">
          <VStack gap="space-4">
            <Heading size="small" level="2">
              Steg 3: Nøkkelord fra tavler ({boardKeywords.length})
            </Heading>
            {boardKeywords.length === 0 ? (
              <Alert variant="warning" size="small">
                Ingen nøkkelord konfigurert på aktive tavler for dette teamet
              </Alert>
            ) : (
              <VStack gap="space-4">
                {[...keywordsByBoard.entries()].map(([boardId, { boardName, keywords }]) => (
                  <Box key={boardId} padding="space-4" background="raised" borderRadius="4">
                    <VStack gap="space-2">
                      <BodyShort size="small" weight="semibold">
                        📋 {boardName}
                      </BodyShort>
                      <BodyShort size="small" textColor="subtle">
                        Periode: {new Date(keywords[0].periodStart).toLocaleDateString('nb-NO')} –{' '}
                        {new Date(keywords[0].periodEnd).toLocaleDateString('nb-NO')}
                      </BodyShort>
                      <HStack gap="space-2" wrap>
                        {keywords.map((kw) => (
                          <Tag
                            key={`${kw.keyword}-${kw.objectiveId}-${kw.keyResultId}`}
                            variant={ambiguousSet.has(kw.keyword.toLowerCase()) ? 'warning' : 'neutral'}
                            size="small"
                          >
                            {kw.keyword}
                            {kw.keyResultTitle ? ` → ${kw.keyResultTitle}` : ` → ${kw.objectiveTitle}`}
                          </Tag>
                        ))}
                      </HStack>
                    </VStack>
                  </Box>
                ))}
              </VStack>
            )}
            {ambiguousSet.size > 0 && (
              <Alert variant="warning" size="small">
                Tvetydige nøkkelord (matchet i flere tavler for disse commit-datoene, ignoreres):{' '}
                {ambiguousKeywords.join(', ')}
              </Alert>
            )}
          </VStack>
        </Box>

        {/* Step 4: Matching results */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8">
          <VStack gap="space-4">
            <Heading size="small" level="2">
              Steg 4: Matchingsresultat
            </Heading>
            {matches.length > 0 ? (
              <VStack gap="space-2">
                {matches.map((m) => (
                  <Box
                    key={`${m.objectiveId}:${m.keyResultId ?? 'obj'}`}
                    padding="space-2"
                    background="success-soft"
                    borderRadius="4"
                  >
                    <HStack gap="space-2" align="center">
                      <Tag variant="success" size="small">
                        ✓ Match
                      </Tag>
                      <BodyShort size="small">
                        Nøkkelord &quot;{m.keyword}&quot; → {m.objectiveTitle}
                        {m.keyResultTitle ? ` / ${m.keyResultTitle}` : ''}
                      </BodyShort>
                    </HStack>
                  </Box>
                ))}
              </VStack>
            ) : (
              <BodyShort size="small">Ingen match funnet. Mulige årsaker:</BodyShort>
            )}
            {matches.length === 0 && (
              <VStack gap="space-1">
                <BodyShort size="small">• Ingen av nøkkelordene finnes i commit-meldingene</BodyShort>
                <BodyShort size="small">• Commit-datoen er utenfor tavlens periode</BodyShort>
                <BodyShort size="small">• Nøkkelord ble funnet, men er tvetydige (finnes i flere tavler)</BodyShort>
                <BodyShort size="small">• Ingen nøkkelord er konfigurert på tavlens mål</BodyShort>
              </VStack>
            )}
          </VStack>
        </Box>

        {/* Existing links */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8">
          <VStack gap="space-4">
            <Heading size="small" level="2">
              Eksisterende koblinger ({existingLinks.length})
            </Heading>
            {existingLinks.length > 0 ? (
              <VStack gap="space-2">
                {existingLinks.map((link) => (
                  <Box
                    key={`${link.objective_id}:${link.key_result_id ?? 'obj'}`}
                    padding="space-2"
                    background="raised"
                    borderRadius="4"
                  >
                    <HStack gap="space-2" align="center">
                      <Tag variant="info" size="small">
                        {link.link_method}
                      </Tag>
                      <BodyShort size="small">
                        {link.objective_title ?? `Mål #${link.objective_id}`}
                        {link.key_result_title ? ` / ${link.key_result_title}` : ''}
                      </BodyShort>
                    </HStack>
                  </Box>
                ))}
              </VStack>
            ) : (
              <BodyShort size="small">Ingen aktive koblinger for denne deploymenten</BodyShort>
            )}
          </VStack>
        </Box>
      </VStack>
    </Box>
  )
}
