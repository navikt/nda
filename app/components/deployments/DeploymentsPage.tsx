import { BodyShort, Box, HStack, Select, TextField, VStack } from '@navikt/ds-react'
import type { ComponentProps } from 'react'
import { Form } from 'react-router'
import type { UserMappings } from '~/lib/user-display'
import { DeploymentRow } from './DeploymentRow'
import { PaginationControls } from './PaginationControls'

type DeploymentStoryItem = ComponentProps<typeof DeploymentRow>['deployment']

interface DeploymentsPageProps {
  deployments: DeploymentStoryItem[]
  total: number
  page: number
  totalPages: number
  userMappings: UserMappings
}

export function DeploymentsPage({ deployments, total, page, totalPages, userMappings }: DeploymentsPageProps) {
  return (
    <VStack gap="space-32">
      <Box padding="space-20" borderRadius="8" background="sunken">
        <Form method="get">
          <VStack gap="space-16">
            <HStack gap="space-16" wrap>
              <Select label="Tidsperiode" size="small" defaultValue="last-week">
                <option value="last-week">Siste 7 dager</option>
                <option value="last-month">Siste 30 dager</option>
                <option value="last-quarter">Siste kvartal</option>
                <option value="this-year">I år</option>
                <option value="all">Alle</option>
              </Select>

              <Select label="Status" size="small" defaultValue="">
                <option value="">Alle</option>
                <option value="approved">Godkjent</option>
                <option value="manually_approved">Manuelt godkjent</option>
                <option value="direct_push">Direct Push</option>
                <option value="pending">Venter</option>
                <option value="error">Feil</option>
              </Select>

              <Select label="Metode" size="small" defaultValue="">
                <option value="">Alle</option>
                <option value="pr">Pull Request</option>
                <option value="direct_push">Direct Push</option>
                <option value="legacy">Legacy</option>
              </Select>

              <TextField label="Deployer" size="small" placeholder="Søk..." />

              <TextField label="Commit SHA" size="small" placeholder="Søk..." />
            </HStack>
          </VStack>
        </Form>
      </Box>

      <BodyShort textColor="subtle">
        {total} deployment{total !== 1 ? 's' : ''} funnet
      </BodyShort>

      <div>
        {deployments.length === 0 ? (
          <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort>Ingen deployments funnet med valgte filtre.</BodyShort>
          </Box>
        ) : (
          deployments.map((deployment) => (
            <DeploymentRow
              key={deployment.id}
              deployment={deployment}
              userMappings={userMappings}
              showEnv={false}
              showApp={false}
            />
          ))
        )}
      </div>

      <PaginationControls page={page} totalPages={totalPages} onPageChange={() => undefined} />
    </VStack>
  )
}
