import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NavigationProgress } from '../NavigationProgress'

describe('NavigationProgress', () => {
  it('keeps an empty live region when navigation is idle', () => {
    const markup = renderToStaticMarkup(<NavigationProgress isNavigating={false} />)

    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).not.toContain('Laster side')
    expect(markup).not.toContain('aria-hidden')
  })

  it('announces loading and hides the visual indicator from screen readers', () => {
    const markup = renderToStaticMarkup(<NavigationProgress isNavigating />)

    expect(markup).toContain('Laster side…')
    expect(markup).toContain('aria-atomic="true"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain('aksel-loader')
  })
})
