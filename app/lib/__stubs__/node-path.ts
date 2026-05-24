// Stub for node:path used in Storybook (browser environment).
// audit-report-pdf.tsx imports `join` only to build font file paths in production;
// in dev/Storybook, fontBasePath is null and join is never called.
export const join = (..._parts: string[]): string => _parts.join('/')
export const resolve = (..._parts: string[]): string => _parts.join('/')
export const dirname = (_p: string): string => _p.split('/').slice(0, -1).join('/')
export const basename = (_p: string): string => _p.split('/').at(-1) ?? ''
export default { join, resolve, dirname, basename }
