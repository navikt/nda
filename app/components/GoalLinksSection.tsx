import { LinkIcon, PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import { Link as AkselLink, BodyShort, Box, Button, Heading, HStack, Tag, TextField, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { Form } from 'react-router'
import type { DeploymentGoalLinkWithDetails } from '~/db/deployment-goal-links.server'

const LINK_METHOD_LABELS: Record<string, string> = {
  manual: 'Manuell',
  slack: 'Slack',
  commit_keyword: 'Commit-nøkkelord',
  pr_title: 'PR-tittel',
}

export function GoalLinksSection({ goalLinks }: { goalLinks: DeploymentGoalLinkWithDetails[] }) {
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

      {showAddLink && <AddGoalLinkForm onCancel={() => setShowAddLink(false)} />}
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
              <Tag variant="info" size="xsmall">
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

function AddGoalLinkForm({ onCancel }: { onCancel: () => void }) {
  return (
    <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <Form method="post" onSubmit={onCancel}>
        <input type="hidden" name="intent" value="link_goal" />
        <VStack gap="space-12">
          <Heading level="3" size="xsmall">
            Knytt til ekstern referanse
          </Heading>
          <HStack gap="space-12" wrap>
            <TextField label="URL" name="external_url" size="small" autoComplete="off" style={{ minWidth: '300px' }} />
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
    </Box>
  )
}
