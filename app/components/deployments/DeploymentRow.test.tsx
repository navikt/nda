import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { DeploymentRow } from './DeploymentRow'

describe('DeploymentRow repository links', () => {
  it.each([false, true])('uses resolved coordinates only in repository view=%s', (repositoryView) => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DeploymentRow
          deployment={{
            id: 1,
            created_at: '2024-01-01T00:00:00Z',
            title: null,
            deployer_username: null,
            commit_sha: 'a'.repeat(40),
            detected_github_owner: 'navikt',
            detected_github_repo_name: 'reused-name',
            github_pr_number: 42,
            github_pr_url: 'https://github.com/navikt/reused-name/pull/42',
            github_pr_data: null,
            workflow_trigger_config: null,
            four_eyes_status: 'unverified_commits',
            team_slug: 'team-fjord',
            environment_name: 'prod-gcp',
            app_name: 'glad-fjord-api',
          }}
          userMappings={{}}
          repositorySummary={
            repositoryView
              ? {
                  status: 'missing_link',
                  range: null,
                  repository: { githubOwner: 'navikt', githubRepoName: 'renamed-repo' },
                }
              : undefined
          }
        />
      </MemoryRouter>,
    )
    const repo = repositoryView ? 'renamed-repo' : 'reused-name'
    expect(html).toContain(`href="https://github.com/navikt/${repo}/commit/${'a'.repeat(40)}"`)
    if (repositoryView) {
      expect(html).not.toContain('/pull/42')
      expect(html).toContain('#42')
    } else {
      expect(html).toContain(`href="https://github.com/navikt/${repo}/pull/42"`)
    }
  })
})
