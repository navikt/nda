export type SearchResultType = 'deployment' | 'user' | 'team' | 'app' | 'dev_team' | 'group'

export type SearchResultTagVariant = 'info' | 'neutral' | 'success' | 'warning' | 'moderate'

export type SearchResultIcon = 'search' | 'group' | 'dev-team'

export interface SearchResult {
  id?: number
  type: SearchResultType
  title: string
  subtitle?: string
  url: string
}

export interface SearchResultPresentation {
  icon: SearchResultIcon
  label: string
  variant: SearchResultTagVariant
}

export function getDefaultSearchResultPresentation(type: SearchResultType): SearchResultPresentation {
  switch (type) {
    case 'deployment':
      return { icon: 'search', label: 'Leveranse', variant: 'info' }
    case 'team':
      return { icon: 'search', label: 'Nais-team', variant: 'success' }
    case 'app':
      return { icon: 'search', label: 'Applikasjon', variant: 'warning' }
    case 'dev_team':
      return { icon: 'dev-team', label: 'Utviklerteam', variant: 'moderate' }
    case 'group':
      return { icon: 'group', label: 'Gruppe', variant: 'moderate' }
    default:
      return { icon: 'search', label: 'Bruker', variant: 'neutral' }
  }
}
