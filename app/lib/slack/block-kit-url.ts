import type { KnownBlock } from '@slack/types'

const BLOCK_KIT_BUILDER_BASE = 'https://app.slack.com/block-kit-builder'

export function buildBlockKitBuilderUrl(blocks: KnownBlock[], mode: 'message' | 'modal' = 'message'): string {
  const payload =
    mode === 'modal' ? { type: 'modal', title: { type: 'plain_text', text: 'Preview' }, blocks } : { blocks }

  return `${BLOCK_KIT_BUILDER_BASE}#${encodeURIComponent(JSON.stringify(payload))}`
}

const MAX_URL_LENGTH = 16_000

export function isUrlTooLong(url: string): boolean {
  return url.length > MAX_URL_LENGTH
}
