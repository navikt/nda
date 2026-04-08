import { ChevronLeftIcon, PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HStack,
  Select,
  Tag,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useState } from 'react'
import { Form, Link, useLoaderData, useSubmit } from 'react-router'
import {
  addExternalReference,
  createKeyResult,
  createObjective,
  deleteExternalReference,
  deleteKeyResult,
  deleteObjective,
  type ExternalReference,
  getBoardWithObjectives,
  type ObjectiveWithKeyResults,
  updateKeyResult,
  updateKeyResultKeywords,
  updateObjective,
  updateObjectiveKeywords,
} from '~/db/boards.server'
import { getDevTeamBySlug } from '~/db/dev-teams.server'
import { getSectionBySlug } from '~/db/sections.server'
import { requireUser } from '~/lib/auth.server'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug.$boardId'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.board?.title ?? 'Tavle'} – ${data?.devTeam?.name ?? 'Team'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) throw new Response('Utviklingsteam ikke funnet', { status: 404 })

  const board = await getBoardWithObjectives(Number(params.boardId))
  if (!board || board.dev_team_id !== devTeam.id) throw new Response('Tavle ikke funnet', { status: 404 })

  const section = await getSectionBySlug(params.sectionSlug)
  return { devTeam, board, sectionSlug: params.sectionSlug, sectionName: section?.name ?? params.sectionSlug }
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) throw new Response('Utviklingsteam ikke funnet', { status: 404 })

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  try {
    switch (intent) {
      case 'add-objective': {
        const title = (formData.get('title') as string)?.trim()
        if (!title) return { error: 'Tittel er påkrevd.' }
        await createObjective(Number(params.boardId), title, (formData.get('description') as string)?.trim())
        return { success: true }
      }
      case 'update-objective': {
        const id = Number(formData.get('id'))
        const title = (formData.get('title') as string)?.trim()
        if (!title) return { error: 'Tittel er påkrevd.' }
        await updateObjective(id, { title, description: (formData.get('description') as string)?.trim() })
        return { success: true }
      }
      case 'delete-objective': {
        await deleteObjective(Number(formData.get('id')))
        return { success: true }
      }
      case 'add-key-result': {
        const objectiveId = Number(formData.get('objective_id'))
        const title = (formData.get('title') as string)?.trim()
        if (!title) return { error: 'Tittel er påkrevd.' }
        await createKeyResult(objectiveId, title, (formData.get('description') as string)?.trim())
        return { success: true }
      }
      case 'update-key-result': {
        const id = Number(formData.get('id'))
        const title = (formData.get('title') as string)?.trim()
        if (!title) return { error: 'Tittel er påkrevd.' }
        await updateKeyResult(id, { title, description: (formData.get('description') as string)?.trim() })
        return { success: true }
      }
      case 'delete-key-result': {
        await deleteKeyResult(Number(formData.get('id')))
        return { success: true }
      }
      case 'add-reference': {
        const refType = formData.get('ref_type') as ExternalReference['ref_type']
        const url = (formData.get('url') as string)?.trim()
        const title = (formData.get('ref_title') as string)?.trim()
        const objectiveId = formData.get('objective_id') ? Number(formData.get('objective_id')) : undefined
        const keyResultId = formData.get('key_result_id') ? Number(formData.get('key_result_id')) : undefined
        if (!url) return { error: 'URL er påkrevd.' }
        await addExternalReference({
          ref_type: refType,
          url,
          title,
          objective_id: objectiveId,
          key_result_id: keyResultId,
        })
        return { success: true }
      }
      case 'delete-reference': {
        await deleteExternalReference(Number(formData.get('id')))
        return { success: true }
      }
      case 'update-objective-keywords': {
        const id = Number(formData.get('id'))
        const raw = (formData.get('keywords') as string) ?? ''
        const keywords = raw
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
        await updateObjectiveKeywords(id, keywords)
        return { success: true }
      }
      case 'update-kr-keywords': {
        const id = Number(formData.get('id'))
        const raw = (formData.get('keywords') as string) ?? ''
        const keywords = raw
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
        await updateKeyResultKeywords(id, keywords)
        return { success: true }
      }
      default:
        return { error: 'Ukjent handling.' }
    }
  } catch (error) {
    return { error: `Feil: ${error}` }
  }
}

export default function BoardDetail() {
  const { devTeam, board, sectionSlug } = useLoaderData<typeof loader>()
  const [showAddObjective, setShowAddObjective] = useState(false)
  const teamBasePath = `/sections/${sectionSlug}/teams/${devTeam.slug}`

  return (
    <VStack gap="space-24">
      <div>
        <HStack gap="space-8" align="center">
          <Button as={Link} to={teamBasePath} variant="tertiary" size="small" icon={<ChevronLeftIcon aria-hidden />}>
            Tilbake
          </Button>
        </HStack>
        <Heading level="1" size="large" spacing>
          {board.title}
        </Heading>
        <HStack gap="space-8">
          <Tag variant="neutral" size="small">
            {board.period_type === 'tertiary' ? 'Tertial' : 'Kvartal'}
          </Tag>
          <Tag variant="info" size="small">
            {board.period_label}
          </Tag>
          <Tag variant={board.is_active ? 'success' : 'neutral'} size="small">
            {board.is_active ? 'Aktiv' : 'Avsluttet'}
          </Tag>
        </HStack>
      </div>

      {board.objectives.length === 0 && !showAddObjective && (
        <Alert variant="info">Ingen mål er lagt til ennå. Legg til det første målet for denne tavlen.</Alert>
      )}

      {board.objectives.map((objective) => (
        <ObjectiveCard key={objective.id} objective={objective} />
      ))}

      {!showAddObjective ? (
        <HStack>
          <Button
            variant="secondary"
            size="small"
            icon={<PlusIcon aria-hidden />}
            onClick={() => setShowAddObjective(true)}
          >
            Legg til mål
          </Button>
        </HStack>
      ) : (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <Form method="post" onSubmit={() => setShowAddObjective(false)}>
            <input type="hidden" name="intent" value="add-objective" />
            <VStack gap="space-16">
              <Heading level="2" size="small">
                Nytt mål (Objective)
              </Heading>
              <TextField label="Tittel" name="title" size="small" autoComplete="off" />
              <TextField label="Beskrivelse (valgfritt)" name="description" size="small" autoComplete="off" />
              <HStack gap="space-8">
                <Button type="submit" size="small">
                  Legg til
                </Button>
                <Button variant="tertiary" size="small" onClick={() => setShowAddObjective(false)}>
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        </Box>
      )}
    </VStack>
  )
}

function ObjectiveCard({ objective }: { objective: ObjectiveWithKeyResults }) {
  const [showAddKR, setShowAddKR] = useState(false)
  const [showAddRef, setShowAddRef] = useState(false)

  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <HStack justify="space-between" align="start">
          <div>
            <Heading level="2" size="medium">
              {objective.title}
            </Heading>
            {objective.description && <BodyShort textColor="subtle">{objective.description}</BodyShort>}
          </div>
          <Form method="post" style={{ display: 'inline' }}>
            <input type="hidden" name="intent" value="delete-objective" />
            <input type="hidden" name="id" value={objective.id} />
            <Button variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />} type="submit">
              Slett
            </Button>
          </Form>
        </HStack>

        {objective.external_references.length > 0 && <ReferenceList refs={objective.external_references} />}

        <KeywordEditor id={objective.id} keywords={objective.keywords ?? []} intent="update-objective-keywords" />

        {objective.key_results.length > 0 && (
          <VStack gap="space-8">
            <Heading level="3" size="xsmall">
              Nøkkelresultater
            </Heading>
            {objective.key_results.map((kr) => (
              <Box key={kr.id} padding="space-12" borderRadius="4" background="sunken">
                <HStack justify="space-between" align="start">
                  <div>
                    <BodyShort weight="semibold">{kr.title}</BodyShort>
                    {kr.description && (
                      <BodyShort size="small" textColor="subtle">
                        {kr.description}
                      </BodyShort>
                    )}
                    {kr.external_references.length > 0 && <ReferenceList refs={kr.external_references} />}
                    <KeywordEditor id={kr.id} keywords={kr.keywords ?? []} intent="update-kr-keywords" />
                  </div>
                  <Form method="post" style={{ display: 'inline' }}>
                    <input type="hidden" name="intent" value="delete-key-result" />
                    <input type="hidden" name="id" value={kr.id} />
                    <Button variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />} type="submit">
                      Slett
                    </Button>
                  </Form>
                </HStack>
              </Box>
            ))}
          </VStack>
        )}

        <HStack gap="space-8">
          {!showAddKR && (
            <Button variant="tertiary" size="xsmall" icon={<PlusIcon aria-hidden />} onClick={() => setShowAddKR(true)}>
              Nøkkelresultat
            </Button>
          )}
          {!showAddRef && (
            <Button
              variant="tertiary"
              size="xsmall"
              icon={<PlusIcon aria-hidden />}
              onClick={() => setShowAddRef(true)}
            >
              Ekstern lenke
            </Button>
          )}
        </HStack>

        {showAddKR && (
          <Form method="post" onSubmit={() => setShowAddKR(false)}>
            <input type="hidden" name="intent" value="add-key-result" />
            <input type="hidden" name="objective_id" value={objective.id} />
            <VStack gap="space-8">
              <TextField label="Nøkkelresultat" name="title" size="small" autoComplete="off" />
              <TextField label="Beskrivelse (valgfritt)" name="description" size="small" autoComplete="off" />
              <HStack gap="space-8">
                <Button type="submit" size="xsmall">
                  Legg til
                </Button>
                <Button variant="tertiary" size="xsmall" onClick={() => setShowAddKR(false)}>
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        )}

        {showAddRef && <AddReferenceForm objectiveId={objective.id} onCancel={() => setShowAddRef(false)} />}
      </VStack>
    </Box>
  )
}

function ReferenceList({ refs }: { refs: ExternalReference[] }) {
  const REF_TYPE_LABELS: Record<string, string> = {
    jira: 'Jira',
    slack: 'Slack',
    confluence: 'Confluence',
    github_issue: 'GitHub Issue',
    other: 'Lenke',
  }

  return (
    <HStack gap="space-4" wrap>
      {refs.map((ref) => (
        <HStack key={ref.id} gap="space-4" align="center">
          <Tag variant="info" size="xsmall">
            {REF_TYPE_LABELS[ref.ref_type] ?? ref.ref_type}
          </Tag>
          <AkselLink href={ref.url} target="_blank" rel="noopener noreferrer">
            {ref.title ?? ref.url}
          </AkselLink>
          <Form method="post" style={{ display: 'inline' }}>
            <input type="hidden" name="intent" value="delete-reference" />
            <input type="hidden" name="id" value={ref.id} />
            <Button variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />} type="submit" />
          </Form>
        </HStack>
      ))}
    </HStack>
  )
}

function AddReferenceForm({
  objectiveId,
  keyResultId,
  onCancel,
}: {
  objectiveId?: number
  keyResultId?: number
  onCancel: () => void
}) {
  return (
    <Form method="post" onSubmit={onCancel}>
      <input type="hidden" name="intent" value="add-reference" />
      {objectiveId && <input type="hidden" name="objective_id" value={objectiveId} />}
      {keyResultId && <input type="hidden" name="key_result_id" value={keyResultId} />}
      <VStack gap="space-8">
        <HStack gap="space-8" wrap>
          <Select label="Type" name="ref_type" size="small">
            <option value="jira">Jira</option>
            <option value="slack">Slack</option>
            <option value="confluence">Confluence</option>
            <option value="github_issue">GitHub Issue</option>
            <option value="other">Annet</option>
          </Select>
          <TextField label="URL" name="url" size="small" autoComplete="off" style={{ minWidth: '300px' }} />
          <TextField label="Tittel (valgfritt)" name="ref_title" size="small" autoComplete="off" />
        </HStack>
        <HStack gap="space-8">
          <Button type="submit" size="xsmall">
            Legg til
          </Button>
          <Button variant="tertiary" size="xsmall" onClick={onCancel}>
            Avbryt
          </Button>
        </HStack>
      </VStack>
    </Form>
  )
}

function KeywordEditor({ id, keywords, intent }: { id: number; keywords: string[]; intent: string }) {
  const [adding, setAdding] = useState(false)
  const [newKeyword, setNewKeyword] = useState('')
  const submit = useSubmit()

  function handleAdd() {
    const trimmed = newKeyword.trim()
    if (!trimmed || keywords.includes(trimmed)) return
    const updated = [...keywords, trimmed]
    const formData = new FormData()
    formData.set('intent', intent)
    formData.set('id', String(id))
    formData.set('keywords', updated.join(','))
    submit(formData, { method: 'post' })
    setNewKeyword('')
    setAdding(false)
  }

  function handleRemove(keyword: string) {
    const updated = keywords.filter((k) => k !== keyword)
    const formData = new FormData()
    formData.set('intent', intent)
    formData.set('id', String(id))
    formData.set('keywords', updated.join(','))
    submit(formData, { method: 'post' })
  }

  return (
    <VStack gap="space-4">
      <HStack gap="space-4" align="center" wrap>
        <Detail textColor="subtle">Kode-ord:</Detail>
        {keywords.length === 0 && !adding && (
          <Detail textColor="subtle" style={{ fontStyle: 'italic' }}>
            Ingen
          </Detail>
        )}
        {keywords.map((kw) => (
          <Tag key={kw} variant="neutral" size="xsmall">
            <HStack gap="space-4" align="center">
              {kw}
              <button
                type="button"
                onClick={() => handleRemove(kw)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                aria-label={`Fjern kode-ord ${kw}`}
              >
                ×
              </button>
            </HStack>
          </Tag>
        ))}
        {!adding && (
          <Button
            variant="tertiary-neutral"
            size="xsmall"
            icon={<PlusIcon aria-hidden />}
            onClick={() => setAdding(true)}
          >
            Legg til
          </Button>
        )}
      </HStack>
      {adding && (
        <HStack gap="space-4" align="end">
          <TextField
            label="Kode-ord"
            hideLabel
            size="small"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="f.eks. PEN-123"
            autoFocus
            style={{ width: '160px' }}
          />
          <Button size="xsmall" onClick={handleAdd}>
            Legg til
          </Button>
          <Button
            variant="tertiary"
            size="xsmall"
            onClick={() => {
              setAdding(false)
              setNewKeyword('')
            }}
          >
            Avbryt
          </Button>
        </HStack>
      )}
    </VStack>
  )
}
