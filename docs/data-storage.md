# Datalagring og caching av GitHub-data

> **Målgruppe**: Utviklere.
>
> **Formål**: Dokumentere hvordan checks-data hentes, caches og vises på tvers av leveransetyper. Se [rådataarkiv](raw-data-archival.md) for hvordan de underliggende rå GitHub-svarene arkiveres langtidsholdbart, og [verifisering](verification.md) for selve fire-øyne-beslutningslogikken.

---

## Vurderingsmodell for rapporter

`audit_reports.assessment_model` og `report_jobs.assessment_model` skiller mellom
`application` og `repository`. Eksisterende rader og innsettinger uten modell får
`application`. Migreringen endrer ikke `report_data`, innholdshash, dokument-ID
eller lagrede filer.

Aktive rapporter er unike per applikasjon, vurderingsmodell, periodetype og
start-/sluttdato. Hver modell kan dermed ha sin egen aktive rapport for samme
periode. Dagens rapportgenerering skriver eksplisitt `application` og
erstatter bare aktive applikasjonsbaserte rapporter. Oppslag av rapporter og jobber
bruker `application` som standard; en annen modell må velges eksplisitt.
Applikasjonsprosessoren kan ikke overta en repositorybasert jobb.

Jobbkoden beholder dagens konfliktnøkkel og `idx_report_jobs_inflight` i dette
steget, slik at gammel og ny applikasjonsversjon kan opprette og gjenbruke jobber
under utrulling. En eksisterende jobb med en annen vurderingsmodell gir en
eksplisitt feil i stedet for å bli gjenbrukt. Indeksen hindrer foreløpig parallelle
jobber på tvers av modellene for samme applikasjon og periode.

Før repositorybasert generering aktiveres, må indeksen erstattes med en
modellavgrenset indeks og `ON CONFLICT` endres tilsvarende. Dette krever et eget
utrullingssteg; begge unikhetsindeksene skal ikke eksistere samtidig, fordi
samtidige innsettinger da kan feile på indeksen som ikke er konfliktmålet.

### Repositorybasert rapportgrunnlag

`getRepositoryAuditReportData()` bygger et separat, serialiserbart rapportgrunnlag
for én produksjonsapplikasjon og periode. App, deploymentutvalg, evidens,
identiteter og manuell historikk leses med samme klient i en read-only
`REPEATABLE READ`-transaksjon. Utvalget følger samme inklusive periodegrenser og
revisjonsstartår som dagens rapport, sortert på `(created_at, id)`.

Grunnlaget har formatversjon 1, verifiseringsversjon og vurderingstidspunkt fra
databasen. Hvert deployment beholder sin eksplisitte leveransekobling og
deploymentkilde. Hver unik kodeleveranse inkluderer stabil repository-ID,
GitHub-ID, låst base/head, normalisert GitHub-evidens, vurderingsresultat,
raw-snapshot-ID-er med hentetidspunkt, author-identiteter med versjoner og
manuell godkjenningshistorikk med snapshotreferanse, reviewer, registrator og
begge tidspunkt. Tilbakekalt og identitetsutdatert historikk beholdes, men gir
ikke dekning. Manglende leveransekobling beholdes som en mangel; samme SHA eller
appens nåværende repository brukes aldri til å erstatte koblingen.

Hvert deployment lagrer også gjeldende repositorytillatelse for applikasjonen
med koblings-ID og status. Oppslaget krever samme uforanderlige GitHub-ID og
deploymentets detekterte owner/name. Manglende kobling er ukjent, og bare status
`active` gir tillatelse; kodegodkjenning gir ikke repositorytillatelse.

Branch og trigger hentes fra lagret workflow-run-snapshot for deploymentets
trigger-URL, ikke fra `deployments.branch_name`, som kan inneholde PR-head.
Snapshotet må matche GitHub-repository-ID, run-ID og deploymentets fulle SHA.
En eksplisitt `/attempts/N` krever samme run-forsøk. Snapshot-ID, hentetidspunkt,
run-ID og forsøk kopieres inn i rapportgrunnlaget. Manglende eller avvikende
evidens gir ukjent branch/trigger uten fallback til PR-data eller HTTP-oppslag.

Vurderingen gjelder lagret grunnlag ved generering, inkludert etterkontroll.
Den sier ikke at godkjenning forelå ved deployment. Det normaliserte grunnlaget
kopieres inn i resultatet, slik at senere endringer i snapshots eller
godkjenningshistorikk ikke omskriver det tidligere resultatet.

`assessRepositoryAuditReadiness()` vurderer rapportklarhet separat fra kodedekning.
Manglende kobling, ufullstendig dekning og manglende godkjenning blokkerer.
`base=head` krever avklart baseline og teller ikke som godkjenning av tidligere
kode. Ukjent eller ikke tillatt repository, manuell workflow-trigger,
manglende trigger/branchgrunnlag eller avvik fra
repositoryets gjeldende default branch blokkerer også. Tom periode markeres
eksplisitt. Kriteriene bruker ikke `four_eyes_status` og endrer ikke dagens
applikasjonsbaserte rapportklarhet.

Databyggeren er ennå ikke koblet til rapportgenereringen. Den skriver ingen data
og gjør ingen HTTP-kall. Lagring av repositoryrapport, PDF/Excel og modellvalg i
UI/API gjenstår.

## Repositoryreferanse på deployments

`deployments.repository_id` er en nullable fremmednøkkel til `repositories.id`. Ved innsetting fylles den bare når deploymentens detekterte owner/name matcher både en repositorykobling for appen og en `repositories`-rad med samme `github_repo_id`. Koblingens godkjenningsstatus påvirker ikke identitetslagringen; verifisering og godkjenning er uendret. Oppslaget bruker ikke appens nåværende repository som fallback og gjør ingen GitHub-kall. Manglende kobling, ID eller navnematch gir `NULL`, inkludert historiske navn som ikke matcher repositoryets nåværende navn.

Eksisterende deployments endres ikke, heller ikke ved upsert. Tilbakefylling, utvidet identitetsoppløsning og indekser håndteres i senere steg. Fremmednøkkelen hindrer ugyldige referanser og sletting av et repository som er referert, uten å slette deployments.

Repositoryets deploymentliste og telling bruker lagret `repository_id` når den finnes. For `NULL` kreves en aktiv eller historisk appkobling som matcher deploymentens detekterte owner/name og repositoryets GitHub-ID. Navn som et annet repository har brukt, nå eller i registrert navnehistorikk, utelates fra dette fallback-oppslaget. Apper som har flyttet eller er inaktive, kan fortsatt bidra med historikk. Listens revisjonsgrense hentes fra repositoryet som vises, og deploymentbaserte filtervalg bruker samme repositoryavgrensning. Ingen rader tilbakefylles; øvrige sider og verifiseringsoppslag er uendret.

Repositorysiden har en valgfri SHA-visning (`view=sha`); deploymentlisten er fortsatt standard. Bare deployments som matcher filtrene grupperes etter full SHA innenfor repositoryet. Deployments med manglende eller tom SHA vises hver for seg. Grupper telles og pagineres før deploymentradene hentes, slik at samme SHA ikke deles mellom sider. Gruppene sorteres etter siste matchende deployment; tidspunkt og sekundær sorterings-ID hentes fra samme rad, valgt etter `(created_at DESC, id DESC)`. Visningen skriver ingen data og innfører ikke felles godkjenningsstatus eller handlinger; hver deployment beholder sin status og detaljlenke.

SHA-gruppene viser antall godkjente, ikke godkjente og ventende deployments etter eksisterende statuskategorier. Oppsummeringen gjelder bare viste deployments som matcher filtrene, ikke en felles godkjenning av SHA-en. Eventuelle ukjente statusverdier telles separat.

## Lagring av repositorykodeleveranser

`repository_code_deliveries` lagrer ordinære kodeintervaller med obligatorisk `repository_id`, `base_sha`, `head_sha` og opprettelsestidspunkt. Repositoryreferansen peker til `repositories.id` og hindrer sletting av refererte repositories. Begge SHA-er krever nøyaktig 40 heksadesimale tegn. Store og små bokstaver beholdes ved lagring, men unikhet for repository/head-SHA er uavhengig av bokstavstørrelse.

`getRepositoryCodeDelivery()` i `app/db/repository-code-deliveries.server.ts` slår opp en leveranse på repository-ID og head-SHA. `createRepositoryCodeDelivery()` lagrer et eksplisitt base-/head-intervall. Gjentatte og samtidige kall med samme intervall returnerer den eksisterende raden uten å endre SHA-er eller opprettelsestidspunkt. En annen base for samme repository/head gir `RepositoryCodeDeliveryConflictError` og endrer ikke leveransen. Begge oppslag og sammenligning av intervaller er uavhengige av bokstavstørrelse.

Lagringsfunksjonene velger ikke intervallet og brukes ikke av produksjonsflyten. Ingen leveranser opprettes automatisk eller tilbakefylles, og deployments, verifisering og godkjenning er uendret. Tabellen inneholder ikke baseline eller godkjenningsbeslutninger. Formatkontrollene beviser ikke at committene finnes, at base er en forfar til head eller at intervallet er gjennomgått. Lagringsfunksjonene endrer aldri eksisterende intervaller; tabellen har ingen trigger som hindrer direkte SQL-oppdateringer.

`deployments.repository_code_delivery_id` er en nullable fremmednøkkel til `repository_code_deliveries.id`, med en partiell indeks for oppslag av tilknyttede deployments. Indeksen inneholder bare rader hvor koblingen ikke er `NULL`. Flere deployments kan referere til samme kodeleveranse. Fremmednøkkelen hindrer ugyldige referanser og sletting av refererte kodeleveranser; sletting av et deployment sletter ikke kodeleveransen. Koblingen fylles ikke automatisk eller ved tilbakefylling og brukes ikke av produksjonsflyten. Fremmednøkkelen kontrollerer ikke at deploymentets repository-ID og SHA matcher kodeleveransens repository og head, og hindrer ikke omkobling.

`linkDeploymentToRepositoryCodeDelivery(deploymentId, deliveryId)` kobler et deployment til en eksisterende kodeleveranse i en transaksjon. Funksjonen låser deploymentet og kodeleveransen mens den kontrollerer at lagret repository-ID og full SHA matcher leveransens repository og head. SHA-sammenligningen er uavhengig av bokstavstørrelse. Den returnerer `true` når en tom kobling settes, og `false` når den samme gyldige koblingen allerede finnes. Manglende rader, identitetsavvik eller en annen eksisterende kobling gir feil uten å endre deploymentet. Samtidige kall kan ikke overskrive koblingen. Funksjonen oppretter ikke leveranser, velger ikke intervall og brukes ikke av produksjonsflyten. Kontrollen gjelder ved kobling; den hindrer ikke senere direkte SQL-endringer av identitet eller kobling.

Repository-adminer kan laste ned analysegrunnlag for alle åpne uavklarte deployments fra kodeleveransesiden, eller for et enkelt deployment fra den tilhørende raden. Hvert mål får de to nærmeste registrerte kodeleveransene før og etter deploytidspunktet når de finnes, og alle deployments knyttet til disse leveransene. Uttrekket inneholder lagrede `verification_runs` for inkluderte deployments, PR-/commit-snapshotene kjøringene refererer til, arkiverte workflow-run-snapshots fra deploymentenes trigger-URL-er, kandidatdata for ancestry-sammenligning og hele repositoryets `repo_config_audit_log`. I tillegg hentes relevante PR-metadata og full review-historikk, samt Actions-jobber og steg for workflow-run-ID-er fra inkluderte deployment-URL-er, direkte fra GitHub når eksporten lages. Workflow-evidensen registrerer ID-ene til deploymentene som refererer til hver run. Hvis trigger-URL-en angir `/attempts/N`, hentes jobbene for akkurat det forsøket; ellers hentes jobber for alle forsøk, og hvert jobbobjekt angir `runAttempt`. Live-evidensen inkluderer hentetidspunkt, kildehenvisning og eksplisitt status per PR/workflow; manglende eller utilgjengelige data skal ikke tolkes som tom review- eller jobbhistorikk. GitHub 404/410 beviser ikke at en ressurs aldri har eksistert; 404 kan også skyldes manglende tilgang. Eksporten stopper nye GitHub-kall når rate-limit-sikkerhetsgrensen nås og har en grense på 100 API-forespørsler per eksport; data som ikke ble hentet markeres eksplisitt. Databaseverdiene for repository-headeren, gjeldende `implicitApprovalMode`, auditloggen og lagrede evidensen leses i ett read-only `REPEATABLE READ`-snapshot; GitHub-kallene er separate live-oppslag og kan derfor ha et annet observasjonstidspunkt. Uttrekket krever repository-admin-tilgang. GitHub-reviewhistorikken beskriver nåværende tilgjengelig historikk, ikke i seg selv om reviewen tilfredsstilte NDA-verifisering på deploymenttidspunktet. Auditloggen viser bare registrerte endringer, og manglende oppføringer beviser ikke historisk innstilling, særlig før repositoryinnstillingen ble etablert eller når verdien ble initialisert ved backfill. Eksportformatet er versjonert som schema 4.

## Identitetsversjoner for brukere og GitHub-koblinger

`users.identity_version` og `user_github_accounts.identity_version` er databasehåndhevede versjoner for senere identitetssnapshots ved repositorygodkjenning. Eksisterende rader får en versjon ved migrering; eldre identitetsendringer kan ikke utledes fra denne.

En felles, ikke-syklisk PostgreSQL-sekvens tildeler nye versjoner ved innsetting, endret identitetsnøkkel, bytte av NAV-ident på en GitHub-kobling og overgang mellom aktiv og slettet rad. Sletting og gjenoppretting gir hver sin nye versjon. Fysisk sletting og nyoppretting gir også en ny versjon. Endringer i visningsnavn, Slack-data, `updated_at` eller andre profilfelt beholder versjonen. Triggere ignorerer eksplisitt innsendt `identity_version`; applikasjonen setter ikke versjonene selv. Sekvensen må ikke nullstilles eller gjenbrukes i drift.

`getGithubUserLookup(s)` returnerer `account_identity_version` og den aktive brukerens `user_identity_version` som strenger, slik at BIGINT ikke mister presisjon i JavaScript. Slettet eller manglende bruker gir `user_identity_version = null`; slettet kontokobling markeres fortsatt med `account_deleted_at`. Et fremtidig godkjenningsgrunnlag må lagre og kontrollere begge versjonene, aktiv status og NAV-ident. Brukerens versjon gjør sletting/gjenoppretting synlig uten å endre alle tilknyttede kontorader.

Versjoneringen brukes av lagringsgrunnlaget for manuell repositorygodkjenning nedenfor. Eksisterende vurdering og deploymentstatus er uendret.

## Lagringsgrunnlag for manuell repositorygodkjenning

`app/db/repository-manual-approvals.server.ts` tilbyr opprettelse av vurderingsgrunnlag, registrering av delgodkjenning, tilbakekalling og historikk. Skrivefunksjonene er koblet til en avgrenset godkjenningsflyt via POST-actions. Leveransens adminside viser historikk og tilbyr begrunnet tilbakekalling. Deploymentstatus er uendret, og eksisterende deploymentgodkjenninger importeres ikke. Se [brukerflyt, sikkerhet og utrulling](repository-manual-approval.md).

`repository_approval_snapshots` kopierer det normaliserte GitHub-grunnlaget og innstillingene som den rene intervallvurderingen bruker, med repository-ID, låst base/head, hash og format-/evaluatorversjon. Nye snapshots lagrer også NAV-identen som startet gjennomgangen; bare denne identiteten kan bekrefte snapshotten. `repository_approval_snapshot_commits` lagrer deklarert author-login, avklart NAV-ident og begge identitetsversjoner. Manglende identitet beholdes som ukjent; det finnes ingen fallback til navn, e-post, committer eller pusher.

`repository_manual_approvals` lagrer innlogget reviewer og registrator separat, men krever samme NAV-ident i denne første flyten. Tidspunktet fastsettes av databasen. Den nye godkjenningsflyten lagrer bare commits som mangler kjent PR-dekning, har en aktiv forfatterkobling og ikke allerede er godkjent manuelt; commits med ukjent PR-grunnlag avvises. Valgfri kommentar lagres i `review_documentation`. `repository_manual_approval_commits` binder godkjenningen til de kvalifiserte commitsene i akkurat dette grunnlaget. Flere delgodkjenninger kan dekke ulike commits; en reviewer kan ikke godkjenne egne commits. Reviewer trenger ikke GitHub-kobling.

Opprettelse og registrering bruker transaksjoner med `REPEATABLE READ`. Registrering kontrollerer gjeldende tilgang, komplett intervall, uendret vurderingsgrunnlag og aktive author-identiteter med samme NAV-ident og begge versjoner. Identitetsradene låses mot samtidige endringer. Ukjent PR-grunnlag kan ikke få manuell dekning. Godkjenning, commitkoblinger og `created`-hendelse lagres atomisk. Tilgang gis til Entra-admin eller brukere med aktiv teamrolle i et aktivt forvaltende team for minst én aktiv app med repositoryet som siste aktive kobling. Dette gir ikke i seg selv repositoryadminrett.

`repository_manual_approval_events` lagrer opprettelse og begrunnet tilbakekalling. Tilbakekalling krever repositoryadminrett og returnerer `false` hvis godkjenningen allerede er tilbakekalt. Alle fem tabeller avviser `UPDATE` og `DELETE`; originalt grunnlag og historikk bevares. «Restart sporing» avvises når repositoryet har lagrede godkjenningsgrunnlag, også uten registrerte delgodkjenninger. Sporingsdata og startdato beholdes uendret.

Evidenshashen bruker JSON med rekursivt sorterte objektnøkler, slik at den kan etterprøves etter JSONB-lagring; arrayrekkefølgen beholdes. Identitetslåsing tar brukerrader før kontorader, i samme rekkefølge som bruker-/kontooppdatering. Serialiseringsfeil og deadlock ved opprettelse eller registrering oversettes til `stale_ground`; andre databasefeil sendes videre.

Historikkoppslaget skiller mellom tilbakekalt, endret identitet/intervall og `eligible`. Sistnevnte betyr bare at den lagrede delgodkjenningen fortsatt har gyldig identitet og intervall, ikke at leveransen er godkjent. En senere vurdering må også kontrollere gjeldende evidens og kombinere uavhengige dekningskilder. Bytte og tilbakebytte av author-kobling eller sletting og gjenoppretting reaktiverer aldri gammel dekning. Historiske identiteter omskrives ikke, og uavhengige delgodkjenninger påvirkes ikke.

Leveransedetaljsiden kombinerer gyldige manuelle delgodkjenninger med gjeldende PR-dekning i den skrivebeskyttede forhåndsvurderingen. Evidens, author-identiteter og godkjenningshistorikk leses i samme read-only `REPEATABLE READ`-transaksjon. Ukjent PR-grunnlag og ufullstendig commit-historikk gir fortsatt ikke manuell dekning. Tilbakekalt eller identitetsutdatert dekning utelates, uten å påvirke uavhengig PR-dekning. Historikken viser reviewer, registrator, begge tidspunkt, dokumentasjon, lagrede author-identiteter og begrunnede tilbakekallinger; den sender ikke snapshotenes fulle evidens eller identitetsversjoner til klienten. Review etter første tilknyttede deployment merkes som etterfølgende godkjenning, ikke godkjent ved første deploy. Godkjenning startes og registreres på en egen side; ingen GET oppretter godkjenninger eller snapshots, og deploymentstatus endres ikke.

Detaljsiden leser historikk med repository-adminrett, også når appkoblingene bare er historiske. Dette gir ikke rett til å registrere nye godkjenninger; skrivefunksjonene krever fortsatt godkjenningsrett via aktive appkoblinger eller Entra-admin.

## Checks — samlet kilde for alle leveransetyper

GitHub Checks API (`checks.listForRef`) fungerer mot en vilkårlig commit-SHA, uavhengig av om commiten er del av en PR eller ikke. Derfor hentes check runs alltid mot `deployment.commit_sha` og lagres i `deployments.commit_checks_data` — dette gjelder **alle** leveransetyper (pull request, direct push og eventuelt andre), ikke bare direct push. Dette er **kun visningsdata** — check-status påvirker ikke fire-øyne-godkjenningsstatusen.

`github_pr_data.checks`/`checks_passed`/`checks_ref` hentes ikke lenger aktivt (`getDetailedPullRequestInfo` setter disse til `null`/`[]` ved nye synkroniseringer), men beholdes i typen og databasen som **legacy fallback** for leveranser som ble synkronisert før denne omleggingen. UI (`PrDetailsAccordion.tsx`) viser `commit_checks_data.checks` når det finnes data der, og faller kun tilbake til `github_pr_data.checks` for eldre rader uten `commit_checks_data`. `buildGithubPrDataFromSnapshots()` regner kun `checks_passed` ut fra checks-snapshoten når den faktisk har check runs (`checkRuns.length > 0`) — ellers blir feltet `null` (ukjent), ikke `false` (siden en tom-men-ikke-null snapshot uten dette forbeholdet ellers ville blitt tolket som «alle checks feilet»).

I `DeploymentDetailsGrid.tsx` vises checks-taggen («Checks OK»/«Checks failed») uavhengig av om leveransen har `github_pr_data` eller ikke, slik at direct push-leveranser (som aldri har `github_pr_data`) også får den samme statusindikatoren som pull request-leveranser.

Admin-jobben «Hent data for alle deployments» (`fetchVerificationDataForAllDeployments()`) backfiller `commit_checks_data` for eksisterende deployments: for deployments som allerede har PR- og compare-snapshot, men mangler `commit_checks_data`, hentes kun checks (`fetchCommitChecks()` + `updateDeploymentCommitChecks()`) uten å kjøre hele den tunge verifiseringshentingen på nytt.

GitHub returnerer 404 uansett om en ressurs mangler eller om vi mangler tilgang til den (samme som web-UI, bevisst for å ikke lekke at private ressurser eksisterer) — de to tilfellene kan derfor ikke skilles pålitelig fra hverandre. `fetchCommitChecks()` fanger alle feil uten å skille på statuskode og returnerer `undefined`, slik at `COALESCE` i `updateDeploymentVerification()`/`updateDeploymentCommitChecks()` beholder eksisterende `commit_checks_data` i stedet for å overskrive med tomt resultat. Samme `undefined`-retur brukes også når GitHub svarer OK med 0 check runs for en commit som tidligere har hatt checks — siden checks for en gitt SHA i praksis ikke bør forsvinne uten at det skyldes et forbigående problem, tapt tilgang, eller at GitHubs egen retention har rotert bort dataene, ville en overskriving her risikert å slette allerede lagrede checks (arkivet i `github_commit_snapshots` er upåvirket uansett, siden det kun skrives ved vellykket henting).

> **Koderef**: `fetchCommitChecks()` i [`app/lib/verification/fetch-data/commit-checks.server.ts`](../app/lib/verification/fetch-data/commit-checks.server.ts), `getChecksForCommit()` i [`app/lib/github/pr/checks.server.ts`](../app/lib/github/pr/checks.server.ts). Loggcache for check-logger (`app/lib/sync/log-cache.server.ts`) leser fra begge kolonner.

### Fallback til PR-ens head-SHA

Noen repositories kjører CI kun på `pull_request`-events, slik at check-runs er festet til PR-ens head-SHA og ikke til merge-/push-commiten som faktisk deployes. `getChecksForCommit()` prøver derfor `deployment.commit_sha` først, og — hvis 0 check runs finnes der — retter et nytt kall mot PR-ens `head_sha` (hentet fra PR-metadata-snapshotet). `checked_sha` i `commit_checks_data` reflekterer hvilken SHA som faktisk hadde treff.

### Filtrering på check_suite_id — kun checks fra leveransens egen workflow-run

`checks.listForRef(ref=sha)` returnerer **alle** check runs GitHub noensinne har knyttet til den eksakte commit-SHA-en, uavhengig av hvilken check suite/workflow-run som produserte dem. I praksis kan dette inkludere helt urelaterte check runs — for eksempel har vi observert Dependabot-relaterte workflows (typisk via `pull_request_target`, som kjører i kontekst av base-branchen) som rapporterer status mot base-branchens HEAD-SHA i stedet for PR-ens egen head-SHA. Så lenge en commit forblir tippen av `main`, akkumuleres slike urelaterte check runs fra hver Dependabot-PR som ble håndtert i det tidsrommet — og vises da feilaktig som om de tilhørte selve leveransen.

For å isolere kun de check runs som faktisk stammer fra workflow-runen som utførte leveransen, hentes `check_suite_id` for `deployment.trigger_url` sin workflow-run (via `client.actions.getWorkflowRun()` — samme mekanisme som allerede brukes for `getWorkflowTriggerConfig()`/`getBranchFromWorkflowRun()`, og caches nå sammen med resten av `workflow_trigger_config` for å unngå et ekstra GitHub-kall ved hvert forsøk). `fetchChecksForRefs()` filtrerer deretter de rå check runs på `check_suite.id === checkSuiteId` **før** annotasjoner hentes (sparer unødvendige `listAnnotations`-kall for check runs som uansett filtreres bort).

Filtreringen har en fail-safe: matcher **ingen** check runs det oppløste `check_suite_id`-et (f.eks. fordi `trigger_url` peker til en workflow-run uten egne check runs, eller `check_suite`-feltet mangler av andre grunner), beholdes det ufiltrerte resultatet i stedet for å returnere tomt — for å unngå å skjule reelle checks ved usikker oppløsning. Mangler `trigger_url`, eller feiler `getWorkflowRun()`-kallet, faller filtreringen helt bort og alt `listForRef` returnerer vises (samme oppførsel som før denne endringen) — dette dekker eldre deployments uten `trigger_url` og repositories/apper der NAIS-triggeren ikke kan slås opp.

Fallback-forsøket mot PR-ens head-SHA (over) bruker bevisst **ikke** samme `check_suite_id`-filter: det forsøket eksisterer nettopp for CI som kjører på en annen SHA (og dermed annen check suite) enn selve leverings-workflowen, så en `check_suite_id`-scoping ville motvirket hensikten med fallback-en.

> **Koderef**: `filterCheckRunsByCheckSuite()`/`fetchChecksForRefs()` i [`app/lib/github/pr/checks.server.ts`](../app/lib/github/pr/checks.server.ts), `WorkflowTriggerConfig.checkSuiteId` i [`app/lib/github/git.server.ts`](../app/lib/github/git.server.ts) (schema-versjon 3), `resolveCheckSuiteId()` i [`app/lib/verification/fetch-data/commit-checks.server.ts`](../app/lib/verification/fetch-data/commit-checks.server.ts).

### Ikke overskriv legacy PR-checks med tomt resultat

`getDetailedPullRequestInfo()` setter alltid `checks_passed: null`/`checks: []` (PR-checks hentes ikke lenger derfra), men den returnerte `PrChecks`-snapshoten er likevel et non-null objekt (`{ conclusion: null, checkRuns: [] }`). `buildGithubPrDataFromSnapshotsForPr()` sjekker derfor eksplisitt om den ferske checks-snapshoten faktisk har innhold (`checkRuns.length > 0`); hvis ikke, og det finnes en eksisterende `github_pr_data.checks` fra før denne omleggingen, beholdes de gamle `checks`/`checks_passed`/`checks_ref`-feltene i stedet for å bli overskrevet med et tomt resultat.

### Pågående (ikke-fullførte) check runs regnes ikke som feilet

`computeChecksPassed()` (`app/lib/github/checks-snapshot.ts`, gjenbrukt av både `fetchChecksForRefs()` og `parseCheckRunsSnapshot()`) returnerer `null` (ukjent/pågår) hvis noen check run har `status !== 'completed'` — f.eks. `queued` eller `in_progress`. GitHub setter `conclusion: null` frem til en check run er ferdig, så uten dette forbeholdet ville en `.every(conclusion === 'success' || 'skipped')`-sjekk feilaktig regnet en pågående check som «feilet» (siden `null !== 'success'`). UI viser dermed ingen tag (`checksPassed === null`) mens CI fortsatt kjører, i stedet for en misvisende «Checks failed»-tag.

### Konvergens i bulk-backfill

`fetchVerificationDataForAllDeployments()` brukte opprinnelig `commit_checks_data IS NOT NULL` for å avgjøre om checks allerede var hentet for en deployment. For commits som reelt sett har 0 check runs, forblir kolonnen `NULL` (per fail-safe-designet over), så jobben ville forsøkt å hente checks på nytt for de samme deploymentene hver eneste gang «Hent data for alle deployments» kjøres — uten å konvergere. Kolonnen `deployments.commit_checks_checked_at` sporer i stedet *når et forsøk sist ble fullført* (uavhengig av om checks ble funnet), og settes kun ved et vellykket API-kall — ikke ved forbigående feil, slik at ekte feil fortsatt gir retry neste kjøring.

`attempted`/`commit_checks_checked_at` settes kun når resultatet faktisk er **definitivt** (`isChecksResultDefinitive()` i `app/lib/github/checks-snapshot.ts`: alle check runs har `status === 'completed'`, eller det ikke finnes noen check runs i det hele tatt). Fanges checks fortsatt pågående (`in_progress`/`queued`) midt i en synkronisering, er resultatet *ikke* definitivt — `attempted` settes derfor til `false` selv om API-kallet i seg selv lyktes, slik at neste kjøring av «Hent data for alle deployments» forsøker på nytt i stedet for å fryse `checks_passed: null` permanent. Selve check-dataene skrives likevel til `commit_checks_data` for visning (se under), kun tidsstempelet for konvergens utsettes.

### Periodisk reverifisering av ventende checks etter at four-eyes-status er avgjort

`verifyDeploymentsFourEyes()` (kjøres automatisk hvert 5. minutt per app via `runPeriodicSync()`) plukker kun deployments hvor `four_eyes_status` er `pending`, `pending_baseline`, `unknown` eller `error` (`REVERIFIABLE_STATUSES` + `error`). En deployment hvor statusen allerede er avgjort (f.eks. `approved_pr`, `direct_push`, `unverified_commits`) blir aldri plukket opp igjen av denne jobben, siden statusen ikke endrer seg. Check-data påvirker ikke `four_eyes_status` (se over), så en deployment kan få avgjort status *før* checks er ferdige — uten en egen mekanisme ville checks for slike deployments aldri blitt hentet på nytt automatisk, selv om de fortsatt var `in_progress`/`queued` på GitHub.

`reverifyPendingChecks()` (`app/lib/sync/github-verify.server.ts`, kalt fra `runPeriodicSync()` som et eget periodisk steg med samme 5-minutters syklus via `withSyncLock('checks_reverify', ...)`) dekker dette komplementære settet: deployments med `commit_checks_checked_at IS NULL` (ikke-definitivt resultat) og en **allerede avgjort** `four_eyes_status`. Den kaller kun `refreshCommitChecksOnly()` (checks alene, ikke hele verifiseringspipelinen) for hver match.

GitHub gir ingen signal for «denne check-runen vil aldri fullføre» — en check run kan i prinsippet forbli `queued`/`in_progress` for alltid (f.eks. en forlatt self-hosted runner, eller en tredjeparts GitHub App-integrasjon som aldri poster en endelig status). Det finnes derfor ingen definitiv måte å avgjøre dette fra APIet alene. Som en pragmatisk grense stoppes automatisk polling når deploymentet er eldre enn `CHECKS_REVERIFY_GIVE_UP_MS` (24 timer): GitHub Actions håndhever selv en standard 6-timers per-jobb-timeout (kan konfigureres opp til 35 dager), så en reell, fortsatt kjørende CI-jobb bør konvergere godt innenfor et døgn — alt eldre enn det regnes som forlatt og forsøkes ikke lenger automatisk. Grensen er ikke lagret som egen tilstand; den beregnes på spørretidspunktet (`d.created_at > now() - 24h`), så raden slutter ganske enkelt å bli plukket opp av spørringen når vinduet passeres — ingen «gi opp»-flagg trengs. Manuell «Verifiser på nytt» (`forceRefresh: true`) og admins «Hent data for alle deployments» er upåvirket av denne grensen og kan alltid hente på nytt manuelt.

### Cache-treff hopper over live-kall til GitHub

`fetchVerificationData()` konsulterte tidligere alltid GitHub live for checks, uavhengig av om `commit_checks_data` allerede var hentet ferdig for gjeldende commit — i motsetning til PR-/compare-/workflow-trigger-data, som alle har en tilsvarende cache-sjekk før live-kall. Dette resulterte i unødvendige GitHub-kall og dupliserte arkivrader (`github_commit_snapshots`) ved hver reverifisering, selv når resultatet allerede var definitivt. `getCachedCommitChecks()` (ny, i `app/lib/verification/fetch-data/commit-checks.server.ts`) sjekker nå `commit_checks_data`/`commit_checks_checked_at` på deployment-raden først; er dataene allerede hentet (`commit_checks_checked_at IS NOT NULL`), gjenbrukes de i stedet for et nytt API-kall — med mindre `options?.forceRefresh` er satt (samme brukerstyrte overstyring som for de andre datakildene).

### Isolert annotasjons-feil per check run

`fetchChecksForRefs()` hentet tidligere annotasjoner (`listAnnotations`) for hver check run i samme uthevede kodeblokk som selve `listForRef`-kallet; feilet ett enkelt `listAnnotations`-kall (f.eks. midlertidig rate-limit), forkastet dette hele den ellers vellykkede check-run-fangsten for *alle* checks på commiten, og satte `attempted: false` permanent (endeløs retry med samme feil). Annotasjons-hentingen er nå isolert per check run i egen `try/catch`: feiler den for én check run, settes `annotationsFetchFailed: true` og `annotations: null` kun for den ene, mens resten av fangsten (inkludert alle andre check runs) beholdes og lagres som normalt.

### Konsistent kilde-valg mellom Grid og Accordion

`DeploymentDetailsGrid.tsx` sin checks-tag valgte tidligere kilde via nullish-coalescing på `checks_passed` (`commit_checks_data?.checks_passed ?? github_pr_data?.checks_passed`), mens `PrDetailsAccordion.tsx` valgte kilde via om det faktisk fantes check runs. Dette kunne vise en foreldet «Checks OK»-tag fra `github_pr_data` i Grid samtidig som Accordion viste en fersk, fortsatt pågående check-liste rett under. Grid bruker nå samme regel som Accordion: har `commit_checks_data.checks` minst én check run, brukes `commit_checks_data.checks_passed` (også når den er `null`, dvs. ingen tag vises); `github_pr_data.checks_passed` brukes kun som fallback når det ikke finnes noen ferske check runs i det hele tatt.

### Checks-data er objektive og påvirkes ikke av manuell godkjenning

`updateDeploymentCommitChecks()` har bevisst **ikke** samme `PROTECTED_STATUSES`-vakt som `updateDeploymentVerification()`. Check-data har kun én kilde (GitHub) og er rent visningsdata — verken `verify.ts` eller `four-eyes-status.ts` leser `commit_checks_data`/`commit_checks_checked_at` noe sted, så disse feltene kan ikke påvirke fire-øyne-status eller godkjenningslogikk. Det skal derfor fortsatt være mulig å hente og oppdatere checks for en leveranse selv om den er `manually_approved`, `baseline` eller `legacy` — å blokkere dette ville kun ha ført til at UI viser utdaterte/manglende check-data for allerede godkjente leveranser, uten noen tilsvarende sikkerhetsgevinst.

### Langtidsarkivering av checks-data (11 år)

Deployments må kunne vises korrekt i inntil 11 år, men GitHub sletter/roterer check-run-data etter en kortere periode og lar oss ikke hente på nytt. `deployments.commit_checks_data` er derfor kun en **derivert lesecache** (rask visning i UI), ikke arkivet. Selve arkivet er append-only rader i `github_commit_snapshots` (`data_type = 'checks'`), skrevet via `saveCommitSnapshot()` hver gang checks hentes — aldri overskrevet.

Rådata som lagres i snapshotet (`ChecksSnapshotData` i `app/lib/github/checks-snapshot.ts`) er GitHubs check-run- og annotasjons-objekter i tilnærmet rå form, ikke bare feltene som brukes i dagens UI. Dette unngår at fremtidige UI-/typebehov mangler data som kunne vært lagret, men ikke ble det (se historikk: PR-checks sine `annotations` ble tidligere hentet, men aldri lagret noe sted). Snapshotet har et eget `schemaVersion`-felt (`CHECKS_SNAPSHOT_SCHEMA_VERSION`), uavhengig av det globale `CURRENT_SCHEMA_VERSION`-tallet som styrer ferskhet/re-fetch. `parseCheckRunsSnapshot()` tolker rådata basert på dette feltet — når `CheckRun`-typen endres i fremtiden, økes `CHECKS_SNAPSHOT_SCHEMA_VERSION` og det legges til en ny `case` i parseren, uten å røre allerede lagrede rader.

`app/lib/__tests__/checks-snapshot-compat.test.ts` fryser et eksempel på schema v1-payload og verifiserer at parseren fortsatt kan tolke det — denne testen skal ikke endres når skjemaet utvides, kun suppleres med nye versjoner.

GitHub sin REST API er selv date-versjonert (`X-GitHub-Api-Version`), med en stabil default (`2022-11-28` per i dag) som GitHub aktivt migrerer uversjonerte klienter videre fra ved behov. Vi pinner **ikke** en eksplisitt versjon — det ville krevd aktiv fornyelse før 24-måneders støttevinduet utløper, med fare for et hardt `410 Gone`-brudd om det glemmes, og additive endringer (nye felt) gjelder uansett alle versjoner samtidig. I stedet leser `fetchChecksForRefs()` responsheaderen `X-GitHub-Api-Version-Selected` og lagrer den i `ChecksSnapshotData.githubApiVersion` — rent observasjonelt, slik at enhver arkivert rad kan spores tilbake til nøyaktig hvilken GitHub API-versjon som produserte den. `Deprecation`/`Sunset`-responsheadere logges som advarsel dersom de dukker opp.

> **Koderef**: `app/lib/github/checks-snapshot.ts` (`ChecksSnapshotData`, `parseCheckRunsSnapshot`, `mapRawCheckRunToCheckRun`), `saveCommitSnapshot()`-kallet i `fetchCommitChecks()` ([`app/lib/verification/fetch-data/commit-checks.server.ts`](../app/lib/verification/fetch-data/commit-checks.server.ts)), `github_commit_snapshots`-tabellen ([`app/db/migrations/1770090000000_add-github-snapshots.sql`](../app/db/migrations/1770090000000_add-github-snapshots.sql)).
