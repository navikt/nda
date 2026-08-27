import { describe, expect, it } from 'vitest'
import { newDeploymentFixtures } from '~/lib/__fixtures__/slack-fixtures'
import { buildNewDeploymentBlocks } from '~/lib/slack'

describe('buildNewDeploymentBlocks', () => {
  it('renders header, PR title, creator/merger and both buttons for a PR deploy', () => {
    const blocks = buildNewDeploymentBlocks(newDeploymentFixtures.withPr)
    const text = JSON.stringify(blocks)

    expect(blocks[0]).toMatchObject({ type: 'header' })
    expect(text).toContain('Ny deployment')
    expect(text).toContain('pensjon-pen')
    expect(text).toContain('feat: legg til ny pensjonsberegning for AFP')
    expect(text).toContain('Opprettet av ola.nordmann')
    expect(text).toContain('Merget av kari.nordmann')
    expect(text).toContain('Se deployment')
    expect(text).toContain('Se Pull Request #123')
  })

  it('renders real Slack mentions when a slack_member_id mapping exists', () => {
    const blocks = buildNewDeploymentBlocks(newDeploymentFixtures.withPrSlackMentions)
    const text = JSON.stringify(blocks)

    expect(text).toContain('<@U0100000001>')
    expect(text).toContain('<@U0100000002>')
  })

  it('falls back to plain username when slack_member_id does not match the expected pattern', () => {
    const blocks = buildNewDeploymentBlocks({
      ...newDeploymentFixtures.withPr,
      slackMentions: { 'ola.nordmann': 'not-a-valid-id' },
    })
    const text = JSON.stringify(blocks)

    expect(text).toContain('ola.nordmann')
    expect(text).not.toContain('<@not-a-valid-id>')
  })

  it('omits PR title/creator/merger sections for a direct_push deploy without a PR', () => {
    const blocks = buildNewDeploymentBlocks(newDeploymentFixtures.directPush)
    const text = JSON.stringify(blocks)

    expect(text).not.toContain('Opprettet av')
    expect(text).not.toContain('Merget av')
    expect(blocks.some((b) => b.type === 'actions')).toBe(true)
  })

  it('omits PR title/creator/merger sections for a legacy deploy without a PR', () => {
    const blocks = buildNewDeploymentBlocks(newDeploymentFixtures.legacy)
    const text = JSON.stringify(blocks)

    expect(text).not.toContain('Opprettet av')
    expect(text).not.toContain('Merget av')
  })

  it('renders PR title/creator/merger but omits the PR button when pr.url is missing (backfill gap)', () => {
    const blocks = buildNewDeploymentBlocks({
      ...newDeploymentFixtures.withPr,
      pr: { ...newDeploymentFixtures.withPr.pr, url: undefined },
    })
    const text = JSON.stringify(blocks)

    expect(text).toContain('Opprettet av ola.nordmann')
    expect(text).toContain('Merget av kari.nordmann')
    expect(text).not.toContain('Se Pull Request')
  })
})
