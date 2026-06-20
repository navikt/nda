export function userDeploymentMatchSql(paramIndex: number): string {
  return `(LOWER(d.deployer_username) = LOWER($${paramIndex}) OR d.pr_creator_username = LOWER($${paramIndex}))`
}

export function userDeploymentMatchAnySql(paramIndex: number, tableAlias = 'd'): string {
  const t = tableAlias ? `${tableAlias}.` : ''
  return `(LOWER(${t}deployer_username) = ANY($${paramIndex}::text[]) OR ${t}pr_creator_username = ANY($${paramIndex}::text[]))`
}

export function lowerUsernames(usernames: string[]): string[] {
  return usernames.filter((u) => u && u.length > 0).map((u) => u.toLowerCase())
}
