import { CogIcon } from '@navikt/aksel-icons'
import { Link as AkselLink, BodyShort, Heading, HStack, VStack } from '@navikt/ds-react'
import { Link, redirect, useLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { getRepoConfigAuditLog, getRepositoryById, getRepositoryByOwnerRepo } from '~/db/repositories.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
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
  const repositoryIdParam = url.searchParams.get('repositoryId')
  const requestedRepositoryId = repositoryIdParam !== null ? Number(repositoryIdParam) : null

  const repository = await (async () => {
    if (
      requestedRepositoryId !== null &&
      Number.isInteger(requestedRepositoryId) &&
      requestedRepositoryId > 0 &&
      requestedRepositoryId <= 2_147_483_647
    ) {
      const byId = await getRepositoryById(requestedRepositoryId)
      if (byId) {
        if (byId.github_owner !== owner || byId.github_repo_name !== repo) {
          const redirectPath = `/repository/${encodeURIComponent(byId.github_owner)}/${encodeURIComponent(byId.github_repo_name)}/admin?repositoryId=${byId.id}`
          throw redirect(redirectPath, { status: 301 })
        }
        return byId
      }
    }

    const lookup = await getRepositoryByOwnerRepo(owner, repo)

    if (lookup.status === 'redirect') {
      const redirectPath = `/repository/${encodeURIComponent(lookup.githubOwner)}/${encodeURIComponent(lookup.githubRepoName)}/admin${url.search}`
      throw redirect(redirectPath, { status: 301 })
    }

    if (lookup.status === 'not_found') {
      throw new Response('Repository not found', { status: 404 })
    }

    return lookup.repository
  })()

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

  const repoUrl = `/repository/${repository.github_owner}/${repository.github_repo_name}?repositoryId=${repository.id}`

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
          Disse innstillingene gjelder hele GitHub-repoet og alle apper som deployes fra det.{' '}
          <AkselLink as={Link} to={repoUrl}>
            Tilbake til repo-siden
          </AkselLink>
        </BodyShort>
      </div>

      <ActionAlert data={actionData} />

      {isLinked ? (
        <>
          <DefaultBranchSettings
            repositoryId={repository.id}
            defaultBranch={defaultBranch}
            affectedApps={affectedApps}
          />

          <AuditStartYearSettings
            repositoryId={repository.id}
            auditStartYear={auditStartYear}
            affectedApps={affectedApps}
          />

          <ImplicitApprovalSettings
            repositoryId={repository.id}
            implicitApprovalSettings={implicitApprovalSettings}
            affectedApps={affectedApps}
          />
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
