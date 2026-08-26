export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'o')
    .replaceAll('å', 'a')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function generateUniqueSlug(
  source: string,
  slugExists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(source) || 'ny'
  let candidate = base
  let suffix = 2
  while (await slugExists(candidate)) {
    candidate = `${base}-${suffix}`
    suffix++
  }
  return candidate
}
