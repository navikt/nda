import { TextField } from '@navikt/ds-react'

export interface SlackMemberIdFieldProps {
  isLoading: boolean
  isAutoDetected: boolean
  autoDetectedValue: string | null
  name?: string
  defaultValue?: string
}

export function SlackMemberIdField({
  isLoading,
  isAutoDetected,
  autoDetectedValue,
  name = 'slack_member_id',
  defaultValue = '',
}: SlackMemberIdFieldProps) {
  return (
    <>
      <TextField
        key={isAutoDetected ? 'auto' : 'manual'}
        label="Slack member ID"
        name={isAutoDetected ? undefined : name}
        value={isAutoDetected ? (autoDetectedValue ?? '') : undefined}
        defaultValue={isAutoDetected ? undefined : defaultValue}
        disabled={isAutoDetected}
        readOnly={isAutoDetected}
        description={
          isLoading
            ? 'Slår opp Slack-ID automatisk …'
            : isAutoDetected
              ? 'Funnet automatisk basert på e-postadresse i Slack'
              : undefined
        }
      />
      {isAutoDetected && <input type="hidden" name={name} value={autoDetectedValue ?? ''} />}
    </>
  )
}
