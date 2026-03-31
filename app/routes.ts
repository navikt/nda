import { index, layout, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  // Health check endpoints (outside layout)
  route('api/isalive', 'routes/api/isalive.ts'),
  route('api/isready', 'routes/api/isready.ts'),
  route('api/reports/generate', 'routes/api/reports.generate.ts'),
  route('api/reports/download', 'routes/api/reports.download.ts'),
  route('api/reports/status', 'routes/api/reports.status.ts'),
  route('api/search', 'routes/api/search.ts'),
  route('api/checks/logs', 'routes/api/checks.logs.ts'),
  route('api/checks/annotations', 'routes/api/checks.annotations.ts'),

  layout('routes/layout.tsx', [
    index('routes/home.tsx'),
    route('apps/add', 'routes/apps.add.tsx'),
    route('search', 'routes/search.tsx'),
    // Semantic URL structure
    route('team/:team', 'routes/team/$team.tsx'),
    route('team/:team/env/:env', 'routes/team/$team.env.$env.tsx'),
    route('team/:team/env/:env/app/:app', 'routes/team/$team.env.$env.app.$app.tsx'),
    route('team/:team/env/:env/app/:app/admin', 'routes/team/$team.env.$env.app.$app.admin.tsx'),
    route('team/:team/env/:env/app/:app/slack', 'routes/team/$team.env.$env.app.$app.slack.tsx'),
    route(
      'team/:team/env/:env/app/:app/admin/verification-diff',
      'routes/team/$team.env.$env.app.$app.admin.verification-diff.tsx',
    ),
    route(
      'team/:team/env/:env/app/:app/admin/verification-diff/:deploymentId',
      'routes/team/$team.env.$env.app.$app.admin.verification-diff.$deploymentId.tsx',
    ),
    route(
      'team/:team/env/:env/app/:app/admin/status-history',
      'routes/team/$team.env.$env.app.$app.admin.status-history.tsx',
    ),
    route(
      'team/:team/env/:env/app/:app/admin/sync-job/:jobId',
      'routes/team/$team.env.$env.app.$app.admin.sync-job.$jobId.tsx',
    ),
    route('team/:team/env/:env/app/:app/deployments', 'routes/team/$team.env.$env.app.$app.deployments.tsx'),
    route(
      'team/:team/env/:env/app/:app/deployments/:deploymentId',
      'routes/team/$team.env.$env.app.$app.deployments.$deploymentId.tsx',
    ),
    route(
      'team/:team/env/:env/app/:app/deployments/:deploymentId/debug-verify',
      'routes/team/$team.env.$env.app.$app.deployments.$deploymentId.debug-verify.tsx',
    ),
    route('deployments/verify', 'routes/deployments/verify.tsx'),
    route('deployments/:id', 'routes/deployments/$id.tsx'),
    route('users/:username', 'routes/users/$username.tsx'),
    route('admin', 'routes/admin/index.tsx'),
    route('admin/users', 'routes/admin/users.tsx'),
    route('admin/users/export', 'routes/admin/users.export.ts'),
    route('admin/sync-jobs', 'routes/admin/sync-jobs.tsx'),
    route('admin/sync-jobs/:jobId', 'routes/admin/sync-jobs.$jobId.tsx'),
    route('admin/slack', 'routes/admin/slack.tsx'),
    route('admin/audit-reports', 'routes/admin/audit-reports.tsx'),
    route('admin/audit-reports/:id/pdf', 'routes/admin/audit-reports.$id.pdf.ts'),
    route('admin/audit-reports/:id/view', 'routes/admin/audit-reports.$id.view.ts'),
    route('admin/global-settings', 'routes/admin/global-settings.tsx'),
    route('admin/env', 'routes/admin/environment.tsx'),
    route('admin/sections', 'routes/admin/sections.tsx'),
    route('admin/sections/:slug/dev-teams', 'routes/admin/sections.$slug.dev-teams.tsx'),
    route('sections/:sectionSlug/teams/:devTeamSlug', 'routes/sections.$sectionSlug.teams.$devTeamSlug.tsx'),
    route(
      'sections/:sectionSlug/teams/:devTeamSlug/boards',
      'routes/sections.$sectionSlug.teams.$devTeamSlug.boards.tsx',
    ),
    route(
      'sections/:sectionSlug/teams/:devTeamSlug/dashboard',
      'routes/sections.$sectionSlug.teams.$devTeamSlug.dashboard.tsx',
    ),
    route(
      'sections/:sectionSlug/teams/:devTeamSlug/:boardId',
      'routes/sections.$sectionSlug.teams.$devTeamSlug.$boardId.tsx',
    ),
    route('sections/:slug', 'routes/sections.$slug.tsx'),
    route('team/:team/env/:env/app/:app/admin/deviations', 'routes/team/$team.env.$env.app.$app.admin.deviations.tsx'),
  ]),
] satisfies RouteConfig
