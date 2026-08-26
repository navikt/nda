import { Button } from '@navikt/ds-react'
import { Link } from 'react-router'

interface SlackHistoryLinkProps {
  teamSlug: string
  environmentName: string
  appName: string
}

export function SlackHistoryLink({ teamSlug, environmentName, appName }: SlackHistoryLinkProps) {
  return (
    <Button
      as={Link}
      to={`/team/${teamSlug}/env/${environmentName}/app/${appName}/slack`}
      variant="tertiary"
      size="small"
    >
      Se all Slack-historikk
    </Button>
  )
}
