import type { Meta, StoryObj } from '@storybook/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Breadcrumbs } from '~/components/Breadcrumbs'

const meta: Meta<typeof Breadcrumbs> = {
  title: 'Components/Breadcrumbs',
  component: Breadcrumbs,
  parameters: {
    router: { skip: true },
  },
}

export default meta

type Story = StoryObj<typeof meta>

function createBreadcrumbsRouter(initialEntry: string) {
  return createMemoryRouter(
    [
      {
        path: '/',
        element: <Breadcrumbs />,
        children: [
          {
            index: true,
          },
          {
            path: 'admin',
            children: [
              {
                index: true,
              },
              {
                path: 'users',
              },
            ],
          },
          {
            path: 'team/:team',
            children: [
              {
                index: true,
              },
              {
                path: 'env/:env',
                children: [
                  {
                    index: true,
                  },
                  {
                    path: 'app/:app',
                    children: [
                      {
                        index: true,
                      },
                      {
                        path: 'deployments',
                        children: [
                          {
                            index: true,
                          },
                          {
                            path: ':deploymentId',
                            loader: () => ({
                              deployment: {
                                commit_sha: 'abc1234def567890',
                              },
                            }),
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    {
      initialEntries: [initialEntry],
    },
  )
}

function renderBreadcrumbsStory(initialEntry: string) {
  const router = createBreadcrumbsRouter(initialEntry)
  return <RouterProvider router={router} />
}

export const Home: Story = {
  name: 'Hjem',
  render: () => renderBreadcrumbsStory('/'),
}

export const Admin: Story = {
  name: 'Admin',
  render: () => renderBreadcrumbsStory('/admin'),
}

export const AdminUsers: Story = {
  name: 'Admin > Brukermappinger',
  render: () => renderBreadcrumbsStory('/admin/users'),
}

export const AppPage: Story = {
  name: 'App-side',
  render: () => renderBreadcrumbsStory('/team/pensjondeployer/env/prod-fss/app/pensjon-pen'),
}

export const AppDeployments: Story = {
  name: 'App > Deployments',
  render: () => renderBreadcrumbsStory('/team/pensjondeployer/env/prod-fss/app/pensjon-pen/deployments'),
}

export const DeploymentDetail: Story = {
  name: 'App > Deployments > Commit',
  render: () => renderBreadcrumbsStory('/team/pensjondeployer/env/prod-fss/app/pensjon-pen/deployments/123'),
}

export const TeamPage: Story = {
  name: 'Team-side',
  render: () => renderBreadcrumbsStory('/team/pensjondeployer'),
}

export const TeamEnvPage: Story = {
  name: 'Team/Env-side',
  render: () => renderBreadcrumbsStory('/team/pensjondeployer/env/prod-fss'),
}
