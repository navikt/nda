import {
  ArrowsCirclepathIcon,
  ArrowUndoIcon,
  Buildings3Icon,
  CheckmarkCircleIcon,
  CogIcon,
  DownloadIcon,
  ExclamationmarkTriangleIcon,
  FileTextIcon,
  LaptopIcon,
  LayersIcon,
  LineGraphIcon,
  MagnifyingGlassIcon,
  PersonGroupIcon,
  PersonIcon,
} from '@navikt/aksel-icons'
import { BodyShort, Box, Heading, HGrid, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'

export interface AdminPageProps {
  pendingCount: number
  diffCount: number
  softDeletedCount: number
  titleMismatchCount: number
  baselineNoApproverCount: number
}

export function AdminPage({
  pendingCount,
  diffCount,
  softDeletedCount,
  titleMismatchCount,
  baselineNoApproverCount,
}: AdminPageProps) {
  const dataQualityCount = titleMismatchCount + baselineNoApproverCount

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Administrasjon
        </Heading>
        <BodyShort textColor="subtle">Administrer brukere, synkronisering og systeminnstillinger.</BodyShort>
      </div>

      <HGrid gap="space-16" columns={{ xs: 1, md: 2, lg: 3 }}>
        <Link to="/deployments/verify" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor={pendingCount > 0 ? 'warning-subtle' : 'neutral-subtle'}
            borderWidth="1"
            data-color={pendingCount > 0 ? 'warning' : undefined}
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <CheckmarkCircleIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  GitHub-verifisering
                </Heading>
                <BodyShort textColor="subtle">
                  {pendingCount > 0
                    ? `${pendingCount} deployments venter på verifisering.`
                    : 'Verifiser deployments mot GitHub.'}
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/audit-reports" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <FileTextIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Leveranserapport
                </Heading>
                <BodyShort textColor="subtle">
                  Generer leveranserapport for revisjon som dokumenterer four-eyes-prinsippet.
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/users" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <PersonGroupIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Brukermappinger
                </Heading>
                <BodyShort textColor="subtle">
                  Koble GitHub-brukernavn til NAV-identiteter for bedre sporbarhet.
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/sync-jobs" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <ArrowsCirclepathIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Sync Jobs
                </Heading>
                <BodyShort textColor="subtle">
                  Overvåk synkroniseringsjobber og distribuert låsing mellom podder.
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/global-settings" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <CogIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Globale innstillinger
                </Heading>
                <BodyShort textColor="subtle">Konfigurer globale innstillinger som avvikskanal i Slack.</BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/env" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <LaptopIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Miljøvariabler
                </Heading>
                <BodyShort textColor="subtle">Se alle miljøvariabler tilgjengelig for appen.</BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/application-groups" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <LayersIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Applikasjonsgrupper
                </Heading>
                <BodyShort textColor="subtle">
                  Grupper applikasjoner på tvers av NAIS-clustre for felles verifikasjon.
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/monorepos" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <LayersIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Monorepoer
                </Heading>
                <BodyShort textColor="subtle">
                  Se automatisk oppdagede monorepoer der flere apper deler samme git-repo.
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/workflow-triggers" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <DownloadIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Workflow-triggere
                </Heading>
                <BodyShort textColor="subtle">
                  Hent manglende eller utdatert trigger-informasjon (hvordan deployments ble startet) for alle
                  applikasjoner.
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/workflow-patterns" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <LineGraphIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Workflow-mønstre
                </Heading>
                <BodyShort textColor="subtle">
                  Analyser hvordan team og applikasjoner starter deployments, på tvers av alle apper.
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/verification-diffs" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor={diffCount > 0 ? 'warning-subtle' : 'neutral-subtle'}
            borderWidth="1"
            data-color={diffCount > 0 ? 'warning' : undefined}
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <ExclamationmarkTriangleIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Verifiseringsavvik
                </Heading>
                <BodyShort textColor="subtle">
                  {diffCount > 0
                    ? `${diffCount} avvik funnet på tvers av applikasjoner.`
                    : 'Sjekk verifiseringsavvik på tvers av alle applikasjoner.'}
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/data-mismatches" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor={dataQualityCount > 0 ? 'danger-subtle' : 'neutral-subtle'}
            borderWidth="1"
            data-color={dataQualityCount > 0 ? 'danger' : undefined}
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <MagnifyingGlassIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Datakvalitet
                </Heading>
                <BodyShort textColor="subtle">
                  {dataQualityCount > 0
                    ? `${dataQualityCount} datakvalitetsproblemer funnet. Sjekk siden.`
                    : 'Tittel-avvik, baseline uten godkjenner og andre datakvalitetsproblemer.'}
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/soft-deleted" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor={softDeletedCount > 0 ? 'warning-subtle' : 'neutral-subtle'}
            borderWidth="1"
            data-color={softDeletedCount > 0 ? 'warning' : undefined}
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <ArrowUndoIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Slettede rader
                </Heading>
                <BodyShort textColor="subtle">
                  {softDeletedCount > 0
                    ? `${softDeletedCount} logisk slettede rader. Se hvem som slettet og gjenopprett ved behov.`
                    : 'Se og gjenopprett logisk slettede rader.'}
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/sections" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <Buildings3Icon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Seksjoner
                </Heading>
                <BodyShort textColor="subtle">Administrer seksjoner, team-tilknytninger og Entra ID-grupper.</BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/section-roles" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <PersonIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Seksjonsroller
                </Heading>
                <BodyShort textColor="subtle">
                  Tildel og administrer roller på seksjonsnivå (Teknologileder, Seksjonsleder, Leveranseleder).
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/validate-monitored-apps" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <ExclamationmarkTriangleIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Valider apper mot Nais
                </Heading>
                <BodyShort textColor="subtle">
                  Finn rader der team/app er byttet om eller miljøet er feil, og rett dem opp.
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>
      </HGrid>
    </VStack>
  )
}
