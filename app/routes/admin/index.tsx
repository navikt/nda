import {
  ArrowsCirclepathIcon,
  Buildings3Icon,
  ChatIcon,
  CheckmarkCircleIcon,
  CogIcon,
  ExclamationmarkTriangleIcon,
  FileTextIcon,
  LaptopIcon,
  LayersIcon,
  PersonGroupIcon,
} from '@navikt/aksel-icons'
import { BodyShort, Box, Heading, HGrid, VStack } from '@navikt/ds-react'
import { Link, useLoaderData } from 'react-router'
import { pool } from '~/db/connection.server'
import { getAllDeployments } from '~/db/deployments.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/index'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Admin - Deployment Audit' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const allDeployments = await getAllDeployments()
  const pendingCount = allDeployments.filter(
    (d) => d.four_eyes_status === 'pending' || d.four_eyes_status === 'error',
  ).length

  // Count verification diffs across all apps
  const diffResult = await pool.query('SELECT COUNT(*) as count FROM verification_diffs')
  const diffCount = parseInt(diffResult.rows[0].count, 10)

  return { pendingCount, diffCount }
}

export default function AdminIndex() {
  const { pendingCount, diffCount } = useLoaderData<typeof loader>()
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
      </HGrid>
    </VStack>
  )
}
