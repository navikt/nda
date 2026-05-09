import {
  ArrowsCirclepathIcon,
  ArrowUndoIcon,
  Buildings3Icon,
  ChatIcon,
  CheckmarkCircleIcon,
  CogIcon,
  ExclamationmarkTriangleIcon,
  FileTextIcon,
  LaptopIcon,
  LayersIcon,
  MagnifyingGlassIcon,
  PersonGroupIcon,
  PersonIcon,
  PlusCircleIcon,
} from '@navikt/aksel-icons'
import { BodyShort, Box, Heading, HGrid, VStack } from '@navikt/ds-react'
import { Link, useLoaderData } from 'react-router'
import { pool } from '~/db/connection.server'
import { getAllDeployments } from '~/db/deployments.server'
import { requireAdmin } from '~/lib/auth.server'
import { isPendingStatus } from '~/lib/four-eyes-status'
import type { Route } from './+types/index'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Admin - NDA' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const allDeployments = await getAllDeployments()
  const pendingCount = allDeployments.filter(
    (d) => isPendingStatus(d.four_eyes_status ?? '') || d.four_eyes_status === 'error',
  ).length

  // Count verification diffs across all apps
  const diffResult = await pool.query('SELECT COUNT(*) as count FROM verification_diffs')
  const diffCount = parseInt(diffResult.rows[0].count, 10)

  // Count soft-deleted rows across the audit-relevant tables
  const softDeletedResult = await pool.query<{ total: string }>(`
    SELECT (
      (SELECT COUNT(*) FROM user_mappings WHERE deleted_at IS NOT NULL) +
      (SELECT COUNT(*) FROM deployment_comments WHERE deleted_at IS NOT NULL AND comment_type NOT IN ('manual_approval', 'legacy_info')) +
      (SELECT COUNT(*) FROM dev_team_applications WHERE deleted_at IS NOT NULL) +
      (SELECT COUNT(*) FROM section_teams WHERE deleted_at IS NOT NULL) +
      (SELECT COUNT(*) FROM dev_team_nais_teams WHERE deleted_at IS NOT NULL) +
      (SELECT COUNT(*) FROM external_references WHERE deleted_at IS NOT NULL)
    )::text AS total
  `)
  const softDeletedCount = parseInt(softDeletedResult.rows[0].total, 10)

  // Count title mismatches
  const titleMismatchResult = await pool.query<{ count: string }>(`
    SELECT COUNT(*)::text AS count
    FROM deployments
    WHERE github_pr_data IS NOT NULL
      AND github_pr_data->>'title' IS NOT NULL
      AND github_pr_data->>'title' != ''
      AND title IS NOT NULL
      AND title != github_pr_data->>'title'
  `)
  const titleMismatchCount = parseInt(titleMismatchResult.rows[0].count, 10)

  return { pendingCount, diffCount, softDeletedCount, titleMismatchCount }
}

export default function AdminIndex() {
  const { pendingCount, diffCount, softDeletedCount, titleMismatchCount } = useLoaderData<typeof loader>()
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

        <Link to="/admin/slack" style={{ textDecoration: 'none', height: '100%' }}>
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
              <ChatIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Slack-integrasjon
                </Heading>
                <BodyShort textColor="subtle">Konfigurer Slack-varsler og test integrasjonen.</BodyShort>
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

        <Link to="/admin/title-mismatches" style={{ textDecoration: 'none', height: '100%' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor={titleMismatchCount > 0 ? 'danger-subtle' : 'neutral-subtle'}
            borderWidth="1"
            data-color={titleMismatchCount > 0 ? 'danger' : undefined}
            className="admin-card"
            style={{ height: '100%' }}
          >
            <VStack gap="space-12">
              <MagnifyingGlassIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Tittel-avvik
                </Heading>
                <BodyShort textColor="subtle">
                  {titleMismatchCount > 0
                    ? `${titleMismatchCount} deployments har feil tittel (avviker fra PR-tittel).`
                    : 'Sjekk at lagrede titler samsvarer med PR-titler.'}
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

        <Link to="/apps/add" style={{ textDecoration: 'none', height: '100%' }}>
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
              <PlusCircleIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading level="2" size="small" spacing>
                  Legg til applikasjon
                </Heading>
                <BodyShort textColor="subtle">Legg til nye applikasjoner for overvåking av leveranser.</BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>
      </HGrid>
    </VStack>
  )
}
