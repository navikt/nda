import { ChatIcon, TrashIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Button, Detail, Heading, HStack, VStack } from '@navikt/ds-react'
import type { RefObject } from 'react'
import { Form } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import { UserName } from '~/components/UserName'
import type { Route } from '../+types/$id'

type LoaderData = Route.ComponentProps['loaderData']

export type CommentsSectionProps = {
  comments: LoaderData['comments']
  capabilities: LoaderData['capabilities']
  userMappings: LoaderData['userMappings']
  commentDialogRef: RefObject<HTMLDialogElement | null>
}

export function CommentsSection({ comments, capabilities, userMappings, commentDialogRef }: CommentsSectionProps) {
  return (
    <>
      <VStack gap="space-16">
        <Heading size="medium" level="2">
          Kommentarer
        </Heading>

        {comments.length === 0 ? (
          <BodyShort textColor="subtle" style={{ fontStyle: 'italic' }}>
            Ingen kommentarer ennå.
          </BodyShort>
        ) : (
          <VStack gap="space-12">
            {comments.map((comment) => (
              <Box
                key={comment.id}
                padding="space-16"
                borderRadius="8"
                background="raised"
                borderColor="neutral-subtle"
                borderWidth="1"
              >
                <HStack justify="space-between" align="start">
                  <VStack gap="space-4">
                    <Detail textColor="subtle">
                      {new Date(comment.created_at).toLocaleString('no-NO', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                      {comment.registered_by && (
                        <>
                          {' — '}
                          <UserName username={comment.registered_by} userMappings={userMappings} />
                        </>
                      )}
                    </Detail>
                    <BodyShort>{comment.comment_text}</BodyShort>
                    {comment.slack_link && (
                      <BodyShort size="small">
                        <ExternalLink href={comment.slack_link}>🔗 Slack-lenke</ExternalLink>
                      </BodyShort>
                    )}
                  </VStack>
                  {capabilities.canDeviate && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete_comment" />
                      <input type="hidden" name="comment_id" value={comment.id} />
                      <Button type="submit" size="small" variant="tertiary" icon={<TrashIcon aria-hidden />}>
                        Slett
                      </Button>
                    </Form>
                  )}
                </HStack>
              </Box>
            ))}
          </VStack>
        )}
      </VStack>

      <Button variant="tertiary" icon={<ChatIcon aria-hidden />} onClick={() => commentDialogRef.current?.showModal()}>
        Legg til kommentar
      </Button>
    </>
  )
}
