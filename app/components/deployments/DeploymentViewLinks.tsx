import { Button, HStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { type DeploymentView, deploymentViewUrl } from '~/lib/deployment-view'

export function DeploymentViewLinks({
  pathname,
  searchParams,
  currentView,
}: {
  pathname: string
  searchParams: URLSearchParams
  currentView?: DeploymentView
}) {
  return (
    <HStack gap="space-8" wrap>
      {(['application', 'repository'] as const).map((view) => (
        <Button
          key={view}
          as={Link}
          to={deploymentViewUrl(pathname, searchParams, view)}
          variant="tertiary"
          size="small"
          aria-current={currentView === view ? 'page' : undefined}
        >
          {view === 'application' ? 'Applikasjonsbasert vurdering' : 'Repositorybasert vurdering'}
        </Button>
      ))}
    </HStack>
  )
}
