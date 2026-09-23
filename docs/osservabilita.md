# Osservabilità

Cosa emette l'applicazione, e perché è fatta così. L'infrastruttura che la riceve sta in
[`infra/observability/`](../infra/observability/README.md).

---

## 1. Tre segnali, due trasporti

| Segnale  | Come esce                            | Dove arriva                         |
| -------- | ------------------------------------ | ----------------------------------- |
| Trace    | OTLP/HTTP su `/v1/traces`            | Alloy → Tempo                       |
| Metriche | OTLP/HTTP su `/v1/metrics`           | Alloy → Prometheus                  |
| Log      | **stdout**, JSON una riga per record | la raccolta docker esistente → Loki |

I log **non** escono via OTLP, ed è una scelta: lo stack che hai già raccoglie lo stdout
dei container dal socket docker, quindi mandarli anche via OTLP li metterebbe in Loki due
volte, con etichette diverse, e la seconda copia è quella che nessuno sa di avere finché
una query non restituisce doppioni. `logRecordProcessors: []` in `instrumentation.ts` è
quella decisione.

L'unico endpoint che le app conoscono è **Alloy**
(`OTEL_EXPORTER_OTLP_ENDPOINT`): quale backend conservi il risultato diventa una modifica
alla configurazione di Alloy invece di un redeploy di ogni servizio.

---

## 2. `instrumentation.ts` si carica con `--require`

```
node --require ./dist/instrumentation.js dist/main.js
```

**L'ordine non è un dettaglio.** L'auto-instrumentation lavora rattoppando i moduli
mentre vengono richiesti — `http`, `express`, `pg`, `ioredis`, l'SDK AWS — quindi deve
girare prima del primo `require` di ognuno. Importato da `main.ts` si caricherebbe quando
Nest ha già tirato dentro mezzo albero delle dipendenze, le patch si attaccherebbero a
niente, e il risultato è il guasto peggiore: un processo che parte pulito, si dichiara
strumentato e non produce uno span.

È anche l'unico file autorizzato a leggere `process.env` direttamente: gira prima che
`ConfigModule` abbia validato qualcosa.

Due cose sono spente di proposito:

- **`instrumentation-fs`**: uno span per ogni lettura di file, migliaia solo all'avvio.
  Seppellisce gli span che contano e costa più di tutto il resto messo insieme.
- **le sonde di salute**: colpite ogni pochi secondi dall'orchestratore per tutta la vita
  del container. Sono la rotta a più alto volume del sistema e la meno informativa.

`OTEL_LOG_LEVEL` alza la diagnostica dell'SDK, ed è deliberatamente **slegata** da
`LOG_LEVEL`: legarla significava che `LOG_LEVEL=debug` — il default locale — sommergeva
ogni riga vera sotto il commento della strumentazione HTTP che rattoppa i socket.

---

## 3. Dal log alla trace, e ritorno

Ogni riga di log porta `trace_id` e `span_id` presi dallo span attivo nel momento in cui
viene scritta:

```json
{
  "level": 30,
  "time": "...",
  "service": "saas-template",
  "trace_id": "b840e7c9…",
  "span_id": "8e06436c…",
  "context": "AppExceptionFilter",
  "msg": "GET /api/me -> 401 UNAUTHENTICATED"
}
```

Gli id vengono dal contesto **ambientale** di OpenTelemetry, non da un argomento: un call
site che dovesse passarli è un call site che può dimenticarseli, e quello che se li
dimentica è sempre il ramo d'errore.

Fuori da una richiesta — un job su un worker freddo, un tick dello scheduler — i due campi
semplicemente non ci sono: quel lavoro non ha una trace a cui puntare.

**`audit_log.trace_id`** viene riempita dallo stesso meccanismo
(`RequestContextInterceptor`), quindi una riga del registro attività è cliccabile fino alla
trace che l'ha prodotta. Era una colonna sempre nulla fino a questa fase.

---

## 4. Chi ha fatto la richiesta

`TelemetryInterceptor` marca lo span della richiesta con `user.id`, `org.id`, `org.role`,
`request.id` e — quando c'è — `user.impersonator_id`.

L'auto-instrumentation dà metodo, rotta e stato: abbastanza per vedere che qualcosa è
lento, mai abbastanza per vedere **per chi**. Sono questi attributi a trasformare una
ricerca fra le trace in una risposta: "le richieste di questo cliente", "cosa ha fatto
questa persona", "la trace del request id che c'è nel ticket".

Gira come interceptor e non come middleware perché è il primo punto in cui il tenant
esiste: lo risolve `PermissionsGuard`, e le guard girano prima degli interceptor.

**Due conseguenze di quella posizione, verificate guardando le trace in Tempo e non
dedotte dal codice.**

Gli attributi finiscono sullo span **interno** di Nest (`request handler - /api/plans`),
non sul server span: dentro un interceptor lo span attivo è quello aperto dalla
strumentazione di Express, non quello HTTP che gli sta sopra. In pratica non cambia le
ricerche — TraceQL confronta gli attributi a qualsiasi profondità, quindi
`{ .user.id = "…" }` trova la trace lo stesso — ma la lista delle trace in Grafana mostra
gli attributi della radice, e lì non li vedi.

E una richiesta respinta da una **guard** non passa mai di qui: un 401 dell'AuthGuard
produce una trace senza `request.id`, perché l'interceptor non è stato eseguito. È
corretto — non c'era né tenant né utente da registrare — ma va saputo prima di cercare
un attributo che non può esserci.

`user.impersonator_id` è separato da `user.id`, che resta la persona per conto della quale
si agisce: senza, le azioni di un amministratore sotto impersonation risultano del cliente
— esattamente al contrario nell'unico caso in cui la distinzione serve.

---

## 5. Metriche custom

Registrate attraverso il meter **globale** di OpenTelemetry, non tramite un provider Nest
(`src/observability/metrics.ts`). I posti che vale la pena contare non sono tutti dentro
il container DI: gli hook di Better Auth ci vivono fuori, `QueueWorkerHost` è una base
astratta costruita dalle sottoclassi, il webhook Stripe è una callback di un plugin.
Passare un service iniettato in ognuno significherebbe o un argomento in più che ogni
processor deve ricordarsi, o non misurare metà del sistema.

Con la telemetria spenta `getMeter` restituisce un'implementazione no-op: ogni funzione
costa una lettura di proprietà e nessun call site ha bisogno di una guardia.

| Metrica                | Attributi               | Dove viene registrata                   |
| ---------------------- | ----------------------- | --------------------------------------- |
| `signups`              | —                       | hook `user.create.after` di Better Auth |
| `emails_sent`          | `template`,`status`     | `MailProcessor`                         |
| `queue_job_duration`   | `queue`,`name`,`status` | eventi del worker BullMQ                |
| `stripe_webhooks`      | `type`,`result`         | `onEvent` del plugin Stripe             |
| `subscriptions_active` | —                       | gauge osservabile, una query per export |

Tre dettagli che non si vedono dai nomi:

- **`emails_sent{status=failed}` si conta solo a retry esauriti.** Contare ogni tentativo
  fa sembrare rotto un provider che è soltanto instabile, e il rapporto è quello su cui si
  mette un alert.
- **`stripe_webhooks{result=duplicate}` è un esito, non un errore.** Stripe riconsegna per
  72 ore: un flusso costante lì è la guardia di idempotenza che funziona, lo stesso flusso
  sotto `failed` è denaro che non viene registrato.
- **`subscriptions_active` è un gauge, non un contatore tenuto in pari a mano.** Si muove
  su webhook, disdette e trial che scadono in silenzio da Stripe; incrementare e
  decrementare lungo ognuno di quei percorsi divergerebbe alla prima dimenticanza, e un
  gauge che divaria è peggio di nessun gauge perché gli si crede.

I nomi seguono la convenzione OpenTelemetry, non quella Prometheus: i suffissi `_total` e
`_seconds` li aggiunge l'exporter Prometheus in uscita, metterli qui produrrebbe
`signups_total_total`.

---

## 6. Variabili

| Variabile                     | Cosa decide                                               |
| ----------------------------- | --------------------------------------------------------- |
| `OTEL_ENABLED`                | se l'SDK parte. Spento, `instrumentation.ts` non fa nulla |
| `OTEL_SERVICE_NAME`           | il `service.name` sulle risorse                           |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Alloy. Le app non conoscono altro                         |
| `OTEL_LOG_LEVEL`              | diagnostica dell'SDK (default `error`)                    |
| `LOG_LEVEL`                   | livello dell'applicazione                                 |
| `LOG_FORMAT`                  | `json` per un collector, `pretty` per una persona         |

`LOG_FORMAT=pretty` in produzione perde la correlazione: le righe non sono più parsabili
in campi da Loki, ed è tutto il punto dei log strutturati.

---

## 7. Cosa manca della fase 10

- `infra/backup/` — dump del Postgres condiviso su MinIO con retention e uno **script di
  restore provato**.
- L'export da Portainer del compose dello stack Grafana+Loki già esistente, perché entri
  in git e diventi gestibile da Terraform come il resto.
- La dashboard metriche di business sotto `/admin/metrics` — separata da Grafana di
  proposito: Grafana risponde a "il sistema è sano?", quella risponde a "il business
  funziona?" e vive dietro l'auth dell'applicazione.
