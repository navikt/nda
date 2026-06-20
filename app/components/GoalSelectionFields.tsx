import { Select, TextField } from '@navikt/ds-react'
import { useState } from 'react'
import { formatBoardLabel } from '~/lib/board-periods'

export interface GoalSelectionBoard {
  id: number
  period_label: string
  dev_team_name?: string
  objectives: Array<{
    id: number
    title: string
    key_results: Array<{ id: number; title: string }>
  }>
}

interface GoalSelectionFieldsProps {
  boards: GoalSelectionBoard[]
  includeNameAttributes?: boolean
  onObjectiveChange?: (objectiveId: string) => void
}

export function GoalSelectionFields({
  boards,
  includeNameAttributes = true,
  onObjectiveChange,
}: GoalSelectionFieldsProps) {
  const [selectedBoardId, setSelectedBoardId] = useState('')
  const [selectedObjectiveId, setSelectedObjectiveId] = useState('')
  const [selectedKeyResultId, setSelectedKeyResultId] = useState('')

  const selectedBoard = boards.find((b) => String(b.id) === selectedBoardId)
  const selectedObjective = selectedBoard?.objectives.find((o) => String(o.id) === selectedObjectiveId)

  return (
    <>
      <Select
        label="Tavle"
        size="small"
        value={selectedBoardId}
        onChange={(e) => {
          setSelectedBoardId(e.target.value)
          setSelectedObjectiveId('')
          setSelectedKeyResultId('')
          onObjectiveChange?.('')
        }}
      >
        <option value="">Velg tavle…</option>
        {boards.map((board) => (
          <option key={board.id} value={String(board.id)}>
            {formatBoardLabel({ teamName: board.dev_team_name ?? '', periodLabel: board.period_label })}
          </option>
        ))}
      </Select>

      <Select
        label="Mål"
        size="small"
        disabled={!selectedBoard}
        value={selectedObjectiveId}
        name={includeNameAttributes ? 'objective_id' : undefined}
        onChange={(e) => {
          setSelectedObjectiveId(e.target.value)
          setSelectedKeyResultId('')
          onObjectiveChange?.(e.target.value)
        }}
      >
        <option value="">Velg mål…</option>
        {selectedBoard?.objectives.map((obj) => (
          <option key={obj.id} value={String(obj.id)}>
            {obj.title}
          </option>
        ))}
      </Select>

      <Select
        label="Nøkkelresultat (valgfritt)"
        size="small"
        disabled={!selectedObjective}
        value={selectedKeyResultId}
        name={includeNameAttributes ? 'key_result_id' : undefined}
        onChange={(e) => setSelectedKeyResultId(e.target.value)}
      >
        <option value="">Ingen spesifikt nøkkelresultat</option>
        {selectedObjective?.key_results.map((kr) => (
          <option key={kr.id} value={String(kr.id)}>
            {kr.title}
          </option>
        ))}
      </Select>

      <TextField
        label="Lenke (valgfritt)"
        description="Ekstern referanse, f.eks. Slack-tråd eller liknende ad-hoc bestilling"
        name="external_url"
        size="small"
        autoComplete="off"
      />

      <TextField label="Kommentar (valgfritt)" name="comment" size="small" autoComplete="off" />
    </>
  )
}
