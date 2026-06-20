export function parseRepository(repository: string | null | undefined): { owner: string; repo: string } | null {
  if (!repository) return null

  const urlMatch = repository.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] }
  }

  if (repository.includes('/')) {
    const parts = repository.split('/')
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] }
    }
  }

  return null
}
