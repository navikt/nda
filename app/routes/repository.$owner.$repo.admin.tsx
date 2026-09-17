import { CogIcon } from '@navikt/aksel-icons'
import { BodyShort, Heading, HStack, VStack } from '@navikt/ds-react'
import { useLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { getRepoConfigAuditLog } from '~/db/repositories.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import type { Route } from './+types/repository.$owner.$repo.admin'
import { AuditStartYearSettings } from './repository.$owner.$repo.admin/AuditStartYearSettings'
import { DefaultBranchSettings } from './repository.$owner.$repo.admin/DefaultBranchSettings'
import { ImplicitApprovalSettings } from './repository.$owner.$repo.admin/ImplicitApprovalSettings'
import { RecentConfigChanges } from './repository.$owner.$repo.admin/RecentConfigChanges'

export { action } from './repository.$owner.$repo.admin.actions.server'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data ? `Admin - ${data.repository.github_owner}/${data.repository.github_repo_name}` : 'Admin' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { owner, repo } = requireParams(params, ['owner', 'repo'])
  const user = await requireUser(request)
  const url = new URL(request.url)
  const repository = await resolveRepositoryFromParams(owner, repo, url, '/admin')

  const { authorized, affectedApps } = await resolveRepositoryAdminAccess(user, repository.id)
  if (!authorized) {
    throw new Response('Forbidden - admin access required', { status: 403 })
  }

  const recentConfigChanges = await getRepoConfigAuditLog(repository.id, { limit: 10 })
  const isLinked = affectedApps.length > 0

  return {
    repository: {
      id: repository.id,
      github_owner: repository.github_owner,
      github_repo_name: repository.github_repo_name,
    },
    affectedApps,
    isLinked,
    auditStartYear: repository.audit_start_year,
    implicitApprovalSettings: { mode: repository.implicit_approval_mode },
    defaultBranch: repository.default_branch,
    recentConfigChanges,
  }
}

export default function RepositoryAdminRoute({ actionData }: Route.ComponentProps) {
  const {
    repository,
    affectedApps,
    isLinked,
    auditStartYear,
    implicitApprovalSettings,
    defaultBranch,
    recentConfigChanges,
  } = useLoaderData<typeof loader>()

  return (
    <VStack gap="space-32">
      <div>
        <HStack gap="space-12" align="center">
          <CogIcon aria-hidden fontSize="1.5rem" />
          <Heading size="large" level="1">
            Administrasjon for {repository.github_owner}/{repository.github_repo_name}
          </Heading>
        </HStack>
        <BodyShort textColor="subtle">
          Disse innstillingene gjelder hele GitHub-repoet og{' '}
          {isLinked
            ? `alle ${affectedApps.length} ${affectedApps.length === 1 ? 'app' : 'apper'} som deployes fra det.`
            : 'alle apper som deployes fra det.'}
        </BodyShort>
      </div>

      <ActionAlert data={actionData} />

      {isLinked ? (
        <>
          <DefaultBranchSettings repositoryId={repository.id} defaultBranch={defaultBranch} />

          <AuditStartYearSettings repositoryId={repository.id} auditStartYear={auditStartYear} />

          <ImplicitApprovalSettings repositoryId={repository.id} implicitApprovalSettings={implicitApprovalSettings} />
        </>
      ) : (
        <BodyShort textColor="subtle">
          Dette repositoryet er ikke lenger koblet til noen aktiv app, så innstillingene kan ikke endres her.
        </BodyShort>
      )}

      {recentConfigChanges.length > 0 && <RecentConfigChanges recentConfigChanges={recentConfigChanges} />}
    </VStack>
  )
}
