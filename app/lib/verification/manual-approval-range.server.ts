import { findRepositoryForApp } from '~/db/application-repositories.server'
import { getEffectiveComparisonBaseSha } from '~/db/verification-diff.server'

export async function resolveReviewedComparisonRange(
  deployment: {
    id: number
    monitored_app_id: number
    commit_sha: string | null
    detected_github_owner: string | null
    detected_github_repo_name: string | null
  },
  formData: FormData,
): Promise<{ range: { baseSha: string | null; headSha: string } | null; error?: string }> {
  const headSha = formData.get('comparison_head_sha')
  const baseSha = formData.get('comparison_base_sha')
  if (headSha === null && baseSha === null) return { range: null }
  if (
    typeof headSha !== 'string' ||
    typeof baseSha !== 'string' ||
    headSha !== deployment.commit_sha ||
    !deployment.detected_github_owner ||
    !deployment.detected_github_repo_name
  ) {
    return { range: null, error: 'Ugyldig sammenligningsintervall. Last siden på nytt før du godkjenner.' }
  }
  const repository = await findRepositoryForApp(
    deployment.monitored_app_id,
    deployment.detected_github_owner,
    deployment.detected_github_repo_name,
  )
  if (!repository.repository?.github_repo_id) {
    return { range: null, error: 'Kunne ikke finne repository for godkjenningen.' }
  }
  const currentBase = await getEffectiveComparisonBaseSha(deployment.id, repository.repository.github_repo_id, headSha)
  if (currentBase !== (baseSha || null)) {
    return { range: null, error: 'Sammenligningsintervallet er endret. Last siden på nytt og gjennomgå endringene.' }
  }
  return { range: { baseSha: currentBase, headSha } }
}
