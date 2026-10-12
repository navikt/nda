import { useActionData, useLoaderData } from 'react-router'
import { NaisHistoryRecoveryPage } from '~/components/NaisHistoryRecoveryPage'
import { getNaisHistoryRecoveryCandidates, resetNaisHistorySyncMarker } from '~/db/monitored-applications.server'
import { type ActionResult, fail, ok } from '~/lib/action-result'
import { requireAdmin } from '~/lib/auth.server'
import { getFormString } from '~/lib/form-validators'
import { logger } from '~/lib/logger.server'
import type { Route } from './+types/nais-history-recovery'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Gjenopprett Nais-historikk - Admin - NDA' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const search = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  const candidates = await getNaisHistoryRecoveryCandidates(search)
  return { candidates, search }
}

export async function action({ request }: Route.ActionArgs): Promise<ActionResult> {
  const admin = await requireAdmin(request)
  const formData = await request.formData()
  if (getFormString(formData, 'intent') !== 'reset_history_marker') {
    return fail('Ukjent handling.')
  }
  if (getFormString(formData, 'confirmed') !== 'yes') {
    return fail('Bekreft at applikasjonen skal hente hele Nais-historikken på nytt.')
  }

  const idValue = getFormString(formData, 'id')
  const id = idValue ? Number(idValue) : Number.NaN
  if (!Number.isSafeInteger(id) || id <= 0) {
    return fail('Ugyldig applikasjons-id.')
  }

  try {
    const result = await resetNaisHistorySyncMarker(id)
    if (result === 'sync_running') {
      return fail('Applikasjonen synkroniseres allerede. Vent til jobben er ferdig før du prøver igjen.')
    }
    if (result === 'already_pending') {
      return fail('Applikasjonen venter allerede på full historikksynk, eller historikken er allerede nullstilt.')
    }
    if (result === 'not_found') {
      return fail('Fant ikke en aktiv applikasjon med denne historikkmarkøren.')
    }

    logger.info('Admin requested a full Nais history replay', { monitoredAppId: id, adminNavIdent: admin.navIdent })
    return ok('Historikkmarkøren er nullstilt. Den periodiske synkroniseringen vil hente hele historikken på nytt.')
  } catch (error) {
    logger.error('Could not reset Nais history sync marker', {
      monitoredAppId: id,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    })
    return fail('Kunne ikke nullstille historikkmarkøren. Se applikasjonslogger for detaljer.')
  }
}

export default function NaisHistoryRecoveryRoute() {
  const { candidates, search } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  return <NaisHistoryRecoveryPage candidates={candidates} search={search} actionData={actionData} />
}
