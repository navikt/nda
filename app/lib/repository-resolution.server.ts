import { redirect } from 'react-router'
import {
  getRepositoryById,
  getRepositoryByOwnerRepo,
  isCurrentOrHistoricalNameForRepositoryId,
  type Repository,
} from '~/db/repositories.server'

export async function resolveRepositoryFromParams(
  owner: string,
  repo: string,
  url: URL,
  pathSuffix: string,
): Promise<Repository> {
  const repositoryIdParam = url.searchParams.get('repositoryId')
  const requestedRepositoryId = repositoryIdParam !== null ? Number(repositoryIdParam) : null

  if (
    requestedRepositoryId !== null &&
    Number.isInteger(requestedRepositoryId) &&
    requestedRepositoryId > 0 &&
    requestedRepositoryId <= 2_147_483_647
  ) {
    const byId = await getRepositoryById(requestedRepositoryId)
    if (byId && (await isCurrentOrHistoricalNameForRepositoryId(byId.id, owner, repo))) {
      if (byId.github_owner !== owner || byId.github_repo_name !== repo) {
        const redirectParams = new URLSearchParams(url.search)
        redirectParams.set('repositoryId', String(byId.id))
        const redirectPath = `/repository/${encodeURIComponent(byId.github_owner)}/${encodeURIComponent(byId.github_repo_name)}${pathSuffix}?${redirectParams}`
        throw redirect(redirectPath, { status: 301 })
      }
      return byId
    }
  }

  const lookup = await getRepositoryByOwnerRepo(owner, repo)

  if (lookup.status === 'redirect') {
    const redirectPath = `/repository/${encodeURIComponent(lookup.githubOwner)}/${encodeURIComponent(lookup.githubRepoName)}${pathSuffix}${url.search}`
    throw redirect(redirectPath, { status: 301 })
  }

  if (lookup.status === 'not_found') {
    throw new Response('Repository not found', { status: 404 })
  }

  return lookup.repository
}
