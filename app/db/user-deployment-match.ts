/**
 * SQL-snippet som matcher deployments hvor en gitt GitHub-bruker enten
 * har deployet *eller* er PR-skaperen. Brukernavn matches case-insensitivt
 * (GitHub-brukernavn er case-insensitive). Brukes for «mine deployments»-
 * visninger og må holdes konsistent på tvers av Slack home tab og
 * `/users/:username`-siden, slik at samme antall vises begge steder.
 *
 * Tar inn parameterposisjonen ($N) så det kan plugges inn i dynamisk SQL.
 * Forutsetter at queryen aliaser `deployments` som `d`.
 */
export function userDeploymentMatchSql(paramIndex: number): string {
  return `(LOWER(d.deployer_username) = LOWER($${paramIndex}) OR d.pr_creator_username = LOWER($${paramIndex}))`
}

/**
 * Som `userDeploymentMatchSql`, men matcher mot et *array* av brukernavn
 * (f.eks. alle medlemmer av et team). Brukes på team-aggregerte spørringer
 * («129 deployments uten godkjenning» osv.) for å holde dem konsistente
 * med personlig matching.
 *
 * Forutsetter at $N inneholder et `text[]` der verdiene allerede er
 * lowercased av kalleren — dette unngår dyrere `LOWER(unnest(...))`-
 * konstruksjoner i SQL-en.
 *
 * Tabell-aliaset (`d` for `deployments`) er valgfritt så funksjonen kan
 * brukes både i queries med og uten alias (f.eks. `getAppDeploymentStatsBatch`
 * bruker tabellnavnet direkte).
 */
export function userDeploymentMatchAnySql(paramIndex: number, tableAlias = 'd'): string {
  const t = tableAlias ? `${tableAlias}.` : ''
  return `(LOWER(${t}deployer_username) = ANY($${paramIndex}::text[]) OR ${t}pr_creator_username = ANY($${paramIndex}::text[]))`
}

/**
 * Lowercaser en array av brukernavn for bruk med `userDeploymentMatchAnySql`.
 * Filtrerer ut tomme/null-verdier slik at de ikke matcher tomme felter.
 */
export function lowerUsernames(usernames: string[]): string[] {
  return usernames.filter((u) => u && u.length > 0).map((u) => u.toLowerCase())
}
