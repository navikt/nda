# Manuell repositorygodkjenning

## Omfang

Den første manuelle flyten gjelder valgte commits i én repositoryleveranse.
Den supplerer repositoryets forhåndsvurdering, men endrer aldri deploymentstatus,
verifiseringshistorikk eller eksisterende PR-regler. Gamle appgodkjenninger importeres ikke.
`app/lib/verification/verify.ts` er uendret.

## Brukerflyt

1. Åpne **Manuell repositorygodkjenning** fra repositorysiden, eller bruk lenken
   fra en leveranses adminside når du har godkjenningsrett.
2. Velg leveransen og trykk **Start gjennomgang**. Dette sender POST og lagrer
   et uforanderlig snapshot. GET oppretter aldri snapshots eller godkjenninger.
3. Les det fryste grunnlaget før bekreftelsen: base/head, lagringstidspunkt,
   default-branch, implisitt PR-regel, commits, forfatterkoblinger, Git-tider og
   lagrede PR-commits og reviews. GitHub-lenker er hjelp til kodegjennomgangen;
   eksternt innhold kan ha endret seg siden snapshotten ble lagret.
4. Velg eksplisitt bare committene du har gjennomgått. Ingen er forhåndsvalgt.
   Egne commits, ukjent PR-grunnlag, ukjent forfatteridentitet og commits uten
   gyldig lagret committer-tid kan ikke velges. Årsaken vises i grunnlaget.
5. Beskriv hva du har gjennomgått. En lenke til ytterligere dokumentasjon er
   valgfri og må bruke `http` eller `https`. Ikke skriv personopplysninger eller
   hemmeligheter i friteksten.
6. Oppgi faktisk reviewtid med eksplisitt tidssone, eksempelvis
   `2026-10-19T11:30:00+02:00`. Tidspunktet er ikke forhåndsutfylt.
7. Bekreft de valgte committene. Registrator og reviewer er alltid den
   serverautentiserte NAV-identen; skjemaet kan ikke velge en annen person.

Grunnlaget erstattes ikke ved revalidering eller ved avvist registrering.
Hvis evidens, innlogget godkjenner eller en forfatterkobling i det viste
grunnlaget er endret, avvises registreringen. Brukeren må selv starte en ny
gjennomgang og vurdere det nye grunnlaget. Ingen delgodkjenning eller
opprettelseshendelse lagres når valideringen feiler.

## Tid og etterfølgende godkjenning

Serveren sammenligner reviewtid med **lagret committer-tid for hver valgt commit**.
Reviewtid må være minst like sen som den nyeste av disse tidene og ikke være i
fremtiden etter databaseklokken. Uvalgte commits flytter ikke den nedre tidsgrensen.
Manglende eller ugyldig committer-tid gir avslag; author-tid, deploymenttid og
registreringstid brukes aldri som skjult reserve. Tidsstrengen valideres også for
gyldig kalenderdato og tidssone.

Git-metadata er ikke sikkert tidsbevis. Dette er en kontroll mot det lagrede
grunnlaget, ikke en garanti for når kode faktisk ble tilgjengelig.

Review etter deployment er tillatt. Hvis reviewtid er etter første tilknyttede
deployment, merkes historikken **Etterfølgende godkjenning – ikke godkjent ved
første deploy**. Første deployment beregnes over alle tilknyttede deployments,
ikke bare siden som vises i den paginerte evidensvisningen. Merket er ikke en
beregning av godkjenningsstatus for senere deployments. Registreringstid vises
separat fra reviewtid. Hvis registreringen skjer etter første deployment, vises
også **Registrert etter første deploy**, selv om oppgitt reviewtid er tidligere.
Oppgitt reviewtid er ikke bevis på at godkjenningen var registrert før deployment.

## Tilgang og dataminimering

`resolveRepositoryApprovalCapabilities` løser godkjennings- og adminkapasiteter
i én spørring. Eksisterende adminsemantikk er beholdt.

- Godkjenning: Entra-admin eller aktiv teamrolle i et aktivt managing team for
  minst én aktiv app som har dette repositoryet som siste aktive kobling.
- Repositoryadmin: Entra-admin eller teamledertilgang til alle berørte aktive
  apper, også apper med historisk repositorykobling.
- En godkjenner uten adminrett får tilgang til `/repository/:owner/:repo/approvals`
  og `/repository/:owner/:repo/approvals/:deliveryId`, ikke adminsiden.
- Historiske repositoryadminer uten godkjenningsrett kan lese historikk og
  tilbakekalle, men ikke starte en review eller registrere godkjenning.

Godkjenningssiden returnerer bare leveranseintervall, første deployment og en
avgrenset historikk. POST-responsen viser en egen DTO for det fryste grunnlaget,
ikke hele evaluatorinputen, hash eller interne identitetsversjoner. Ingen
admininnstillinger, driftsjobber eller rå verifiseringsdata returneres av disse
rutene.

Mutasjoner krever POST med `Origin` lik requestens origin og avviser eksplisitt
`Sec-Fetch-Site: cross-site`. De bruker eksisterende serverautentisering.
Manglende origin avvises også; dette er nettleserhandlinger, ikke et M2M-API.
Alle ID-er må være endelige, positive PostgreSQL-heltall. SHA-er valideres på
serveren. Repository, leveranse, snapshot og godkjenning scopes sammen.
Ukjente handlinger avvises.

## Lagring og tilbakekalling

- Snapshotten inneholder normalisert evaluatorinput, kanonisk SHA256-hash og
  forfatteridentiteter med versjoner. Nye snapshots knyttes også til NAV-identen
  som startet gjennomgangen.
- Registrering releser gjeldende evidens og identiteter i `REPEATABLE READ`.
  Identiteter låses i rekkefølgen users før accounts. Serialiseringskonflikter
  og deadlocks oversettes til avslag på endret grunnlag.
- Beskrivelse og dokumentasjonslenke lagres sammen med godkjenningen.
  Ny serverkode krever beskrivelse. Gamle rader har fortsatt `NULL`, og vises
  som ikke dokumentert i den gamle registreringen.
- Tilbakekalling krever repositoryadmin og en ikke-blank begrunnelse.
  En `revoked`-hendelse legges til; originalen endres ikke. Gjentatt
  tilbakekalling returnerer `false`, og actionen rapporterer ingen endring.
- Append-only-triggerne er beholdt for UPDATE og DELETE.

Migrering `1792403000000_add-repository-approval-documentation.sql` legger bare
til nullable felt og constraints. Den oppdaterer ikke gamle rader og fjerner
ingen tidligere migrering. Gamle snapshots uten identifisert oppretter kan
fortsatt leses i historikken, men kan ikke bekreftes i den nye serverflyten.

## Utrulling og operativ verifikasjon

1. Kjør ordinær migrering før ny applikasjonskode.
2. Verifiser godkjenner uten adminrett og historisk admin uten godkjenningsrett.
3. Kontroller at GET ikke lager snapshots. Start via POST, og sammenlign vist
   intervall og forfattere med det lagrede grunnlaget.
4. Registrer et eksplisitt subset med beskrivelse og faktisk reviewtid.
   Kontroller at bare valgte SHA-er lagres og vises i historikken.
5. Kontroller avslag for egne commits, manglende tekst, ugyldig URL, fremtidig
   reviewtid, for tidlig reviewtid og manglende committer-tid.
6. Endre evidens eller forfatterkobling i et kontrollert testmiljø mellom start
   og bekreftelse. Kontroller at bekreftelsen avvises uten nytt snapshot.
7. Kontroller merking etter deployment og begrunnet tilbakekalling.
8. Sammenlign deploymentstatus og verifiseringshistorikk før og etter handlingene;
   ingen av dem skal være endret.

Ved feil rulles applikasjonskoden tilbake til forrige image. La den additive
migreringen, godkjenningene og historikken ligge. Ikke forsøk å slette eller
endre append-only-data, og ikke kjør en destruktiv down-migrering.
En feilregistrering håndteres med begrunnet tilbakekalling, ikke datavask.

### Observabilitet

Handlingene logger strukturerte hendelser for snapshotstart, registrering,
avslag og tilbakekalling. Metadata begrenses til repository-ID, leveranse-ID,
snapshot-/godkjennings-ID, avvisningskode og om tilbakekallingen endret noe.
NAV-identer, fritekst, begrunnelser, lenker, hash og evaluatorinput logges ikke.
Eksisterende HTTP-logging og tracing brukes; flyten gjør ingen eksterne API-kall.

Etter deploy: se etter uventede 5xx, økning i `stale_ground` eller
`incomplete_evidence` og tilgangsavslag som ikke samsvarer med teamrollene.
Kontroller samtidighetsfeil mot kode og DB-transaksjoner, ikke ved å slå av
valideringen eller logge personopplysninger. Revisjonshistorikken i databasen
er fasit for hvilke registreringer og tilbakekallinger som faktisk ble lagret.
Det innføres ikke nye Prometheus-metrikker eller automatiske alarmer i denne
første flyten.

## Validering

Målrettede tester dekker actions, tilgang, dataminimering, snapshot før
bekreftelse, valgte commits, tid, dokumentasjon, stale grunnlag, IDOR,
tilbakekalling, etterfølgende godkjenning og uendret deploymentstatus.
Storybook viser start, fryst grunnlag, utilgjengelige commits, manglende
tidsgrunnlag, etterfølgende godkjenning og tilbakekalling.

Kjør `pnpm run check`, `pnpm test`, `pnpm run knip`, `pnpm run build` og
`pnpm run build-storybook`. PostgreSQL-integrasjonstestene kan ved lokale
Testcontainers-problemer kjøres i en midlertidig Linux-container uten å endre
repoets tooling. Bruk `pool.query` ved polling av `pg_stat_activity`, ikke
transaksjonsklienten som holder et cached statistikksnapshot.
