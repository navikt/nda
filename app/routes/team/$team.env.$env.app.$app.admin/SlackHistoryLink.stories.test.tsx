import { composeStories, setProjectAnnotations } from '@storybook/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import preview from '../../../../.storybook/preview'
import * as stories from './SlackHistoryLink.stories'

setProjectAnnotations(preview)

const { Default } = composeStories(stories)

describe('SlackHistoryLink story baseline characterization', () => {
  it('renders a link pointing at the team/env/app slack history page', () => {
    const html = renderToStaticMarkup(<Default />)

    expect(html).toContain('Se all Slack-historikk')
    expect(html).toContain('/team/pensjondeployer/env/prod-fss/app/pensjon-pen/slack')
  })
})
