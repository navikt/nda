import { LinkIcon, PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Button, Detail, Heading, HStack, Tabs, Tag, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { Form, Link } from 'react-router'
import { UserName } from '~/components/UserName'
import type { DeploymentGoalLinkWithDetails } from '~/db/deployment-goal-links.server'
import type { UserLookupMap } from '~/lib/user-display'
import { ExternalLink } from './ExternalLink'
import { type GoalSelectionBoard, GoalSelectionFields } from './GoalSelectionFields'

const LINK_METHOD_LABELS: Record<string, string> = {
  manual: 'Manuell',
  slack: 'Slack',
  commit_keyword: 'Commit-nøkkelord',
  pr_title: 'PR-tittel',
  dependabot_auto: 'Dependabot (auto)',
}

export type AvailableBoard = GoalSelectionBoard

interface GoalLinksSectionProps {
  goalLinks: DeploymentGoalLinkWithDetails[]
  availableBoards?: AvailableBoard[]
  sectionBoards?: AvailableBoard[]
  canLinkGoal?: boolean
  userMappings?: UserLookupMap
}

export function GoalLinksSection({
  goalLinks,
  availableBoards = [],
  sectionBoards = [],
  canLinkGoal = false,
  userMappings = {},
}: GoalLinksSectionProps) {
  const [showAddLink, setShowAddLink] = useState(false)

  return (
    <VStack gap="space-16">
      <HStack justify="space-between" align="center">
        <Heading size="medium" level="2">
          Endringsopphav
        </Heading>
        {canLinkGoal && (
          <Button
            variant="tertiary"
            size="small"
            icon={<PlusIcon aria-hidden />}
            onClick={() => setShowAddLink(!showAddLink)}
          >
            Knytt til mål
          </Button>
        )}
      </HStack>

      {goalLinks.length === 0 && !showAddLink && (
        <BodyShort textColor="subtle" style={{ fontStyle: 'italic' }}>
          Ingen kobling til mål.
        </BodyShort>
      )}

      {goalLinks.length > 0 && (
        <VStack gap="space-8">
          {goalLinks.map((link) => (
            <GoalLinkItem key={link.id} link={link} canUnlink={canLinkGoal} userMappings={userMappings} />
          ))}
        </VStack>
      )}

      {showAddLink && canLinkGoal && (
        <AddGoalLinkForm
          onCancel={() => setShowAddLink(false)}
          availableBoards={availableBoards}
          sectionBoards={sectionBoards}
        />
      )}
    </VStack>
  )
}

function GoalLinkItem({
  link,
  canUnlink,
  userMappings,
}: {
  link: DeploymentGoalLinkWithDetails
  canUnlink: boolean
  userMappings: UserLookupMap
}) {
  const label = link.key_result_title
    ? `${link.objective_title} → ${link.key_result_title}`
    : link.objective_title
      ? link.objective_title
      : (link.external_url_title ?? link.external_url ?? '(ukjent)')

  const isGoalInactive = link.objective_is_active === false || link.key_result_is_active === false
  const isLinkRemoved = link.is_active === false
  const isInactive = isGoalInactive || isLinkRemoved
  const isExternalOnly = link.objective_id == null && link.key_result_id == null

  const dashboardUrl =
    link.section_slug && link.dev_team_slug && link.board_period_label && link.board_period_type
      ? `/sections/${link.section_slug}/teams/${link.dev_team_slug}/dashboard?periodType=${link.board_period_type}&period=${encodeURIComponent(link.board_period_label)}`
      : null

  return (
    <Box padding="space-12" borderRadius="8" background="sunken">
      <HStack justify="space-between" align="center">
        <HStack gap="space-8" align="center" wrap>
          <LinkIcon aria-hidden />
          <div>
            {link.external_url && !link.objective_title ? (
              <ExternalLink href={link.external_url}>{label}</ExternalLink>
            ) : dashboardUrl ? (
              <Link to={dashboardUrl} style={{ textDecoration: 'none' }}>
                <BodyShort weight="semibold" as="span" style={{ color: 'var(--ax-text-accent)' }}>
                  {label}
                </BodyShort>
              </Link>
            ) : (
              <BodyShort weight="semibold">{label}</BodyShort>
            )}
            {link.external_url && link.objective_title && (
              <ExternalLink href={link.external_url}>{link.external_url_title || link.external_url}</ExternalLink>
            )}
            {link.comment && (
              <BodyShort size="small" textColor="subtle">
                {link.comment}
              </BodyShort>
            )}
            <HStack gap="space-4">
              {link.board_period_label && (
                <Tag variant="neutral" size="xsmall">
                  {link.board_period_label}
                </Tag>
              )}
              <Tag variant={link.link_method === 'commit_keyword' ? 'alt3' : 'info'} size="xsmall">
                {LINK_METHOD_LABELS[link.link_method] ?? link.link_method}
              </Tag>
              {isExternalOnly && (
                <Tag variant="warning" size="xsmall">
                  Kun ekstern lenke
                </Tag>
              )}
              {isLinkRemoved && (
                <Tag variant="neutral" size="xsmall">
                  Fjernet
                </Tag>
              )}
              {isGoalInactive && !isLinkRemoved && (
                <Tag variant="warning" size="xsmall">
                  Deaktivert
                </Tag>
              )}
            </HStack>
            {link.linked_by && link.link_method === 'manual' && (
              <Detail textColor="subtle">
                Registrert av <UserName username={link.linked_by} userMappings={userMappings} />
              </Detail>
            )}
          </div>
        </HStack>
        {canUnlink && (
          <Form method="post" style={{ display: 'inline' }}>
            <input type="hidden" name="intent" value="unlink_goal" />
            <input type="hidden" name="link_id" value={link.id} />
            <Button
              variant="tertiary-neutral"
              size="xsmall"
              icon={<TrashIcon aria-hidden />}
              type="submit"
              disabled={isInactive}
            />
          </Form>
        )}
      </HStack>
    </Box>
  )
}

function AddGoalLinkForm({
  onCancel,
  availableBoards,
  sectionBoards,
}: {
  onCancel: () => void
  availableBoards: AvailableBoard[]
  sectionBoards: AvailableBoard[]
}) {
  const [hasObjective, setHasObjective] = useState(false)

  const hasBoards = availableBoards.length > 0
  const hasSectionBoards = sectionBoards.length > 0

  const goalForm = (boards: AvailableBoard[]) => (
    <Form method="post" onSubmit={onCancel}>
      <input type="hidden" name="intent" value="link_goal" />
      <VStack gap="space-12" paddingBlock="space-16 space-0">
        <GoalSelectionFields boards={boards} onObjectiveChange={(id) => setHasObjective(!!id)} />

        <HStack gap="space-8" justify="end">
          <Button variant="tertiary" size="small" onClick={onCancel}>
            Avbryt
          </Button>
          <Button type="submit" size="small" disabled={!hasObjective}>
            Legg til
          </Button>
        </HStack>
      </VStack>
    </Form>
  )

  if (!hasBoards && !hasSectionBoards) {
    return (
      <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <BodyShort textColor="subtle">Ingen tilgjengelige måltavler å koble til.</BodyShort>
      </Box>
    )
  }

  if (hasBoards && !hasSectionBoards) {
    return (
      <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        {goalForm(availableBoards)}
      </Box>
    )
  }

  return (
    <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <Tabs defaultValue={hasBoards ? 'goal' : 'section'} size="small">
        <Tabs.List>
          {hasBoards && <Tabs.Tab value="goal" label="Mål / nøkkelresultat" />}
          {hasSectionBoards && <Tabs.Tab value="section" label="Andre team i seksjonen" />}
        </Tabs.List>

        {hasBoards && <Tabs.Panel value="goal">{goalForm(availableBoards)}</Tabs.Panel>}

        {hasSectionBoards && <Tabs.Panel value="section">{goalForm(sectionBoards)}</Tabs.Panel>}
      </Tabs>
    </Box>
  )
}
