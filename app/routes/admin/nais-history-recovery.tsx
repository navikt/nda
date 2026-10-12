import { useActionData, useLoaderData } from 'react-router'
import { NaisHistoryRecoveryPage } from '~/components/NaisHistoryRecoveryPage'
import {
  getCompletedNaisSyncsInWindow,
  getNaisHistoryRecoveryCandidates,
  resetNaisHistorySyncMarker,
} from '~/db/monitored-applications.server'
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
  const params = new URL(request.url).searchParams
  const search = params.get('q')?.trim() ?? ''
  const from = params.get('from')?.trim() ?? ''
  const to = params.get('to')?.trim() ?? ''
  const fromDate = parseWindowBound(from)
  const toDate = parseWindowBound(to)
  const windowError =
    (from || to) && (!fromDate || !toDate || fromDate >= toDate)
      ? 'Oppgi gyldig fra- og til-tidspunkt med tidssone (f.eks. 2026-01-14T10:00:00+01:00), der fra er før til.'
      : null
  const [candidates, windowSyncs] = await Promise.all([
    getNaisHistoryRecoveryCandidates(search),
    fromDate && toDate && !windowError ? getCompletedNaisSyncsInWindow(fromDate, toDate) : Promise.resolve(null),
  ])
  return { candidates, search, from, to, windowSyncs, windowError }
}

function parseWindowBound(value: string): Date | null {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
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
  const { candidates, search, from, to, windowSyncs, windowError } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  return (
    <NaisHistoryRecoveryPage
      candidates={candidates}
      search={search}
      from={from}
      to={to}
      windowSyncs={windowSyncs}
      windowError={windowError}
      actionData={actionData}
    />
  )
}
