import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import teamEnvMeta, { Default, ManyApps, SingleApp } from '~/routes/__stories__/TeamEnv.stories'

vi.mock('react-router', async () => {
  const React = await import('react')
  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
  }
})

type TeamEnvStoryArgs = {
  team: string
  env: string
  apps: Array<{ app_name: string }>
}

const TeamEnvPage = teamEnvMeta.component as (props: TeamEnvStoryArgs) => ReactElement

function renderStory(args: TeamEnvStoryArgs) {
  return renderToStaticMarkup(<TeamEnvPage {...args} />)
}

function countOccurrences(text: string, value: string) {
  return text.split(value).length - 1
}

describe('TeamEnv.stories baseline characterization', () => {
  it('locks default story output', () => {
    const html = renderStory(Default.args as TeamEnvStoryArgs)

    expect(html).toContain('pensjondeployer')
    expect(html).toContain('prod-fss')
    expect(html).toContain('2 applikasjoner')
    expect(html).toContain('pensjon-pen')
    expect(html).toContain('pensjon-selvbetjening')
    expect(countOccurrences(html, 'https://github.com/navikt/')).toBe(2)
  })

  it('locks single-app story output', () => {
    const html = renderStory(SingleApp.args as TeamEnvStoryArgs)

    expect(html).toContain('pensjondeployer')
    expect(html).toContain('prod-gcp')
    expect(html).toContain('1 applikasjon')
    expect(html).toContain('pensjon-opptjening')
    expect(countOccurrences(html, 'https://github.com/navikt/')).toBe(1)
  })

  it('locks many-apps story output', () => {
    const html = renderStory(ManyApps.args as TeamEnvStoryArgs)

    expect(html).toContain('pensjondeployer')
    expect(html).toContain('prod-fss')
    expect(html).toContain('5 applikasjoner')
    expect(html).toContain('pensjon-api')
    expect(html).toContain('pensjon-frontend')
    expect(html).toContain('pensjon-batch')
    expect(countOccurrences(html, 'https://github.com/navikt/')).toBe(5)
  })
})
