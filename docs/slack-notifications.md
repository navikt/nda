# Slack-varsling ved deployment

> **Målgruppe**: Utviklere.
>
> **Formål**: Dokumentere hvorfor initiell/historisk synkronisering av en applikasjon ikke fører til at det sendes ut Slack-varsler for tusenvis av gamle deploys, selv om varsling slås på før eller under synkroniseringen.

## Tidsstempel-gating: `slack_deploy_notify_enabled_at` / `slack_notifications_enabled_at`

Både «ny deployment»-varsling (`slack_deploy_notify_enabled`/`slack_deploy_notify_enabled_at`) og den eldre generelle Slack-varslingen (`slack_notifications_enabled`/`slack_notifications_enabled_at`) bruker samme mønster: et eget `_enabled_at`-tidsstempel settes til `CURRENT_TIMESTAMP` idet en admin faktisk skrur på varslingen (`updateMonitoredApplication()` i [`app/db/monitored-applications.server.ts`](../app/db/monitored-applications.server.ts)), samt som en engangs-backfill for apper som allerede hadde varsling aktivert før dette tidsstempelfeltet ble innført (migrasjonen [`1771100000000_add-slack-enabled-at.sql`](../app/db/migrations/1771100000000_add-slack-enabled-at.sql)). Spørringene som plukker opp deploys for varsling krever eksplisitt at deploymentets `created_at` er nyere enn eller lik dette tidsstempelet:

```sql
-- app/db/deployments/notifications.server.ts
AND ma.slack_deploy_notify_enabled_at IS NOT NULL
AND d.created_at >= ma.slack_deploy_notify_enabled_at
```

> **Koderef**: `getDeploymentsNeedingDeployNotify()` og `_getDeploymentsNeedingSlackNotification()` i [`app/db/deployments/notifications.server.ts`](../app/db/deployments/notifications.server.ts), `updateMonitoredApplication()` i [`app/db/monitored-applications.server.ts`](../app/db/monitored-applications.server.ts), migrasjonen [`1771100000000_add-slack-enabled-at.sql`](../app/db/migrations/1771100000000_add-slack-enabled-at.sql).

## Hvorfor dette er trygt selv ved sen/pågående synkronisering

Det avgjørende er at `deployments.created_at` **ikke** er tidspunktet raden ble satt inn i vår database under synkronisering — det er NAIS sitt eget, historiske `createdAt`-felt for deploymentet, kopiert 1:1 inn ved oppretting:

```ts
// app/lib/sync/nais-sync.server.ts
createdAt: new Date(naisDep.createdAt),
```

Siden `_enabled_at` alltid settes til et tidspunkt i fortiden eller «nå» — enten når det faktisk blir satt (idet en admin skrur på varsling, eller retroaktivt via backfill-migrasjonen), aldri i fremtiden — avgjøres varsling utelukkende av hvorvidt deploymentets ekte, historiske NAIS-tidspunkt faktisk ligger før eller etter `_enabled_at`, uavhengig av når raden faktisk settes inn i databasen under synkronisering. Innsettingsrekkefølge og -tidspunkt under synkroniseringsjobben er dermed irrelevant for denne sjekken; kun deploymentets ekte, historiske tidspunkt avgjør. Konkret for det opprinnelige spørsmålet: så lenge de historiske deploysene som skal backfilles for en nylig lagt til applikasjon faktisk fant sted *før* varsling ble slått på for den appen, vil de aldri trigge varsling — selv om varsling slås på midt under en pågående initiell synkronisering, eller raden settes inn i databasen lenge etter at varsling ble aktivert. Det er ikke mulig for en admin å skru på varsling *før* et gammelt deploy fant sted i NAIS (det ville kreve tidsreise), så dette dekker nettopp scenarioet med tusenvis av gamle deploys for en nylig lagt til applikasjon.

Som en ekstra skranke filtreres det uansett kun på deploys fra de siste 7 dagene (`d.created_at > NOW() - INTERVAL '7 days'`), så selv i et hypotetisk avvikstilfelle ville eldre historiske deploys uansett vært ekskludert.
