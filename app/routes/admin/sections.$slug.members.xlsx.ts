import ExcelJS from 'exceljs'
import { getDevTeamsBySection } from '~/db/dev-teams.server'
import { getDevTeamMembersWithRoles } from '~/db/role-assignments.server'
import { getSectionWithTeams } from '~/db/sections.server'
import { requireUser } from '~/lib/auth.server'
import { canManageSection } from '~/lib/authorization.server'
import type { Route } from './+types/sections.$slug.members.xlsx'

function splitDisplayName(displayName: string | null): { firstName: string; lastName: string } {
  if (!displayName) return { firstName: '', lastName: '' }
  const parts = displayName.trim().split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const section = await getSectionWithTeams(params.slug)
  if (!section) {
    throw new Response('Seksjon ikke funnet', { status: 404 })
  }
  if (!(await canManageSection(user, section.id))) {
    throw new Response(
      'Du må være seksjonsleder eller teknologileder for denne seksjonen for å eksportere teammedlemmer.',
      {
        status: 403,
      },
    )
  }

  const devTeams = await getDevTeamsBySection(section.id)
  const membersByNavIdent = new Map<
    string,
    { navIdent: string; displayName: string | null; githubUsername: string | null }
  >()

  const membersByTeam = await Promise.all(devTeams.map((team) => getDevTeamMembersWithRoles(team.id)))
  for (const members of membersByTeam) {
    for (const member of members) {
      const key = member.nav_ident.toUpperCase()
      if (!membersByNavIdent.has(key)) {
        membersByNavIdent.set(key, {
          navIdent: key,
          displayName: member.display_name,
          githubUsername: member.display_github_username ?? member.github_username,
        })
      }
    }
  }

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Teammedlemmer')
  sheet.columns = [
    { header: 'Navident', key: 'navIdent', width: 14 },
    { header: 'Fornavn', key: 'firstName', width: 20 },
    { header: 'Etternavn', key: 'lastName', width: 24 },
    { header: 'GitHub-brukernavn', key: 'githubUsername', width: 24 },
  ]
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true }

  const sortedMembers = [...membersByNavIdent.values()].sort((a, b) =>
    (a.displayName ?? a.navIdent).localeCompare(b.displayName ?? b.navIdent, 'nb'),
  )
  for (const member of sortedMembers) {
    const { firstName, lastName } = splitDisplayName(member.displayName)
    sheet.addRow({
      navIdent: member.navIdent,
      firstName,
      lastName,
      githubUsername: member.githubUsername ?? '',
    })
  }

  const rawBuffer = await workbook.xlsx.writeBuffer()
  const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer)

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${section.slug}-teammedlemmer.xlsx"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
