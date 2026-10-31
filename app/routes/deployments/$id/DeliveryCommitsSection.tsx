import { BodyShort, Detail, ReadMore, Tag, VStack } from '@navikt/ds-react'
import { ExternalLink } from '~/components/ExternalLink'
import { UserName } from '~/components/UserName'
import type { Route } from '../+types/$id'

type LoaderData = Route.ComponentProps['loaderData']

export type DeliveryCommitsSectionProps = {
  deliveryCommits: LoaderData['deliveryCommits']
  userMappings: LoaderData['userMappings']
  heading?: string
  description?: string
}

export function DeliveryCommitsSection({
  deliveryCommits,
  userMappings,
  heading = 'Commits i denne leveransen',
  description,
}: DeliveryCommitsSectionProps) {
  if (!deliveryCommits || deliveryCommits.length < 2) return null

  const botCount = deliveryCommits.filter((c) => c.isBot).length
  const humanCount = deliveryCommits.length - botCount

  return (
    <VStack gap="space-8">
      <ReadMore header={`${heading} (${deliveryCommits.length})`}>
        <VStack gap="space-8">
          <BodyShort size="small">
            {description ??
              `Denne leveransen består av ${deliveryCommits.length} commits${
                botCount > 0 && humanCount > 0 ? `, ${botCount} fra bot og ${humanCount} fra menneske.` : '.'
              }`}
          </BodyShort>
          <ul style={{ margin: 0, paddingLeft: 'var(--ax-space-24)' }}>
            {deliveryCommits.map((commit) => (
              <li key={commit.sha} style={{ marginBottom: 'var(--ax-space-8)' }}>
                <ExternalLink href={commit.htmlUrl} style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                  {commit.sha.substring(0, 7)}
                </ExternalLink>{' '}
                - {commit.message}
                <br />
                <Detail>
                  av{' '}
                  {commit.isBot ? (
                    <Tag data-color="neutral" variant="outline" size="xsmall">
                      🤖 {commit.botDisplayName ?? commit.authorUsername}
                    </Tag>
                  ) : (
                    <UserName username={commit.authorUsername} userMappings={userMappings} link={false} />
                  )}
                </Detail>
              </li>
            ))}
          </ul>
        </VStack>
      </ReadMore>
    </VStack>
  )
}
