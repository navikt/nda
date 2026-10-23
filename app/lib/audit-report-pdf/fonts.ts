import { join } from 'node:path'
import { Font } from '@react-pdf/renderer'

let registered = false

export function registerAuditReportFonts() {
  if (registered || process.env.NODE_ENV === 'test') return
  registered = true

  const fontBasePath =
    typeof window === 'undefined' && process.env.NODE_ENV === 'production' ? join(process.cwd(), 'fonts') : null

  Font.register({
    family: 'Source Sans Pro',
    fonts: [
      {
        src: fontBasePath
          ? join(fontBasePath, 'source-sans-3-regular.ttf')
          : 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-pro@latest/latin-400-normal.ttf',
        fontWeight: 400,
      },
      {
        src: fontBasePath
          ? join(fontBasePath, 'source-sans-3-italic.ttf')
          : 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-pro@latest/latin-400-italic.ttf',
        fontWeight: 400,
        fontStyle: 'italic',
      },
      {
        src: fontBasePath
          ? join(fontBasePath, 'source-sans-3-semibold.ttf')
          : 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-pro@latest/latin-600-normal.ttf',
        fontWeight: 600,
      },
    ],
  })
}
