# M2M API: Leveranserapporter (Audit Reports)

API for programmatisk tilgang til leveranserapporter. Brukes av KISS og andre
revisjonsverktøy for å hente revisjonsbevis.

## Autentisering

Alle endepunkter krever M2M-token (NAIS token exchange):

```
Authorization: Bearer <token>
```

Tokenet valideres via NAIS token introspection. Krever rollen
`access_as_application`.

## Basis-URL

```
/api/v1/apps/{team}/{env}/{app}/audit-reports
```

**Merk:** Kun produksjonsmiljøer (`prod-fss`, `prod-gcp`) er støttet.
Andre miljøer returnerer `400`.

## Periodetyper

| `periodType` | Norsk        | Perioder per år | Startmåneder         |
| ------------ | ------------ | --------------- | -------------------- |
| `yearly`     | Årlig        | 1               | januar               |
| `tertiary`   | Tertialsvis  | 3 (T1, T2, T3)  | januar, mai, sep     |
| `quarterly`  | Kvartalsvis  | 4 (Q1–Q4)       | jan, apr, jul, okt   |
| `monthly`    | Månedlig     | 12              | hver måned           |

**Viktig:** `periodEnd` og `periodLabel` utledes server-side fra `periodType`
og `periodStart`. Klienten sender kun `periodType` og `periodStart`.

Periodedatoer bruker **lokal tid (Oslo)**, konsistent med NDA sin interne
periodeberegning.

## Felles typer

### AppMetadata

Inkludert i alle responser.

```json
{
  "team": "pensjon",
  "environment": "prod-gcp",
  "name": "my-app",
  "auditStartDate": "2024-01-01",
  "applicationGroup": {
    "name": "Min Pensjon",
    "apps": [
      { "team": "pensjon", "environment": "prod-gcp", "name": "my-app" },
      { "team": "pensjon", "environment": "prod-fss", "name": "my-app-fss" }
    ]
  }
}
```

- `auditStartDate`: `null` betyr ingen periodebegrensning
- `applicationGroup`: `null` hvis appen ikke tilhører en gruppe. Grupper er
  flat — alle apper i en gruppe er peers (ikke hierarkisk som i KISS).

### ReportSummary

```json
{
  "reportId": "AUDIT-2025-my-app-prod-gcp-a1b2c3d4-e5f6a7b8c9d0",
  "periodType": "yearly",
  "periodLabel": "2025",
  "periodStart": "2025-01-01",
  "periodEnd": "2025-12-31",
  "generatedAt": "2025-06-01T12:00:00.000Z",
  "generatedBy": "dev-gcp:teamkiss:kiss",
  "totalDeployments": 142,
  "approvedCount": 138,
  "withChangeOriginCount": 120,
  "contentHash": "a1b2c3d4e5f6a7b8",
  "availableFormats": ["pdf"]
}
```

- `generatedBy`: NAV-ident (bruker) eller fullt kvalifisert M2M-appnavn.
  `null` for eldre rapporter.
- `withChangeOriginCount`: Antall leveranser med endringsopphav (ekskl.
  Dependabot). `null` for eldre rapporter uten denne dataen.
- `availableFormats`: Per nå alltid `["pdf"]`. Vil inkludere `"xlsx"` når
  Excel-støtte legges til.

## Endepunkter

---

### 1. GET `/`

List alle aktive rapporter (ikke-arkiverte, ikke-erstattede).

**Respons:** `200`

```json
{
  "app": { "...AppMetadata" },
  "reports": [ { "...ReportSummary" } ]
}
```

---

### 2. GET `/status`

Sjekk leveransestatus for en periode og eventuelle eksisterende rapporter.

**Query-parametere (påkrevd):**

| Parameter     | Type   | Eksempel     | Beskrivelse                       |
| ------------- | ------ | ------------ | --------------------------------- |
| `periodType`  | string | `yearly`     | Se periodetyper over              |
| `periodStart` | date   | `2025-01-01` | Første dag i perioden (ISO 8601)  |

**Validering:**
- Perioden må være fullstendig avsluttet
- `periodStart` må matche en gyldig periodegrense
- `periodStart` kan ikke være før `auditStartDate`

**Respons:** `200`

```json
{
  "app": { "...AppMetadata" },
  "period": {
    "type": "yearly",
    "label": "2025",
    "start": "2025-01-01",
    "end": "2025-12-31"
  },
  "deployments": {
    "total": 142,
    "approved": 138,
    "pending": 2,
    "notApproved": 2,
    "approvedPercent": 97.2,
    "withChangeOrigin": 120,
    "changeOriginPercent": 85.7
  },
  "existingReports": [ { "...ReportSummary" } ],
  "availableFormats": ["pdf"]
}
```

---

### 3. POST `/generate`

Bestill generering av en ny rapport.

**Request body (JSON):**

```json
{
  "periodType": "yearly",
  "periodStart": "2025-01-01",
  "format": "pdf",
  "reason": "Oppdatert rapport etter korrigering av leveransedata"
}
```

| Felt          | Påkrevd | Default | Beskrivelse                                |
| ------------- | ------- | ------- | ------------------------------------------ |
| `periodType`  | Ja      |         | Periodetype                                |
| `periodStart` | Ja      |         | Startdato                                  |
| `format`      | Nei     | `pdf`   | Kun `pdf` støttes per nå                   |
| `reason`      | Betinget|         | Påkrevd ved erstatning av eksisterende rapport |

**Deduplikering:** Hvis det finnes en eksisterende jobb (pending/processing/completed)
for samme app og periode, returneres den i stedet for å opprette ny (`200`). Unntak:
dersom `reason` er oppgitt og eksisterende jobb er `completed`, forbigås deduplikering
og en ny jobb opprettes for å erstatte den eksisterende rapporten.

**Respons (ny jobb):** `202`

```json
{
  "app": { "...AppMetadata" },
  "jobId": "uuid-...",
  "status": "pending",
  "reportId": null,
  "message": "Report generation started"
}
```

**Respons (eksisterende jobb):** `200`

```json
{
  "app": { "...AppMetadata" },
  "jobId": "uuid-...",
  "status": "completed",
  "reportId": "AUDIT-2025-...",
  "message": "Existing job returned"
}
```

**Feil:** `409` hvis det finnes en aktiv rapport for perioden og `reason` ikke
er oppgitt.

---

### 4. GET `/jobs/{jobId}`

Sjekk status på en rapportgenereringsjobb.

**Respons (pending/processing):** `200`

```json
{
  "app": { "...AppMetadata" },
  "jobId": "uuid-...",
  "status": "processing",
  "createdAt": "2025-06-01T12:00:00.000Z",
  "completedAt": null,
  "error": null,
  "reportId": null,
  "report": null
}
```

Header: `Retry-After: 10`

**Respons (completed):** `200`

```json
{
  "app": { "...AppMetadata" },
  "jobId": "uuid-...",
  "status": "completed",
  "createdAt": "2025-06-01T12:00:00.000Z",
  "completedAt": "2025-06-01T12:01:23.000Z",
  "error": null,
  "reportId": "AUDIT-2025-...",
  "report": {
    "reportId": "AUDIT-2025-...",
    "generatedAt": "...",
    "generatedBy": "dev-gcp:teamkiss:kiss",
    "totalDeployments": 142,
    "approvedCount": 138,
    "withChangeOriginCount": 120,
    "contentHash": "...",
    "availableFormats": ["pdf"]
  }
}
```

**Respons (failed):** `200`

```json
{
  "app": { "...AppMetadata" },
  "jobId": "uuid-...",
  "status": "failed",
  "createdAt": "...",
  "completedAt": null,
  "error": "Error message here",
  "reportId": null,
  "report": null
}
```

---

### 5. GET `/{reportId}/download`

Last ned rapporten som PDF.

**Query-parametere:**

| Parameter | Påkrevd | Default | Beskrivelse                  |
| --------- | ------- | ------- | ---------------------------- |
| `format`  | Nei     | `pdf`   | Kun `pdf` støttes per nå     |

**Respons:** `200` (binary)

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="AUDIT-2025-my-app-prod-gcp-a1b2c3d4-e5f6a7b8c9d0.pdf"
Content-Length: 123456
```

**Tilgangskontroll:**
- Rapporten må tilhøre appen (IDOR-beskyttelse)
- Arkiverte rapporter: `404`
- Erstattede (superseded) rapporter: **tillatt** (gyldig historisk bevis)

---

## Feilresponser

Alle feil returnerer JSON:

```json
{ "error": "Description of the error" }
```

| Status | Betydning                                                   |
| ------ | ----------------------------------------------------------- |
| `400`  | Ugyldig input (manglende parametere, feil format, ikke-prod)|
| `401`  | Ugyldig eller manglende M2M-token                           |
| `403`  | Token mangler påkrevd rolle (`access_as_application`)       |
| `404`  | App, rapport eller jobb ikke funnet                         |
| `409`  | Aktiv rapport finnes, `reason` ikke oppgitt                 |

## Bruksflyt

```
1. GET /status?periodType=yearly&periodStart=2025-01-01
   → Sjekk antall leveranser og eksisterende rapporter

2. POST /generate  { periodType, periodStart }
   → Bestill rapport (202 med jobId)

3. GET /jobs/{jobId}  (poll hvert 10s via Retry-After)
   → Sjekk status til completed

4. GET /{reportId}/download
   → Last ned PDF
```

## Applikasjonsgrupper

NDA bruker flat gruppering av apper (peers, ikke hierarkisk). Grupper brukes
for å propagere verifikasjons-status på tvers av klynger
(f.eks. `prod-gcp` + `prod-fss` for samme app).

Alle API-responser inkluderer `applicationGroup` med navn og liste over alle
apper i gruppen. `null` hvis appen ikke tilhører en gruppe.

KISS bruker hierarkisk gruppering — KISS sin `parent/child`-modell er ikke
direkte mappbar til NDA sin flate modell. KISS må selv avgjøre hvordan NDA sine
grupper passer inn i sin struktur.
