import { Alert, Detail, Heading, HGrid, LinkCard, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'

export interface TeamCoverage {
  total: number
  with_four_eyes: number
  four_eyes_percentage: number
  with_origin: number
  origin_percentage: number
  non_member_deployments: number
}

interface TeamCoverageCardsProps {
  coverage: TeamCoverage
  hasMappedMembers: boolean
  unmappedMemberCount: number
  totalMembers: number
  deploymentsPath: string
}

export function TeamCoverageCards({
  coverage,
  hasMappedMembers,
  unmappedMemberCount,
  totalMembers,
  deploymentsPath,
}: TeamCoverageCardsProps) {
  if (totalMembers === 0 && coverage.total === 0) {
    return (
      <Alert variant="info">
        Ingen medlemmer er registrert for dette teamet enda. Statistikk på team-medlemmenes deploys vises når medlemmer
        er lagt til.
      </Alert>
    )
  }

  return (
    <VStack gap="space-8">
      {totalMembers === 0 && coverage.total > 0 && (
        <Alert variant="info" size="small">
          Ingen medlemmer er registrert — kun leveranser koblet til måltavlen vises.
        </Alert>
      )}
      {!hasMappedMembers && totalMembers > 0 && coverage.total > 0 && (
        <Alert variant="warning" size="small">
          Ingen av de {totalMembers} medlemmene har et GitHub-brukernavn registrert — kun leveranser koblet til
          måltavlen vises.
        </Alert>
      )}
      {!hasMappedMembers && totalMembers > 0 && coverage.total === 0 && (
        <Alert variant="warning">
          Ingen av de {totalMembers} medlemmene har et GitHub-brukernavn registrert. Statistikk vises når
          brukerkoblinger er på plass.
        </Alert>
      )}
      {hasMappedMembers && unmappedMemberCount > 0 && (
        <Alert variant="warning" size="small">
          {unmappedMemberCount} av {totalMembers} medlemmer mangler GitHub-brukernavn — statistikken kan være
          ufullstendig.
        </Alert>
      )}
      <HGrid gap="space-12" columns={{ xs: 1, sm: 2, md: 4 }}>
        <CoverageCard
          label="Leveranser i år"
          value={coverage.total.toString()}
          href={`${deploymentsPath}?period=year-to-date`}
        />
        <CoverageCard
          label="4-øyne-dekning"
          value={`${coverage.four_eyes_percentage}%`}
          sub={`${coverage.with_four_eyes} av ${coverage.total}`}
          href={`${deploymentsPath}?period=year-to-date&status=not_approved`}
        />
        <CoverageCard
          label="Endringsopphav"
          value={`${coverage.origin_percentage}%`}
          sub={`${coverage.with_origin} av ${coverage.total}`}
          href={`${deploymentsPath}?period=year-to-date&goal=missing`}
        />
        <CoverageCard
          label="Fra andre"
          value={coverage.non_member_deployments.toString()}
          sub="Koblet via måltavle"
          href={`${deploymentsPath}?period=year-to-date&deployer=__non_member__&goal=linked`}
        />
      </HGrid>
      <Detail textColor="subtle">
        {hasMappedMembers
          ? 'Inkluderer leveranser koblet til teamets måltavle og ukoblede leveranser fra teammedlemmer (år til dato).'
          : 'Viser leveranser koblet til teamets måltavle (år til dato).'}
      </Detail>
    </VStack>
  )
}

function CoverageCard({ label, value, sub, href }: { label: string; value: string; sub?: string; href: string }) {
  return (
    <LinkCard>
      <LinkCard.Title as="span">
        <LinkCard.Anchor asChild>
          <Link to={href}>{label}</Link>
        </LinkCard.Anchor>
      </LinkCard.Title>
      <LinkCard.Description>
        <VStack gap="space-4">
          <Heading level="3" size="medium" aria-label={`${label}: ${value}`}>
            {value}
          </Heading>
          {sub && <Detail textColor="subtle">{sub}</Detail>}
        </VStack>
      </LinkCard.Description>
    </LinkCard>
  )
}
