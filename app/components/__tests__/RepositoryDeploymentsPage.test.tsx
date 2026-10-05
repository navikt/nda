import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it } from 'vitest'
import { RepositoryDeploymentsPage, type RepositoryDeploymentsPageProps } from '../RepositoryDeploymentsPage'

const deployment: RepositoryDeploymentsPageProps['deployments'][number] = {
  id: 1,
  created_at: '2025-06-01T12:00:00Z',
  title: 'Ny leveranse',
  deployer_username: null,
  commit_sha: 'a'.repeat(40),
  detected_github_owner: 'navikt',
  detected_github_repo_name: 'repo-a',
  github_pr_number: null,
  github_pr_url: null,
  github_pr_data: null,
  workflow_trigger_config: null,
  four_eyes_status: 'approved',
  team_slug: 'team-a',
  environment_name: 'prod-gcp',
  app_name: 'app-a',
}

function renderPage(groupBySha: boolean) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <RepositoryDeploymentsPage
            repository={{ id: 1, github_owner: 'navikt', github_repo_name: 'repo-a' }}
            groupBySha={groupBySha}
            deployments={[
              deployment,
              { ...deployment, id: 2, app_name: 'app-b', environment_name: 'dev-gcp', four_eyes_status: 'direct_push' },
            ]}
            total={groupBySha ? 1 : 2}
            page={1}
            total_pages={1}
            userMappings={{}}
            deployerOptions={[]}
            currentUserGithub={null}
            errorReasons={{}}
            teamOptions={[]}
            teamFilterEmptyReason={null}
            hasUnmappedDeployers={false}
            goalOptions={[]}
            triggerEventOptions={[]}
            workflowFileOptions={[]}
          />
        ),
      },
    ],
    { initialEntries: [groupBySha ? '/?view=sha&period=all' : '/?period=all'] },
  )
  return renderToStaticMarkup(<RouterProvider router={router} />)
}

it('renders one SHA heading with separate deployment statuses, apps, environments and detail links', () => {
  const markup = renderPage(true)
  expect(markup).toContain(`SHA ${deployment.commit_sha}`)
  expect(markup.match(/id="sha-group-/g)).toHaveLength(1)
  expect(markup).toContain('1 kodegruppe funnet')
  expect(markup).toContain('Status for viste deployments: 1 godkjent, 1 ikke godkjent.')
  expect(markup).toContain('app-a')
  expect(markup).toContain('app-b')
  expect(markup).toContain('prod-gcp')
  expect(markup).toContain('dev-gcp')
  expect(markup).toContain('/team/team-a/env/prod-gcp/app/app-a/deployments/1?view=sha&amp;period=all')
  expect(markup).toContain('/team/team-a/env/dev-gcp/app/app-b/deployments/2?view=sha&amp;period=all')
})

it('keeps the default deployment list without group headings', () => {
  const markup = renderPage(false)
  expect(markup).not.toContain('id="sha-group-')
  expect(markup).toContain('2 deployments funnet')
  expect(markup).not.toContain('Status for viste deployments:')
})
