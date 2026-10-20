# Manuell repositorygodkjenning

## Omfang

Den første manuelle flyten gjelder valgte commits i én repositoryleveranse.
Den supplerer repositoryets forhåndsvurdering, men endrer aldri deploymentstatus,
verifiseringshistorikk eller eksisterende PR-regler. Gamle appgodkjenninger importeres ikke.
`app/lib/verification/verify.ts` er uendret.

## Brukerflyt

1. Åpne **Manuell repositorygodkjenning** fra repositorysiden, eller bruk lenken
   fra en leveranses adminside når du har godkjenningsrett.
2. Se forhåndsvisningen av base/head, commits, forfatterkoblinger og lagret
   PR-grunnlag. GET lagrer ikke snapshots eller godkjenninger.
3. Bare commits med kjent PR-grunnlag uten PR-godkjenning kan godkjennes manuelt.
   PR-dekkede commits er markert, og ukjent PR-grunnlag kan ikke godkjennes.
   Egne commits, commits med ukjent forfatteridentitet og commits som allerede
   er godkjent manuelt, er heller ikke tilgjengelige for godkjenning.
4. Velg **Godkjenn manuelt** og legg eventuelt til en kommentar. Én innsending
   godkjenner alle kvalifiserte commits; brukeren velger ikke SHA-er eller
   tidspunkt. Registreringen får serverens tidspunkt.

Ved innsending beregner serveren grunnlaget og forfatterkoblingene på nytt.
Hvis de avviker fra forhåndsvisningen, avvises handlingen uten lagring. Snapshot,
godkjenning, commitkoblinger og opprettelseshendelse lagres atomisk. Reviewer og
registrator er den serverautentiserte NAV-identen.

## Tid og etterfølgende godkjenning

Registreringstidspunktet fastsettes av databasen og vises i historikken.
Git-committer-tid brukes ikke for å kreve at brukeren oppgir et separat reviewtidspunkt.

Review etter deployment er tillatt og merkes **Etterfølgende godkjenning – ikke
godkjent ved første deploy**. Første deployment beregnes over alle tilknyttede
deployments. Merket er ikke en beregning av godkjenningsstatus for senere
deployments. Registreringstidspunktet vises separat.

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
  tilbakekalle, men ikke se forhåndsvisningen eller registrere godkjenning.

Godkjenningssiden returnerer bare leveranseintervall, første deployment,
forhåndsvisning og en avgrenset historikk. Forhåndsvisningen viser ikke hele
evaluatorinputen eller interne identitetsversjoner. Ingen
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
- Kommentar er valgfri og lagres sammen med godkjenningen når den er oppgitt.
  Historiske dokumentasjonslenker kan fortsatt vises.
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
3. Kontroller at GET ikke lager snapshots. Sammenlign forhåndsvisningens
   intervall, PR-dekning og forfattere med det lagrede grunnlaget.
4. Godkjenn manuelt med og uten valgfri kommentar. Kontroller at bare commits
   uten kjent PR-dekning lagres.
5. Kontroller avslag for egne commits, PR-dekkede commits og ukjent PR-grunnlag.
6. Endre evidens eller forfatterkobling i et kontrollert testmiljø mellom
   forhåndsvisning og godkjenning. Kontroller at handlingen avvises uten
   snapshot eller godkjenning.
7. Kontroller merking etter deployment og begrunnet tilbakekalling.
8. Sammenlign deploymentstatus og verifiseringshistorikk før og etter handlingene;
   ingen av dem skal være endret.

Ved feil rulles applikasjonskoden tilbake til forrige image. La den additive
migreringen, godkjenningene og historikken ligge. Ikke forsøk å slette eller
endre append-only-data, og ikke kjør en destruktiv down-migrering.
En feilregistrering håndteres med begrunnet tilbakekalling, ikke datavask.

### Observabilitet

Handlingene logger strukturerte hendelser for registrering, avslag og
tilbakekalling. Metadata begrenses til repository-ID, leveranse-ID,
godkjennings-ID, avvisningskode og om tilbakekallingen endret noe.
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

Målrettede tester dekker actions, tilgang, dataminimering, forhåndsvisning uten
lagring, PR-dekkede commits, ukjent PR-grunnlag, godkjenning av udekkede commits,
stale grunnlag, IDOR, tilbakekalling, etterfølgende godkjenning og uendret
deploymentstatus. Storybook viser forhåndsvisning, utilgjengelige commits,
historikkanker, etterfølgende godkjenning og tilbakekalling.

Kjør `pnpm run check`, `pnpm test`, `pnpm run knip`, `pnpm run build` og
`pnpm run build-storybook`. PostgreSQL-integrasjonstestene kan ved lokale
Testcontainers-problemer kjøres i en midlertidig Linux-container uten å endre
repoets tooling. Bruk `pool.query` ved polling av `pg_stat_activity`, ikke
transaksjonsklienten som holder et cached statistikksnapshot.
