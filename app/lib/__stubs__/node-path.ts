export const join = (..._parts: string[]): string => _parts.join('/')
export const resolve = (..._parts: string[]): string => _parts.join('/')
export const dirname = (_p: string): string => _p.split('/').slice(0, -1).join('/')
export const basename = (_p: string): string => _p.split('/').at(-1) ?? ''
export default { join, resolve, dirname, basename }
