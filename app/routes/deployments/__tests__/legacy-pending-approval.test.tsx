import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Approved } from '../../__stories__/DeploymentDetail.stories'
import { LegacyPendingApproval } from '../$id/LegacyPendingApproval'

describe('legacy comparison link', () => {
  it.each([
    { owner: 'navikt', repo: 'monorepo', visible: true },
    { owner: null, repo: 'monorepo', visible: false },
    { owner: 'navikt', repo: null, visible: false },
  ])('requires both repository fields: %j', ({ owner, repo, visible }) => {
    const data = Approved.args?.loaderData
    if (!data?.previousDeploymentForDiff) throw new Error('Expected deployment story fixture')
    const markup = renderToStaticMarkup(
      <LegacyPendingApproval
        legacyInfo={null}
        capabilities={{ ...data.capabilities, canApprove: false }}
        deployment={{ ...data.deployment, detected_github_owner: owner, detected_github_repo_name: repo }}
        previousDeploymentForDiff={data.previousDeploymentForDiff}
      />,
    )
    expect(markup.includes('Se endringer på GitHub')).toBe(visible)
    expect(markup).not.toContain('github.com/null')
    expect(markup).not.toContain('/null/compare')
  })
})
