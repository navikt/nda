import { BodyShort, Box, Button, Heading, Select, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']

type TestRequirementSettingsProps = {
  app: LoaderData['app']
}

export function TestRequirementSettings({ app }: TestRequirementSettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Testkrav for leveranser
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Spesifiser hvilke tester som må være vellykkede før en leveranse kan gjennomføres.
          </BodyShort>
        </div>

        <Form method="post">
          <input type="hidden" name="action" value="update_test_requirement" />
          <input type="hidden" name="app_id" value={app.id} />
          <VStack gap="space-12">
            <Select
              label="Testkrav"
              name="test_requirement"
              defaultValue={app.test_requirement || 'none'}
              size="small"
              style={{ maxWidth: '300px' }}
            >
              <option value="none">Ingen</option>
              <option value="unit_tests">Enhetstester</option>
              <option value="integration_tests">Integrasjonstester</option>
            </Select>

            <BodyShort size="small" textColor="subtle">
              Dette valget dokumenteres i rapporten under «Sikkerhet og dataintegritet».
            </BodyShort>

            <Button type="submit" size="small" variant="secondary">
              Lagre testkrav
            </Button>
          </VStack>
        </Form>
      </VStack>
    </Box>
  )
}
