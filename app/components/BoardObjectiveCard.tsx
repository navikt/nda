import { MinusCircleIcon, PlusCircleIcon, PlusIcon, RobotIcon, TrashIcon } from '@navikt/aksel-icons'
import {
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HStack,
  Select,
  Tag,
  TextField,
  Tooltip,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useState } from 'react'
import { Form, useSubmit } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import type { BoardKeyResultWithRefs, ExternalReference, ObjectiveWithKeyResults } from '~/db/boards.server'
import type { BoardObjectiveProgress } from '~/db/dashboard-stats.server'

export function ObjectiveCard({
  objective,
  progress,
}: {
  objective: ObjectiveWithKeyResults
  progress?: BoardObjectiveProgress
}) {
  const [showAddKR, setShowAddKR] = useState(false)
  const [showAddRef, setShowAddRef] = useState(false)
  const isInactive = !objective.is_active

  const krProgressMap = new Map(progress?.key_results.map((kr) => [kr.id, kr.linked_deployments]) ?? [])

  useEffect(() => {
    if (isInactive) {
      setShowAddKR(false)
      setShowAddRef(false)
    }
  }, [isInactive])

  return (
    <Box
      padding="space-24"
      borderRadius="8"
      background="raised"
      borderColor={isInactive ? 'neutral' : 'neutral-subtle'}
      borderWidth="1"
      style={isInactive ? { opacity: 0.7 } : undefined}
    >
      <VStack gap="space-16">
        <HStack justify="space-between" align="start">
          <HStack gap="space-8" align="center">
            <div>
              <Heading level="2" size="medium">
                {objective.title}
              </Heading>
              {objective.description && <BodyShort textColor="subtle">{objective.description}</BodyShort>}
            </div>
            {isInactive && (
              <Tag variant="neutral" size="xsmall">
                Deaktivert
              </Tag>
            )}
            {objective.dependabot_target && (
              <Tag variant="alt3" size="xsmall">
                🤖 Dependabot-mål
              </Tag>
            )}
            {progress && (
              <Tag variant={progress.total_linked_deployments > 0 ? 'info' : 'neutral'} size="xsmall">
                {progress.total_linked_deployments} leveranser
              </Tag>
            )}
          </HStack>
          <Form method="post" style={{ display: 'inline' }}>
            <input type="hidden" name="intent" value={isInactive ? 'reactivate-objective' : 'deactivate-objective'} />
            <input type="hidden" name="id" value={objective.id} />
            {isInactive ? (
              <Tooltip content="Reaktiver mål">
                <Button variant="tertiary-neutral" size="xsmall" icon={<PlusCircleIcon aria-hidden />} type="submit">
                  Reaktiver
                </Button>
              </Tooltip>
            ) : (
              <Tooltip content="Deaktiver mål (kan ikke kobles til nye endringsopphav)">
                <Button variant="tertiary-neutral" size="xsmall" icon={<MinusCircleIcon aria-hidden />} type="submit">
                  Deaktiver
                </Button>
              </Tooltip>
            )}
          </Form>
        </HStack>

        {objective.external_references.length > 0 && (
          <ReferenceList refs={objective.external_references} readOnly={isInactive} />
        )}

        <KeywordEditor
          id={objective.id}
          keywords={objective.keywords ?? []}
          intent="update-objective-keywords"
          readOnly={isInactive}
        />

        {(!isInactive || objective.dependabot_target) && (
          <DependabotTargetToggle isTarget={objective.dependabot_target} objectiveId={objective.id} />
        )}

        {objective.key_results.length > 0 && (
          <VStack gap="space-8">
            <Heading level="3" size="xsmall">
              Nøkkelresultater
            </Heading>
            {objective.key_results.map((kr) => (
              <KeyResultRow
                key={kr.id}
                kr={kr}
                objectiveIsActive={objective.is_active}
                linkedDeployments={krProgressMap.get(kr.id) ?? 0}
              />
            ))}
          </VStack>
        )}

        {!isInactive && (
          <HStack gap="space-8">
            {!showAddKR && (
              <Button
                variant="tertiary"
                size="xsmall"
                icon={<PlusIcon aria-hidden />}
                onClick={() => setShowAddKR(true)}
              >
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
        )}

        {showAddKR && !isInactive && (
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

        {showAddRef && !isInactive && (
          <AddReferenceForm objectiveId={objective.id} onCancel={() => setShowAddRef(false)} />
        )}
      </VStack>
    </Box>
  )
}

function KeyResultRow({
  kr,
  objectiveIsActive,
  linkedDeployments,
}: {
  kr: BoardKeyResultWithRefs
  objectiveIsActive: boolean
  linkedDeployments: number
}) {
  const isInactive = !kr.is_active

  return (
    <Box padding="space-12" borderRadius="4" background="sunken" style={isInactive ? { opacity: 0.7 } : undefined}>
      <HStack justify="space-between" align="start">
        <HStack gap="space-8" align="center">
          <div>
            <BodyShort weight="semibold">{kr.title}</BodyShort>
            {kr.description && (
              <BodyShort size="small" textColor="subtle">
                {kr.description}
              </BodyShort>
            )}
            {kr.external_references.length > 0 && (
              <ReferenceList refs={kr.external_references} readOnly={isInactive || !objectiveIsActive} />
            )}
            <KeywordEditor
              id={kr.id}
              keywords={kr.keywords ?? []}
              intent="update-kr-keywords"
              readOnly={isInactive || !objectiveIsActive}
            />
            {((!isInactive && objectiveIsActive) || kr.dependabot_target) && (
              <DependabotTargetToggle isTarget={kr.dependabot_target} keyResultId={kr.id} />
            )}
          </div>
          {isInactive && (
            <Tag variant="neutral" size="xsmall">
              Deaktivert
            </Tag>
          )}
          {kr.dependabot_target && (
            <Tag variant="alt3" size="xsmall">
              🤖 Dependabot-mål
            </Tag>
          )}
          <Tag variant={linkedDeployments > 0 ? 'info' : 'neutral'} size="xsmall">
            {linkedDeployments} leveranser
          </Tag>
        </HStack>
        <Form method="post" style={{ display: 'inline' }}>
          <input type="hidden" name="intent" value={isInactive ? 'reactivate-key-result' : 'deactivate-key-result'} />
          <input type="hidden" name="id" value={kr.id} />
          {isInactive ? (
            objectiveIsActive ? (
              <Tooltip content="Reaktiver nøkkelresultat">
                <Button variant="tertiary-neutral" size="xsmall" icon={<PlusCircleIcon aria-hidden />} type="submit">
                  Reaktiver
                </Button>
              </Tooltip>
            ) : (
              <Tooltip content="Reaktiver målet først for å kunne endre nøkkelresultatet">
                <span>
                  <Button
                    variant="tertiary-neutral"
                    size="xsmall"
                    icon={<PlusCircleIcon aria-hidden />}
                    type="submit"
                    disabled
                  >
                    Reaktiver
                  </Button>
                </span>
              </Tooltip>
            )
          ) : objectiveIsActive ? (
            <Tooltip content="Deaktiver nøkkelresultat">
              <Button variant="tertiary-neutral" size="xsmall" icon={<MinusCircleIcon aria-hidden />} type="submit">
                Deaktiver
              </Button>
            </Tooltip>
          ) : (
            <Tooltip content="Reaktiver målet først for å kunne endre nøkkelresultatet">
              <span>
                <Button
                  variant="tertiary-neutral"
                  size="xsmall"
                  icon={<MinusCircleIcon aria-hidden />}
                  type="submit"
                  disabled
                >
                  Deaktiver
                </Button>
              </span>
            </Tooltip>
          )}
        </Form>
      </HStack>
    </Box>
  )
}

function ReferenceList({ refs, readOnly }: { refs: ExternalReference[]; readOnly?: boolean }) {
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
          <ExternalLink href={ref.url}>{ref.title ?? ref.url}</ExternalLink>
          {!readOnly && (
            <Form method="post" style={{ display: 'inline' }}>
              <input type="hidden" name="intent" value="delete-reference" />
              <input type="hidden" name="id" value={ref.id} />
              <Button variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />} type="submit" />
            </Form>
          )}
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

function KeywordEditor({
  id,
  keywords,
  intent,
  readOnly,
}: {
  id: number
  keywords: string[]
  intent: string
  readOnly?: boolean
}) {
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
            {readOnly ? (
              kw
            ) : (
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
            )}
          </Tag>
        ))}
        {!adding && !readOnly && (
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

function DependabotTargetToggle({
  isTarget,
  objectiveId,
  keyResultId,
}: {
  isTarget: boolean
  objectiveId?: number
  keyResultId?: number
}) {
  if (isTarget) {
    return (
      <Form method="post" style={{ display: 'inline' }}>
        <input type="hidden" name="intent" value="clear-dependabot-target" />
        <Button type="submit" variant="tertiary" size="xsmall" icon={<RobotIcon aria-hidden />}>
          Fjern Dependabot-mål
        </Button>
      </Form>
    )
  }

  return (
    <Form method="post" style={{ display: 'inline' }}>
      <input type="hidden" name="intent" value="set-dependabot-target" />
      {objectiveId && <input type="hidden" name="objective_id" value={objectiveId} />}
      {keyResultId && <input type="hidden" name="key_result_id" value={keyResultId} />}
      <Button type="submit" variant="tertiary" size="xsmall" icon={<RobotIcon aria-hidden />}>
        Sett som Dependabot-mål
      </Button>
    </Form>
  )
}
