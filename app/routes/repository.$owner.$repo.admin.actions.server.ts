import {
  getRepositoryById,
  isCurrentOrHistoricalNameForRepositoryId,
  updateRepositorySettingsByRepositoryId,
} from '~/db/repositories.server'
import { fail, ok } from '~/lib/action-result'
import { requireUser } from '~/lib/auth.server'
import { canAccessRepositoryAdmin } from '~/lib/authorization.server'
import { getFormString } from '~/lib/form-validators'
import { repoAffectedAppsMessage } from '~/lib/repo-scope-messages'
import { requireParams } from '~/lib/route-params.server'
import { isImplicitApprovalMode } from '~/lib/verification/types'
import type { Route } from './+types/repository.$owner.$repo.admin'

function updateFailureMessage(reason: 'app_not_found' | 'repo_not_found' | 'repo_not_linked' | 'unauthorized'): string {
  if (reason === 'repo_not_linked') {
    return 'Repositoryet er ikke lenger koblet til noen aktiv app'
  }
  if (reason === 'unauthorized') {
    return 'Du har ikke administratortilgang til alle appene i dette repoet'
  }
  return 'Fant ikke repositoryet'
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  const { owner, repo } = requireParams(params, ['owner', 'repo'])
  const formData = await request.formData()
  const action = getFormString(formData, 'action')

  const repositoryIdRaw = formData.get('repository_id')
  const submittedRepositoryId = typeof repositoryIdRaw === 'string' ? Number(repositoryIdRaw) : Number.NaN
  if (!Number.isInteger(submittedRepositoryId) || submittedRepositoryId <= 0 || submittedRepositoryId > 2_147_483_647) {
    return fail('Ugyldig eller manglende repository-ID')
  }

  const repository = await getRepositoryById(submittedRepositoryId)
  if (!repository) {
    return fail('Fant ikke repositoryet')
  }

  if (!(await isCurrentOrHistoricalNameForRepositoryId(repository.id, owner, repo))) {
    return fail('Repository-ID samsvarer ikke med repositoryet i URL-en')
  }
  const repositoryId = repository.id

  if (!(await canAccessRepositoryAdmin(user, repositoryId))) {
    return fail('Du har ikke administratortilgang til alle appene i dette repoet')
  }

  if (action === 'update_default_branch') {
    const defaultBranch = getFormString(formData, 'default_branch')
    if (!defaultBranch) {
      return fail('Default branch kan ikke være tom')
    }
    if (defaultBranch.length > 255) {
      return fail('Default branch kan ikke være lengre enn 255 tegn')
    }

    const result = await updateRepositorySettingsByRepositoryId({
      repositoryId,
      patch: { defaultBranch },
      changedByNavIdent: user.navIdent,
      changedByName: user.name || undefined,
      actor: user,
    })

    if (!result.ok) {
      return fail(updateFailureMessage(result.reason))
    }

    if (result.changedKeys.length === 0) {
      return ok('Ingen endring — default branch var allerede satt til denne verdien.')
    }

    return ok(`Default branch oppdatert!${repoAffectedAppsMessage(result.affectedApps, result.changedKeys)}`)
  }

  if (action === 'update_implicit_approval') {
    const modeValue = formData.get('mode')
    if (typeof modeValue !== 'string' || !isImplicitApprovalMode(modeValue)) {
      return fail('Ugyldig modus')
    }

    const result = await updateRepositorySettingsByRepositoryId({
      repositoryId,
      patch: { implicitApprovalMode: modeValue },
      changedByNavIdent: user.navIdent,
      changedByName: user.name || undefined,
      actor: user,
    })

    if (!result.ok) {
      return fail(updateFailureMessage(result.reason))
    }

    if (result.changedKeys.length === 0) {
      return ok('Ingen endring — modus var allerede satt til denne verdien.')
    }

    return ok(
      `Implisitt godkjenning-innstillinger oppdatert!${repoAffectedAppsMessage(result.affectedApps, result.changedKeys)}`,
    )
  }

  if (action === 'update_audit_start_year') {
    const startYearValue = getFormString(formData, 'audit_start_year')

    let auditStartYear: number | null = null
    if (startYearValue) {
      auditStartYear = Number(startYearValue)
      if (!Number.isInteger(auditStartYear) || auditStartYear < 2000 || auditStartYear > 2100) {
        return fail('Ugyldig startår. Må være mellom 2000 og 2100.')
      }
    }

    const repoResult = await updateRepositorySettingsByRepositoryId({
      repositoryId,
      patch: { auditStartYear },
      changedByNavIdent: user.navIdent,
      changedByName: user.name || undefined,
      actor: user,
    })

    if (!repoResult.ok) {
      return fail(updateFailureMessage(repoResult.reason))
    }

    if (repoResult.changedKeys.length === 0) {
      return ok('Ingen endring — startår var allerede satt til denne verdien.')
    }

    const result = repoResult.auditStartYearChange ?? {
      updatedAppIds: repoResult.affectedApps.map((app) => app.id),
      promotedDeploymentId: null,
      demotedDeploymentIds: [],
      recomputeLimitedToActingApp: false,
      recomputeSkippedDueToAmbiguousRepoScope: false,
    }

    let success = 'Startår for revisjon oppdatert!'
    success += repoAffectedAppsMessage(repoResult.affectedApps, repoResult.changedKeys)
    if (result.recomputeSkippedDueToAmbiguousRepoScope) {
      success +=
        ' Baseline ble ikke automatisk vurdert på nytt fordi appene har flere ulike aktive repoer registrert samtidig — dette bør rettes opp manuelt.'
    }
    if (result.promotedDeploymentId) {
      success += auditStartYear
        ? ' Første deployment i det nye startåret er nå foreslått som ny baseline.'
        : ' Første kvalifiserte deployment er nå foreslått som ny baseline.'
    }
    if (result.demotedDeploymentIds.length > 0) {
      success +=
        result.demotedDeploymentIds.length > 1
          ? ' De forrige baseline-markørene er ikke lenger gyldige og er derfor fjernet.'
          : ' Den forrige baseline-markøren er ikke lenger gyldig og er derfor fjernet.'
    }
    return ok(success)
  }

  return fail('Ukjent handling')
}
