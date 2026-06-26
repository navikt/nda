import {
  ChatIcon,
  CheckmarkCircleIcon,
  CheckmarkIcon,
  CircleIcon,
  ClockIcon,
  MinusCircleIcon,
  XMarkIcon,
  XMarkOctagonIcon,
} from '@navikt/aksel-icons'
import { Accordion, Alert, BodyShort, Box, Detail, HStack, Tag, VStack } from '@navikt/ds-react'
import { CheckAnnotations } from '~/components/CheckAnnotations'
import { CheckLogViewer } from '~/components/CheckLogViewer'
import { ExternalLink } from '~/components/ExternalLink'
import { UserName } from '~/components/UserName'
import { getUserDisplayName } from '~/lib/user-display'
import type { Route } from '../+types/$id'

type LoaderData = Route.ComponentProps['loaderData']
type Deployment = LoaderData['deployment']
type GithubPrData = NonNullable<Deployment['github_pr_data']>

export type PrDetailsAccordionProps = {
  deployment: Deployment
  githubPrData: GithubPrData
  userMappings: LoaderData['userMappings']
}

export function PrDetailsAccordion({ deployment, githubPrData, userMappings }: PrDetailsAccordionProps) {
  const getUserDisplay = (githubUsername: string | undefined | null) => getUserDisplayName(githubUsername, userMappings)

  return (
    <Accordion>
      {/* Reviewers - includes requested and completed reviews */}
      {((githubPrData.reviewers && githubPrData.reviewers.length > 0) ||
        (githubPrData.requested_reviewers && githubPrData.requested_reviewers.length > 0) ||
        (githubPrData.requested_teams && githubPrData.requested_teams.length > 0)) && (
        <Accordion.Item>
          <Accordion.Header>
            Reviewers (
            {(githubPrData.reviewers?.length || 0) +
              (githubPrData.requested_reviewers?.length || 0) +
              (githubPrData.requested_teams?.length || 0)}
            )
          </Accordion.Header>
          <Accordion.Content>
            <VStack gap="space-8">
              {/* Completed reviews */}
              {githubPrData.reviewers?.map((reviewer) => (
                <HStack key={`${reviewer.username}:${reviewer.submitted_at}`} gap="space-8" align="center">
                  {reviewer.state === 'APPROVED' && (
                    <CheckmarkIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} />
                  )}
                  {reviewer.state === 'CHANGES_REQUESTED' && (
                    <XMarkIcon aria-hidden style={{ color: 'var(--ax-text-danger)' }} />
                  )}
                  {reviewer.state === 'COMMENTED' && (
                    <ChatIcon aria-hidden style={{ color: 'var(--ax-text-neutral-subtle)' }} />
                  )}
                  <ExternalLink href={`https://github.com/${reviewer.username}`}>
                    <UserName username={reviewer.username} userMappings={userMappings} link={false} />
                  </ExternalLink>
                  <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                    {new Date(reviewer.submitted_at).toLocaleString('no-NO', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </HStack>
              ))}

              {/* Requested reviewers (pending) */}
              {githubPrData.requested_reviewers?.map((r) => (
                <HStack key={`pending:${r.username}`} gap="space-8" align="center">
                  <CircleIcon aria-hidden style={{ color: 'var(--ax-text-warning)' }} />
                  <ExternalLink href={`https://github.com/${r.username}`}>
                    <UserName username={r.username} userMappings={userMappings} link={false} />
                  </ExternalLink>
                </HStack>
              ))}

              {/* Requested teams (pending) */}
              {githubPrData.requested_teams?.map((t) => (
                <HStack key={`team:${t.slug}`} gap="space-8" align="center">
                  <CircleIcon aria-hidden style={{ color: 'var(--ax-text-warning)' }} />
                  <span>{t.name}</span>
                </HStack>
              ))}
            </VStack>
          </Accordion.Content>
        </Accordion.Item>
      )}

      {/* GitHub Checks */}
      {githubPrData.checks && githubPrData.checks.length > 0 && (
        <Accordion.Item>
          <Accordion.Header>GitHub Checks ({githubPrData.checks.length})</Accordion.Header>
          <Accordion.Content>
            <VStack gap="space-12">
              {githubPrData.checks_ref === 'head' && githubPrData.merged_at && (
                <Alert variant="info" size="small">
                  Sjekkene er hentet fra PR-branchen. Fra 20. juni 2026 hentes sjekker primært fra merge-commiten på
                  main når tilgjengelig. For eldre data vises sjekker fra PR-branchen.
                </Alert>
              )}
              {githubPrData.checks.map((check) => {
                const isSuccess = check.conclusion === 'success'
                const isFailure =
                  check.conclusion === 'failure' ||
                  check.conclusion === 'timed_out' ||
                  check.conclusion === 'action_required'
                const isSkipped =
                  check.conclusion === 'skipped' || check.conclusion === 'neutral' || check.conclusion === 'cancelled'
                const isInProgress = check.status === 'in_progress' || check.status === 'queued'

                const duration =
                  check.started_at && check.completed_at
                    ? Math.round((new Date(check.completed_at).getTime() - new Date(check.started_at).getTime()) / 1000)
                    : null
                const durationStr =
                  duration !== null
                    ? duration >= 60
                      ? `${Math.floor(duration / 60)}m ${duration % 60}s`
                      : `${duration}s`
                    : null

                return (
                  <VStack key={check.html_url ?? check.name} gap="space-4">
                    <HStack gap="space-8" align="center" wrap>
                      {isSuccess && <CheckmarkCircleIcon style={{ color: 'var(--ax-text-success)' }} />}
                      {isFailure && <XMarkOctagonIcon style={{ color: 'var(--ax-text-danger)' }} />}
                      {isSkipped && <MinusCircleIcon style={{ color: 'var(--ax-text-neutral-subtle)' }} />}
                      {isInProgress && <ClockIcon style={{ color: 'var(--ax-text-warning)' }} />}

                      {check.html_url ? (
                        <ExternalLink href={check.html_url}>{check.name}</ExternalLink>
                      ) : (
                        <span>{check.name}</span>
                      )}

                      <Tag
                        variant={isSuccess ? 'success' : isFailure ? 'error' : isSkipped ? 'neutral' : 'warning'}
                        size="small"
                      >
                        {check.conclusion || check.status}
                      </Tag>

                      {check.app?.name && <Detail textColor="subtle">{check.app.name}</Detail>}

                      {durationStr && <Detail textColor="subtle">{durationStr}</Detail>}

                      {check.output?.annotations_count != null && check.output.annotations_count > 0 && (
                        <Tag variant="warning" size="small">
                          {check.output.annotations_count} annotation
                          {check.output.annotations_count !== 1 ? 's' : ''}
                        </Tag>
                      )}

                      {check.details_url && check.details_url !== check.html_url && (
                        <ExternalLink href={check.details_url}>
                          <Detail textColor="subtle">detaljer</Detail>
                        </ExternalLink>
                      )}

                      {check.log_cached && (
                        <Tag variant="info" size="small">
                          Logg lagret
                        </Tag>
                      )}
                    </HStack>

                    {check.output?.title && (
                      <Detail textColor="subtle" style={{ paddingLeft: 'var(--ax-space-24)' }}>
                        {check.output.title}
                      </Detail>
                    )}

                    {check.output?.summary && isFailure && (
                      <Box
                        paddingInline="space-24"
                        paddingBlock="space-4"
                        style={{ maxHeight: '200px', overflow: 'auto' }}
                      >
                        <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                          {check.output.summary}
                        </pre>
                      </Box>
                    )}

                    {check.id && (
                      <CheckLogViewer
                        owner={deployment.detected_github_owner}
                        repo={deployment.detected_github_repo_name}
                        jobId={check.id}
                        appSlug={check.app?.slug ?? null}
                        conclusion={check.conclusion}
                      />
                    )}

                    {check.output?.annotations_count != null && check.output.annotations_count > 0 && check.id && (
                      <CheckAnnotations
                        owner={deployment.detected_github_owner}
                        repo={deployment.detected_github_repo_name}
                        checkRunId={check.id}
                        storedAnnotations={check.annotations ?? null}
                      />
                    )}
                  </VStack>
                )
              })}
            </VStack>
          </Accordion.Content>
        </Accordion.Item>
      )}

      {/* PR Commits */}
      {githubPrData.commits && githubPrData.commits.length > 0 && (
        <Accordion.Item>
          <Accordion.Header>Commits ({githubPrData.commits.length})</Accordion.Header>
          <Accordion.Content>
            <VStack gap="space-12">
              {githubPrData.commits.map((commit) => (
                <HStack key={commit.sha} gap="space-12" align="start">
                  {commit.author?.avatar_url && (
                    <img
                      src={commit.author.avatar_url}
                      alt={getUserDisplay(commit.author.username) ?? ''}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <VStack gap="space-4">
                    <HStack gap="space-8" align="baseline" wrap>
                      <ExternalLink href={commit.html_url} style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                        {commit.sha.substring(0, 7)}
                      </ExternalLink>
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                        <UserName username={commit.author?.username} userMappings={userMappings} />
                      </span>
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                        {new Date(commit.date).toLocaleString('no-NO', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </HStack>
                    <BodyShort>{commit.message.split('\n')[0]}</BodyShort>
                  </VStack>
                </HStack>
              ))}
            </VStack>
          </Accordion.Content>
        </Accordion.Item>
      )}

      {/* GitHub Comments */}
      {githubPrData.comments && githubPrData.comments.length > 0 && (
        <Accordion.Item>
          <Accordion.Header>Kommentarer ({githubPrData.comments.length})</Accordion.Header>
          <Accordion.Content>
            <VStack gap="space-12">
              {githubPrData.comments.map((comment) => (
                <HStack key={comment.id} gap="space-12" align="start">
                  {comment.user?.avatar_url && (
                    <img
                      src={comment.user.avatar_url}
                      alt={getUserDisplay(comment.user?.username) ?? ''}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <VStack gap="space-4" style={{ flex: 1 }}>
                    <HStack gap="space-8" align="baseline" wrap>
                      {comment.user?.username ? (
                        <ExternalLink href={`https://github.com/${comment.user.username}`}>
                          <UserName username={comment.user.username} userMappings={userMappings} link={false} />
                        </ExternalLink>
                      ) : (
                        <span>ukjent</span>
                      )}
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                        {new Date(comment.created_at).toLocaleString('no-NO', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                      <ExternalLink href={comment.html_url} style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                        vis på GitHub
                      </ExternalLink>
                    </HStack>
                    <BodyShort style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</BodyShort>
                  </VStack>
                </HStack>
              ))}
            </VStack>
          </Accordion.Content>
        </Accordion.Item>
      )}
    </Accordion>
  )
}
