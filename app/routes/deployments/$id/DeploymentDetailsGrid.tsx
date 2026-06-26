import { CheckmarkIcon, XMarkIcon } from '@navikt/aksel-icons'
import { BodyShort, CopyButton, Detail, Heading, HGrid, HStack, Tag, VStack } from '@navikt/ds-react'
import { ExternalLink } from '~/components/ExternalLink'
import { UserName } from '~/components/UserName'
import type { Route } from '../+types/$id'

type LoaderData = Route.ComponentProps['loaderData']

export type DeploymentDetailsGridProps = {
  deployment: LoaderData['deployment']
  userMappings: LoaderData['userMappings']
}

export function DeploymentDetailsGrid({ deployment, userMappings }: DeploymentDetailsGridProps) {
  return (
    <>
      <Heading size="medium" level="2">
        Detaljer
      </Heading>
      <HGrid gap="space-16" columns={{ xs: 1, sm: 2, md: 3 }}>
        <VStack gap="space-4">
          <Detail>Deployer</Detail>
          <BodyShort>
            <UserName username={deployment.deployer_username} userMappings={userMappings} link="github" />
          </BodyShort>
        </VStack>

        <VStack gap="space-4">
          <Detail>Commit SHA</Detail>
          <HStack gap="space-8" align="center">
            <BodyShort>
              {deployment.commit_sha ? (
                <ExternalLink
                  href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                  style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                >
                  {deployment.commit_sha.substring(0, 7)}
                </ExternalLink>
              ) : (
                <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>(ukjent)</span>
              )}
            </BodyShort>
            {deployment.commit_sha && <CopyButton copyText={deployment.commit_sha} size="small" title="Kopier SHA" />}
          </HStack>
        </VStack>

        {deployment.branch_name && (
          <VStack gap="space-4">
            <Detail>Branch</Detail>
            <BodyShort>
              <ExternalLink
                href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/tree/${encodeURIComponent(deployment.branch_name)}`}
                style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
              >
                {deployment.branch_name}
              </ExternalLink>
            </BodyShort>
          </VStack>
        )}

        {deployment.parent_commits && deployment.parent_commits.length > 1 && (
          <VStack gap="space-4">
            <Detail>Merge commit (parents)</Detail>
            <BodyShort>
              {deployment.parent_commits.map((parent, index) => (
                <span key={parent.sha}>
                  <ExternalLink
                    href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${parent.sha}`}
                    style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                  >
                    {parent.sha.substring(0, 7)}
                  </ExternalLink>
                  {index < (deployment.parent_commits?.length ?? 0) - 1 && ', '}
                </span>
              ))}
            </BodyShort>
          </VStack>
        )}

        {deployment.trigger_url && (
          <VStack gap="space-4">
            <Detail>GitHub Actions</Detail>
            <BodyShort>
              <ExternalLink href={deployment.trigger_url}>Se workflow run</ExternalLink>
            </BodyShort>
          </VStack>
        )}

        <VStack gap="space-4">
          <Detail>Nais Deployment ID</Detail>
          <HStack gap="space-8" align="center">
            <BodyShort>
              <code style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{deployment.nais_deployment_id}</code>
            </BodyShort>
            <CopyButton copyText={deployment.nais_deployment_id} size="small" title="Kopier deployment ID" />
          </HStack>
        </VStack>

        {/* PR-specific fields in same grid */}

        {deployment.github_pr_data && (
          <>
            <VStack gap="space-4">
              <Detail>PR Opprettet av</Detail>
              <BodyShort>
                <UserName
                  username={deployment.github_pr_data.creator?.username}
                  userMappings={userMappings}
                  link="github"
                />
              </BodyShort>
            </VStack>

            {deployment.github_pr_data.merger && (
              <VStack gap="space-4">
                <Detail>Merget av</Detail>
                <BodyShort>
                  <UserName
                    username={deployment.github_pr_data.merger.username}
                    userMappings={userMappings}
                    link="github"
                  />
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>PR Opprettet</Detail>
              <BodyShort>
                {new Date(deployment.github_pr_data.created_at).toLocaleString('no-NO', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </BodyShort>
            </VStack>

            {deployment.github_pr_data.merged_at && (
              <VStack gap="space-4">
                <Detail>Merget</Detail>
                <BodyShort>
                  {new Date(deployment.github_pr_data.merged_at).toLocaleString('no-NO', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>Base branch</Detail>
              <BodyShort>{deployment.github_pr_data.base_branch}</BodyShort>
            </VStack>

            {deployment.github_pr_data.head_branch && (
              <VStack gap="space-4">
                <Detail>Head branch</Detail>
                <BodyShort>{deployment.github_pr_data.head_branch}</BodyShort>
              </VStack>
            )}

            {deployment.github_pr_data.merge_commit_sha && (
              <VStack gap="space-4">
                <Detail>Merge commit</Detail>
                <BodyShort>
                  <ExternalLink
                    href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.github_pr_data.merge_commit_sha}`}
                  >
                    {deployment.github_pr_data.merge_commit_sha.substring(0, 7)}
                  </ExternalLink>
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>PR Status</Detail>
              <HStack gap="space-8" wrap>
                {deployment.github_pr_data.draft && (
                  <Tag data-color="warning" variant="outline" size="small">
                    Draft
                  </Tag>
                )}
                {deployment.github_pr_data.locked && (
                  <Tag data-color="neutral" variant="outline" size="small">
                    🔒 Låst
                  </Tag>
                )}
                {deployment.github_pr_data.auto_merge && (
                  <Tag data-color="info" variant="outline" size="small">
                    Auto-merge ({deployment.github_pr_data.auto_merge.merge_method})
                  </Tag>
                )}
                {deployment.github_pr_data.checks_passed === true && (
                  <Tag data-color="neutral" variant="outline" size="small">
                    <CheckmarkIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} /> Checks OK
                  </Tag>
                )}
                {deployment.github_pr_data.checks_passed === false && (
                  <Tag data-color="danger" variant="outline" size="small">
                    <XMarkIcon aria-hidden /> Checks failed
                  </Tag>
                )}
              </HStack>
            </VStack>

            {deployment.github_pr_data.assignees && deployment.github_pr_data.assignees.length > 0 && (
              <VStack gap="space-4">
                <Detail>Tildelt</Detail>
                <HStack gap="space-8" wrap>
                  {deployment.github_pr_data.assignees.map((a) => (
                    <Tag data-color="neutral" key={a.username} variant="outline" size="small">
                      <UserName username={a.username} userMappings={userMappings} link={false} />
                    </Tag>
                  ))}
                </HStack>
              </VStack>
            )}

            {deployment.github_pr_data.milestone && (
              <VStack gap="space-4">
                <Detail>Milestone</Detail>
                <Tag data-color="info" variant="outline" size="small">
                  {deployment.github_pr_data.milestone.title} ({deployment.github_pr_data.milestone.state})
                </Tag>
              </VStack>
            )}
          </>
        )}
      </HGrid>
    </>
  )
}
