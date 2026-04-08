import { LinkIcon, PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  BodyShort,
  Box,
  Button,
  Heading,
  HStack,
  Select,
  Tabs,
  Tag,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useState } from 'react'
import { Form } from 'react-router'
import type { DeploymentGoalLinkWithDetails } from '~/db/deployment-goal-links.server'

const LINK_METHOD_LABELS: Record<string, string> = {
  manual: 'Manuell',
  slack: 'Slack',
  commit_keyword: 'Commit-nøkkelord',
  pr_title: 'PR-tittel',
}

interface AvailableBoard {
  id: number
  title: string
  period_label: string
  objectives: Array<{
    id: number
    title: string
    key_results: Array<{ id: number; title: string }>
  }>
}

interface GoalLinksSectionProps {
  goalLinks: DeploymentGoalLinkWithDetails[]
  availableBoards?: AvailableBoard[]
}

export function GoalLinksSection({ goalLinks, availableBoards = [] }: GoalLinksSectionProps) {
  const [showAddLink, setShowAddLink] = useState(false)

  return (
    <VStack gap="space-16">
      <HStack justify="space-between" align="center">
        <Heading size="medium" level="2">
          Endringsopphav
        </Heading>
        <Button
          variant="tertiary"
          size="small"
          icon={<PlusIcon aria-hidden />}
          onClick={() => setShowAddLink(!showAddLink)}
        >
          Knytt til mål
        </Button>
      </HStack>

      {goalLinks.length === 0 && !showAddLink && (
        <BodyShort textColor="subtle" style={{ fontStyle: 'italic' }}>
          Ingen kobling til mål eller ekstern referanse.
        </BodyShort>
      )}

      {goalLinks.length > 0 && (
        <VStack gap="space-8">
          {goalLinks.map((link) => (
            <GoalLinkItem key={link.id} link={link} />
          ))}
        </VStack>
      )}

      {showAddLink && <AddGoalLinkForm onCancel={() => setShowAddLink(false)} availableBoards={availableBoards} />}
    </VStack>
  )
}

function GoalLinkItem({ link }: { link: DeploymentGoalLinkWithDetails }) {
  const label = link.key_result_title
    ? `${link.objective_title} → ${link.key_result_title}`
    : link.objective_title
      ? link.objective_title
      : (link.external_url_title ?? link.external_url ?? '(ukjent)')

  return (
    <Box padding="space-12" borderRadius="8" background="sunken">
      <HStack justify="space-between" align="center">
        <HStack gap="space-8" align="center" wrap>
          <LinkIcon aria-hidden />
          <div>
            {link.external_url ? (
              <AkselLink href={link.external_url} target="_blank" rel="noopener noreferrer">
                {label}
              </AkselLink>
            ) : (
              <BodyShort weight="semibold">{label}</BodyShort>
            )}
            <HStack gap="space-4">
              {link.board_period_label && (
                <Tag variant="neutral" size="xsmall">
                  {link.board_period_label}
                </Tag>
              )}
              <Tag variant={link.link_method === 'commit_keyword' ? 'alt3' : 'info'} size="xsmall">
                {LINK_METHOD_LABELS[link.link_method] ?? link.link_method}
              </Tag>
            </HStack>
          </div>
        </HStack>
        <Form method="post" style={{ display: 'inline' }}>
          <input type="hidden" name="intent" value="unlink_goal" />
          <input type="hidden" name="link_id" value={link.id} />
          <Button variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />} type="submit" />
        </Form>
      </HStack>
    </Box>
  )
}

function AddGoalLinkForm({ onCancel, availableBoards }: { onCancel: () => void; availableBoards: AvailableBoard[] }) {
  const [selectedBoardId, setSelectedBoardId] = useState('')
  const [selectedObjectiveId, setSelectedObjectiveId] = useState('')
  const [selectedKeyResultId, setSelectedKeyResultId] = useState('')

  const selectedBoard = availableBoards.find((b) => String(b.id) === selectedBoardId)
  const selectedObjective = selectedBoard?.objectives.find((o) => String(o.id) === selectedObjectiveId)

  const hasBoards = availableBoards.length > 0

  return (
    <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <Tabs defaultValue={hasBoards ? 'goal' : 'external'} size="small">
        <Tabs.List>
          {hasBoards && <Tabs.Tab value="goal" label="Mål / nøkkelresultat" />}
          <Tabs.Tab value="external" label="Ekstern referanse" />
        </Tabs.List>

        {hasBoards && (
          <Tabs.Panel value="goal">
            <Form method="post" onSubmit={onCancel}>
              <input type="hidden" name="intent" value="link_goal" />
              {selectedObjectiveId && <input type="hidden" name="objective_id" value={selectedObjectiveId} />}
              {selectedKeyResultId && <input type="hidden" name="key_result_id" value={selectedKeyResultId} />}
              <VStack gap="space-12" paddingBlock="space-16 space-0">
                <Select
                  label="Tavle"
                  size="small"
                  value={selectedBoardId}
                  onChange={(e) => {
                    setSelectedBoardId(e.target.value)
                    setSelectedObjectiveId('')
                    setSelectedKeyResultId('')
                  }}
                >
                  <option value="">Velg tavle…</option>
                  {availableBoards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.title} ({board.period_label})
                    </option>
                  ))}
                </Select>

                {selectedBoard && (
                  <Select
                    label="Mål"
                    size="small"
                    value={selectedObjectiveId}
                    onChange={(e) => {
                      setSelectedObjectiveId(e.target.value)
                      setSelectedKeyResultId('')
                    }}
                  >
                    <option value="">Velg mål…</option>
                    {selectedBoard.objectives.map((obj) => (
                      <option key={obj.id} value={obj.id}>
                        {obj.title}
                      </option>
                    ))}
                  </Select>
                )}

                {selectedObjective && selectedObjective.key_results.length > 0 && (
                  <Select
                    label="Nøkkelresultat (valgfritt)"
                    size="small"
                    value={selectedKeyResultId}
                    onChange={(e) => setSelectedKeyResultId(e.target.value)}
                  >
                    <option value="">Kun mål (ingen nøkkelresultat)</option>
                    {selectedObjective.key_results.map((kr) => (
                      <option key={kr.id} value={kr.id}>
                        {kr.title}
                      </option>
                    ))}
                  </Select>
                )}

                <HStack gap="space-8">
                  <Button type="submit" size="small" disabled={!selectedObjectiveId}>
                    Legg til
                  </Button>
                  <Button variant="tertiary" size="small" onClick={onCancel}>
                    Avbryt
                  </Button>
                </HStack>
              </VStack>
            </Form>
          </Tabs.Panel>
        )}

        <Tabs.Panel value="external">
          <Form method="post" onSubmit={onCancel}>
            <input type="hidden" name="intent" value="link_goal" />
            <VStack gap="space-12" paddingBlock="space-16 space-0">
              <HStack gap="space-12" wrap>
                <TextField
                  label="URL"
                  name="external_url"
                  size="small"
                  autoComplete="off"
                  style={{ minWidth: '300px' }}
                />
                <TextField label="Tittel (valgfritt)" name="external_url_title" size="small" autoComplete="off" />
              </HStack>
              <HStack gap="space-8">
                <Button type="submit" size="small">
                  Legg til
                </Button>
                <Button variant="tertiary" size="small" onClick={onCancel}>
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        </Tabs.Panel>
      </Tabs>
    </Box>
  )
}
