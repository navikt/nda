import { PlusIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, TextField, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { Form, Link, useLoaderData } from 'react-router'
import { createSection, getAllSectionsWithTeams } from '~/db/sections.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/sections'

export function meta() {
  return [{ title: 'Seksjoner - Admin - Deployment Audit' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const sections = await getAllSectionsWithTeams()
  return { sections }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)
  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create') {
    const slug = (formData.get('slug') as string)?.trim()
    const name = (formData.get('name') as string)?.trim()
    const entraGroupAdmin = (formData.get('entra_group_admin') as string)?.trim() || undefined
    const entraGroupUser = (formData.get('entra_group_user') as string)?.trim() || undefined

    if (!slug || !name) {
      return { error: 'Slug og navn er påkrevd.' }
    }

    try {
      await createSection(slug, name, entraGroupAdmin, entraGroupUser)
      return { success: true }
    } catch (error) {
      return { error: `Kunne ikke opprette seksjon: ${error}` }
    }
  }

  return { error: 'Ukjent handling.' }
}

export default function AdminSections() {
  const { sections } = useLoaderData<typeof loader>()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Seksjoner
        </Heading>
        <BodyShort textColor="subtle">Administrer seksjoner og tilhørende nais-team.</BodyShort>
      </div>

      {!showCreate ? (
        <HStack>
          <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={() => setShowCreate(true)}>
            Ny seksjon
          </Button>
        </HStack>
      ) : (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <Form method="post" onSubmit={() => setShowCreate(false)}>
            <input type="hidden" name="intent" value="create" />
            <VStack gap="space-16">
              <Heading level="2" size="small">
                Opprett ny seksjon
              </Heading>
              <HStack gap="space-16" wrap>
                <TextField label="Slug" name="slug" size="small" placeholder="f.eks. pensjon" autoComplete="off" />
                <TextField
                  label="Visningsnavn"
                  name="name"
                  size="small"
                  placeholder="f.eks. Pensjon og uføre"
                  autoComplete="off"
                />
              </HStack>
              <HStack gap="space-16" wrap>
                <TextField
                  label="Entra ID admin-gruppe"
                  name="entra_group_admin"
                  size="small"
                  placeholder="Gruppe-ID (valgfritt)"
                  autoComplete="off"
                />
                <TextField
                  label="Entra ID bruker-gruppe"
                  name="entra_group_user"
                  size="small"
                  placeholder="Gruppe-ID (valgfritt)"
                  autoComplete="off"
                />
              </HStack>
              <HStack gap="space-8">
                <Button type="submit" size="small">
                  Opprett
                </Button>
                <Button variant="tertiary" size="small" onClick={() => setShowCreate(false)}>
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        </Box>
      )}

      {sections.length === 0 ? (
        <Alert variant="info">Ingen seksjoner er opprettet ennå.</Alert>
      ) : (
        <VStack gap="space-12">
          {sections.map((section) => (
            <Box
              key={section.id}
              padding="space-20"
              borderRadius="8"
              background="raised"
              borderColor="neutral-subtle"
              borderWidth="1"
            >
              <Heading level="2" size="medium">
                <Link to={`/sections/${section.slug}`}>{section.name}</Link>
              </Heading>
            </Box>
          ))}
        </VStack>
      )}
    </VStack>
  )
}
