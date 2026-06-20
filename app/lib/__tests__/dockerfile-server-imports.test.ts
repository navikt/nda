import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(__dirname, '../../..')

function readDockerfile(): string {
  return readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf-8')
}

function getCompiledTsFiles(dockerfile: string): Set<string> {
  const compiled = new Set<string>()
  const tscRunLines = dockerfile.match(/RUN pnpm exec tsc[^\n]*/g) ?? []
  for (const line of tscRunLines) {
    const tokens = line.split(/\s+/)
    for (const token of tokens) {
      if (token.endsWith('.ts')) {
        compiled.add(path.normalize(token))
      }
    }
  }
  return compiled
}

function getCopiedPaths(dockerfile: string): string[] {
  const copied: string[] = []
  const copyLines = dockerfile.match(/COPY --from=builder \/app\/[^\s]+/g) ?? []
  for (const line of copyLines) {
    const m = line.match(/COPY --from=builder \/app\/(\S+)/)
    if (m) copied.push(path.normalize(m[1]))
  }
  return copied
}

function extractRelativeImports(source: string): string[] {
  const out: string[] = []
  const re = /^\s*import\s+[^'"\n]+from\s+['"](\.[^'"\n]+)['"]/gm
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
  while ((m = re.exec(source)) !== null) {
    out.push(m[1])
  }
  return out
}

function resolveImportToTsFile(fromFile: string, importSpec: string): string | null {
  const fromDir = path.dirname(path.join(REPO_ROOT, fromFile))
  const resolvedJs = path.resolve(fromDir, importSpec)
  for (const ext of ['.ts', '.tsx']) {
    const tsCandidate = resolvedJs.replace(/\.js$/, ext)
    if (existsSync(tsCandidate)) {
      return path.relative(REPO_ROOT, tsCandidate)
    }
  }
  const indexCandidate = path.join(resolvedJs.replace(/\.js$/, ''), 'index.ts')
  if (existsSync(indexCandidate)) {
    return path.relative(REPO_ROOT, indexCandidate)
  }
  return null
}

function collectRelativeImportClosure(entries: string[]): Set<string> {
  const visited = new Set<string>()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.shift()
    if (!file || visited.has(file)) continue
    visited.add(file)
    const fullPath = path.join(REPO_ROOT, file)
    if (!existsSync(fullPath)) continue
    const source = readFileSync(fullPath, 'utf-8')
    for (const spec of extractRelativeImports(source)) {
      const resolved = resolveImportToTsFile(file, spec)
      if (resolved && !visited.has(resolved)) queue.push(resolved)
    }
  }
  return visited
}

describe('Dockerfile server import graph', () => {
  it('compiles every TS file that server.ts imports (transitively, via relative paths)', () => {
    const dockerfile = readDockerfile()
    const compiled = getCompiledTsFiles(dockerfile)
    const copied = getCopiedPaths(dockerfile)

    expect(compiled.has('server.ts')).toBe(true)

    const closure = collectRelativeImportClosure(['server.ts'])

    const missing: string[] = []
    for (const file of closure) {
      if (compiled.has(file)) continue
      const isInsideCopiedDir = copied.some((c) => file === c || file.startsWith(`${c}${path.sep}`))
      if (isInsideCopiedDir) continue
      missing.push(file)
    }

    expect(
      missing,
      `Server imports the following TS files but the Dockerfile neither compiles them with tsc nor copies them into the runtime image. They will fail at runtime with ERR_MODULE_NOT_FOUND:\n${missing.join('\n')}`,
    ).toEqual([])
  })

  it('copies every compiled .js artifact into the runtime image', () => {
    const dockerfile = readDockerfile()
    const compiled = getCompiledTsFiles(dockerfile)
    const copied = new Set(getCopiedPaths(dockerfile))

    const missing: string[] = []
    for (const tsFile of compiled) {
      const jsFile = tsFile.replace(/\.ts$/, '.js')
      const isCopied = copied.has(jsFile) || [...copied].some((c) => jsFile.startsWith(`${c}${path.sep}`))
      if (!isCopied) missing.push(jsFile)
    }

    expect(missing, `Compiled but not copied into runtime image:\n${missing.join('\n')}`).toEqual([])
  })
})
