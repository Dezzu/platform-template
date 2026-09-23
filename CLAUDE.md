# CLAUDE.md

Template per avviare piattaforme SaaS. Angular 22 + NestJS 12 + PostgreSQL 17 +
Drizzle + Better Auth + Stripe.

Questo file è il contratto: leggilo prima di toccare il codice.

---

## 0. Come lavorare qui

Queste regole valgono su tutto il resto del file. Esistono perché una sessione ha un
costo, e la parte più facile da sprecare è la verifica: controlli ripetuti,
automatismi, e prove che nessuno ha chiesto.

**Il browser si apre solo se te lo chiedo.** Il plugin Chrome consuma moltissimo:
niente screenshot, niente navigazione, niente "controllo che la pagina si apra" di
iniziativa. Quando serve davvero — e a volte serve, vedi §4 — **chiedi** invece di
farlo. Se non lo chiedo, descrivi cosa andrebbe guardato e lasciamelo aprire.

**I test non sono obbligatori per ogni modifica.** Scrivine dove il guasto costa —
isolamento fra tenant, regole di permesso e di rango, soldi, cose irreversibili — e
dove il comportamento non si vede a occhio. Per il resto, dillo e vai avanti: una
suite che cresce a ogni richiesta è token spesi due volte, quando la scrivo e ogni
volta che gira.

**`pnpm verify` gira una volta, alla fine.** Non dopo ogni file, non dopo ogni
correzione. Durante il lavoro bastano lo strumento più stretto che risponde alla
domanda — `pnpm lint`, un typecheck, un singolo spec — e la suite completa quando la
feature è finita. Ogni passata è più di un minuto e mezzo di esecuzione.

**Committa in locale, non pushare.** Sempre un commit quando il lavoro è finito e
verde, nello stile del log esistente. Il `git push` lo faccio io.

---

## 1. Regole non negoziabili

**Lingua.** Identificatori e commenti **in inglese**. Le stringhe rivolte all'utente
passano _sempre_ da i18n, con `it.json` **ed** `en.json` entrambi aggiornati — `pnpm
i18n:check` fa fallire la build se divergono. Documentazione e ADR in italiano.

**TypeScript.** `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
Mai `any`. Mai `@ts-ignore` senza una riga che spieghi perché.

**Angular (v22).**

- Mai scrivere `standalone: true` né `ChangeDetectionStrategy.OnPush`: sono default.
- Mai `@HostBinding`/`@HostListener` → `host: {}`. Mai `ngClass`/`ngStyle` → `[class.x]`.
- `input()`, `output()`, `model()`, `computed()`, `linkedSignal()`.
- `@Service()`, non `@Injectable({providedIn:'root'})`.
- **Signal Forms** (`@angular/forms/signals`) per ogni form nuovo.
- **3 file per componente** (.ts/.html/.scss) per le feature. I piccoli componenti di
  `libs/ui` usano template inline: è la scelta del progetto da cui provengono.
- I form sono **pagine**, non modali.
- Gli elenchi sono `dui-table` (`@app/ui/table`), non liste fatte a mano: paginazione,
  ordinamento, ricerca, selettore di colonne e azioni nei tre puntini stanno già lì, e
  una seconda versione di ognuno è un posto in più in cui divergere. `projects` è
  l'esempio da copiare.
- Signal = stato, Observable = trasporto. I servizi HTTP si chiamano `*Api`.

**Backend.**

- Migrazioni **mai** scritte a mano, **mai** modificate dopo il commit.
- Ogni tabella di dominio ha `organization_id NOT NULL`. Eccezioni: `user`, `session`,
  `account`, `verification`, `twoFactor`, `notification_preference` (scope utente);
  `plan`, `feature_flag`, `stripe_event`, `app_setting`, `subscription` (globali);
  `email_message`, `gdpr_export_request` e `notification`, dove la colonna è **nullable**
  — verifica email e reset password partono prima che l'organizzazione esista, chiedere
  una copia dei propri dati è una domanda su una persona e non su un tenant, e una
  notifica con `organization_id` nullo è un fatto della persona («la copia dei tuoi dati
  è pronta») che deve vedersi da qualunque organizzazione stia usando, o anche da nessuna;
  `deletion_request`, che la colonna non ce l'ha affatto, perché il soggetto è un account
  **o** un'organizzazione e `subject_id` lo dice già.
  Per `notification` ciò che **non** si allenta è il destinatario: ogni lettura passa da
  `NotificationsRepository.visibleTo`, che mette sempre `user_id` — ed è quello, non la
  colonna del tenant, a tenere un membro fuori dalla posta di un altro.
- Le query org-scoped passano da `TenantRepository`, che **pretende** un `OrgScope`.
  Non usare `this.db` direttamente in un repository: renderebbe facile la query non
  scopata, che è esattamente ciò che il meccanismo impedisce.
- Ogni GET/HEAD verso MinIO usa una **presigned URL**. Nessuna eccezione: le richieste
  firmate SigV4 negli header si rompono dietro Cloudflare.
- **Nessun endpoint accetta o restituisce byte di file.** L'upload è in due tempi —
  ticket → PUT presigned dal browser → `POST /files/:id/commit`, che rilegge l'oggetto
  con una HEAD. Solo il commit si fida dello storage: quello che ha dichiarato il
  client (dimensione, content type) non è mai un fatto.
- **`instrumentation.ts` si carica con `--require`, mai con un import.** L'ordine è ciò
  che fa funzionare l'auto-instrumentation: rattoppa i moduli mentre vengono richiesti,
  quindi deve girare prima del primo `require` di `http`, `pg`, `ioredis`. Importata da
  `main.ts` il processo parte pulito, si dichiara strumentato e non produce uno span.
  Vedi [docs/osservabilita.md](./docs/osservabilita.md).
- **Mai inviare email dentro un handler HTTP.** Si passa sempre da `MailService.send`,
  che renderizza, scrive la riga `email_message` e accoda: un invito spedito inline è
  un membro non aggiunto perché SES ha avuto un brutto secondo.
- Ogni payload di job è validato con Zod nel worker. Un payload avvelenato solleva
  `UnrecoverableError` (niente retry): fra cinque tentativi non diventerà valido.
- **Le richieste di cancellazione non cancellano da sole.** Un soggetto con un
  abbonamento vivo viene rifiutato (`GDPR_DELETION_BLOCKED_BY_SUBSCRIPTION`), mai disdetto
  per conto suo: disdire l'abbonamento di qualcuno come effetto collaterale è denaro che
  si muove senza un click. Vedi [docs/gdpr.md](./docs/gdpr.md).
- **Permessi e rango sono due domande diverse.** I permessi dicono cosa puoi fare alle
  _cose_, il rango cosa puoi fare alle _persone_. Confonderli è il modo in cui un admin
  che ha legittimamente `members.remove` rimuove l'owner e si prende il tenant. Chi
  tocca membri o account usa `outranksOrEquals` / `platformOutranksOrEquals`: si agisce
  solo su chi non ti supera, si assegna solo un ruolo che già possiedi.
- I permessi di **piattaforma** (`platform.*`) vengono da `user.role`, non
  dall'appartenenza, e hanno decorator, guard e direttiva separati
  (`@RequirePlatformPermission`, `requireAnyPlatformPermission`, `*appCanPlatform`).
  Tenerli separati è ciò che impedisce a un admin di organizzazione di raggiungere
  l'area di amministrazione con un errore di battitura.

**Layering** (imposto da `eslint-plugin-boundaries`):
`apps → libs/*` · `libs/ui → libs/primitives, libs/i18n, packages/contracts` ·
`libs/core → packages/contracts` e **mai** `environment.*` (riceve tutto da `provideCore()`).

**`libs/admin` è il back office della piattaforma, e il confine è a senso unico.**
Nessuna schermata del prodotto può importarne qualcosa — l'unica porta è
`app.routes.ts`, che deve nominare i chunk da caricare — e `libs/admin` non può
importare niente di un'applicazione. Era il 42% delle feature della dashboard e la
parte che quasi nessuno vede: senza una regola, rientra un import comodo alla volta.
Resta dentro `apps/app` come libreria, non `apps/admin`: decisione presa, vedi §6.

---

## 2. Comandi

| Comando                                | Cosa fa                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm verify`                          | lint + env-check + i18n-check + typecheck + test + build. **Verde prima di ogni commit.** |
| `pnpm docker:dev`                      | postgres, valkey, mailpit, minio, adminer                                                 |
| `pnpm db:generate --name x`            | genera la migration dal diff dello schema                                                 |
| `pnpm db:migrate` / `db:seed`          | applica / popola                                                                          |
| `pnpm auth:generate`                   | rigenera lo schema Better Auth (vedi §5)                                                  |
| `pnpm start:api`                       | compila e avvia l'api — quello che serve di solito                                        |
| `pnpm dev:api` / `dev:app` / `dev:web` | in watch: api / dashboard / marketing                                                     |
| `pnpm stripe:setup`                    | crea i prodotti Stripe dalla tabella `plan`                                               |
| `pnpm stripe:listen`                   | inoltra i webhook su localhost                                                            |
| `pnpm ng test libs` / `test app`       | test frontend                                                                             |
| `pnpm node:check`                      | verifica la versione di Node — è il primo passo di `verify`                               |
| `OTEL_ENABLED=true pnpm start:api`     | avvia l'api esportando trace e metriche via OTLP                                          |
| <http://localhost:8025>                | Mailpit: le email inviate in locale                                                       |
| <http://localhost:9001>                | console MinIO (`minioadmin` / `minioadmin`)                                               |

**Node 24 è obbligatorio** (pnpm 12 non parte su Node 22). `.nvmrc` lo dichiara e
`scripts/check-node.mjs` lo fa rispettare come primo passo di `pnpm verify`: né
`.nvmrc` né `engines` bloccano `pnpm run` da soli, e `engine-strict` vale solo in fase
di install. In una shell non interattiva:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
```

---

## 3. Come aggiungere una feature, end-to-end

Esempio: `projects` — è già implementata, **copiala**.

Questa è la lista per una **feature intera**, non per ogni modifica: il test di
isolamento cross-org al punto 8 è uno di quelli che la §0 chiama "dove il guasto
costa", e lì resta obbligatorio. Per una correzione o un ritocco, si prende solo
quello che serve.

1. `packages/contracts/src/modules/<x>/<x>.contract.ts` — `XxxSchema`,
   `XxxCreateSchema`, `XxxUpdateSchema`, `XxxListQuerySchema` + tipi inferiti.
   **Mai** accettare `organizationId` nel payload: il tenant viene dal contesto.
2. Nuovi permessi in `common/permissions.ts` + `ROLE_PERMISSIONS`.
3. Nuovi `ErrorCode` specifici in `common/error-codes.ts`.
4. `packages/db/src/schema/app/<x>.ts` — `organizationId` NOT NULL + indici + `relations()`.
5. `pnpm db:generate --name add_x` → **leggi l'SQL generato** → committa schema e
   migration insieme.
6. `apps/api/src/modules/<x>/` — module, controller (`@RequirePermissions`), service,
   repository che estende `TenantRepository`. Registra in `app.module.ts`.
7. `auditService.record({ action: 'x.created', ... }, tx)` in ogni mutazione, **nella
   stessa transazione**.
8. Test: unit sul service + e2e HTTP, **incluso un test di isolamento cross-org**.
9. `libs/core/api/<x>.api.ts` tipizzato dai tipi di `@app/contracts`.
10. `apps/app/src/app/features/<x>/` — lista con `dui-table` e form (Signal Forms,
    **pagina**). La lista è **lazy**: la tabella annuncia pagina, ordinamento e ricerca
    con `onLazyLoad`, il server risponde. Filtrare nel browser sulla pagina caricata
    vuol dire in silenzio "cerca fra le righe che stai guardando". Rotta lazy con
    `canMatch: [navGuard('<x>')]`.
11. Voce in `NAV_MANIFEST` **solo se la pagina esiste** (un test lo verifica) + icona
    registrata in `apps/app/src/app/icons.ts`.
12. Chiavi in `it.json` **e** `en.json`.
13. `pnpm verify` verde.

**Definition of done:** contract ✅ permessi ✅ migration ✅ backend ✅ audit ✅
api client ✅ UI ✅ rotta+guard ✅ menu ✅ icona ✅ i18n it+en ✅ test cross-org ✅
`pnpm verify` ✅

---

## 4. Come si verifica il lavoro

Questa sezione dice **cosa** trova i difetti. Quanto spesso farlo lo decide la §0, che
vince su tutto quello che segue.

1. **Aprire la pagina è ciò che trova i difetti** — in questo progetto dieci su dieci
   sono usciti così, zero scrivendo test: la password nell'URL, la sidebar senza
   icone, `plans.pro.name` a schermo, il tema chiaro fuori dalla shell, un form
   italiano che rispondeva "Invalid format". Tutto compilava, tutto passava i test.
   **Ma il browser lo apro io**: quando una modifica è di quelle che si giudicano
   solo guardandole, dillo e chiedimelo, invece di aprirlo per conto tuo.
2. **Guarda i log del dev server.** `Missing translation` e `Failed to resolve
dependency: zod` erano lì ore prima che diventassero bug visibili. Costano una riga
   di output, non una sessione di browser.
3. **Dopo ogni modifica scriptata, verifica con un grep _sulla stringa che hai
   inserito_.** Prettier riformatta, e un `replace` che non trova nulla non si lamenta:
   quattro modifiche sono fallite così. Due regole imparate a caro prezzo:
   - **metti sempre un `assert` sul testo cercato**, non solo sul risultato;
   - **il grep deve cercare la stringa nuova, da sola.** Un grep con più alternative
     restituisce righe, e vedere righe non vuol dire che ci sia _quella_ riga. È
     esattamente così che un `unread: true` mai applicato è sopravvissuto a un
     controllo, a una suite verde e a due commit — fino a quando il pannello delle
     notifiche ha continuato a mostrare quelle già lette.
4. **`pnpm verify` va letto dal suo exit code**, non filtrando l'output con un grep:
   un filtro che non intercetta la riga giusta nasconde un fallimento e lascia
   committare codice rotto. È già successo qui. Una volta sola, alla fine — §0.
5. **Un test _che scrivi_ va provato rompendo il codice.** Se non fallisce, non
   protegge nulla, e un test che passa per il motivo sbagliato è peggio di nessun
   test. Vale per quelli che decidi di scrivere: la §0 dice che non sono obbligatori.
   Questa regola ha già salvato due asserzioni inutili — una sulla risoluzione dei
   flag, una che "verificava" che i test non chiamassero Stripe e sarebbe passata
   comunque.

---

## 5. Trappole già pagate

Non riscoprirle.

**Better Auth genera `timestamp` senza timezone** mentre il suo stesso migratore usa
`timestamptz`. `scripts/postprocess-auth-schema.mjs` lo corregge dentro
`pnpm auth:generate`. Non modificare `auth.schema.ts` a mano: è generato.

**`pnpm auth:generate` usa chiavi Stripe segnaposto.** Il plugin possiede tabelle: se
lo schema dipendesse dall'avere Stripe configurato, la migration di uno sviluppatore
differirebbe da quella di un altro.

**`@Body({ schema })` NON valida da solo.** Il decorator allega lo schema come
metadata; senza `StandardSchemaValidationPipe` registrata globalmente alimenta solo
OpenAPI mentre i payload invalidi passano. È registrata in `main.ts` — non rimuoverla.

**`(ngSubmit)` non funziona con Signal Forms.** È un output di `NgForm`, che esiste
solo con `FormsModule`. Senza, il browser fa il submit nativo e **le credenziali
finiscono nell'URL**. Usa `(submit)` con `preventDefault()`.

**`consistent-type-imports` rompe la DI.** In NestJS un service iniettato compare solo
in posizione di tipo: l'autofix lo trasforma in `import type`, l'import sparisce e
`emitDecoratorMetadata` emette `Object`. La regola è disattivata per `apps/api`. In
Angular usa `inject()` invece dell'injection via costruttore.

**`translate()` dentro un `computed` congela la chiave.** Il `computed` non dipende da
niente di reattivo, quindi gira una volta sola — e su un caricamento a freddo gira
_prima_ che il catalogo sia arrivato: restituisce la chiave stessa e non ricalcola mai
più. A schermo non si nota se è un `aria-label`, ma nella console c'è la riga
`Missing translation`. Nei template si usa il **pipe** `| transloco`, che è reattivo per
costruzione; `translate()` va bene solo dove la lingua è già caricata e il risultato non
deve sopravvivere a un cambio lingua (per esempio dentro un handler).

**I barrel gonfiano il bundle.** Un `@app/ui` unico trascinava 204 kB di
`@spartan-ng/brain` in ogni rotta; `@app/contracts` trascinava Zod perché riesporta
schemi costruiti a top-level che il bundler non può rimuovere. Usa i sottopercorsi:
`@app/ui/layout`, `@app/contracts/permissions`. I budget in `angular.json` sono stretti
apposta.

**Le dipendenze usate dalle app Angular vanno dichiarate nella root `package.json`.**
`zod` è di `packages/contracts`, ma pnpm non lo espone alla root: il chunk lazy dava 500.

**Le icone del menu sono dati, non import.** Vanno registrate in
`apps/app/src/app/icons.ts`. Un'icona non registrata non dà errore: disegna il vuoto.

**`libs/primitives` è vendorizzato e non lintato.** `ng g @spartan-ng/cli:ui <x>` lo
sovrascrive. Il generatore scrive anche path ridondanti in `tsconfig.base.json`:
innocui, Angular legge `tsconfig.json`.

**Stripe: `cancel_at_period_end` è sempre falso** nelle versioni API recenti. La
disdetta si legge da `cancel_at`. Usa `willNotRenew`, che considera entrambi.

**Stripe: `automatic_tax` è disattivo di proposito.** Attivo senza una registrazione
fiscale _attiva_ non dà errore e non raccoglie nulla. Vedi `docs/adr/0002`.

**Il flake degli e2e: causa trovata (2026-09-22).** Per settimane la suite API ha
fallito di rado e mai in modo riproducibile, su spec diversi e con tre sintomi:
`Parse Error: Expected HTTP/, RTSP/ or ICE/`, uno status sbagliato dove la rotta esiste
(`404` al posto di `400`/`403`), e `ECONNRESET`. Sempre dentro una suite lunga, mai
isolando lo spec.

La causa è che **`createTestApp` faceva solo `app.init()`, senza mettersi in ascolto**.
`request(app.getHttpServer())` gestisce il ciclo di vita del server quando lo trova
chiuso: supertest chiama `listen(0)` prima della richiesta e `close()` dopo. Succedeva
a **ogni singola richiesta**, centinaia di volte per esecuzione, ognuna su una porta
effimera diversa. Da quella girandola venivano entrambe le classi di guasto: un socket
in pool verso una porta che il sistema operativo aveva nel frattempo riciclato, e una
`close()` che correva contro una richiesta ancora in volo.

La correzione è una riga — `await app.listen(0)` nel factory — e il resto sparisce:
supertest trova il server già su e lo lascia stare, `app.close()` lo abbatte una volta
sola. `apps/api/test/setup.ts` disattiva comunque il pooling HTTP, che con Node 19+ è
acceso di default e qui non comprava niente.

**Non rimettere il factory a solo `init()`** pensando che `listen` sia superfluo perché
supertest "se la cava": se la cava aprendo e chiudendo un server per richiesta.

**Il plugin admin di Better Auth accetta solo i ruoli che conosce**, e ne conosce due
(`admin`, `user`). `superadmin` è dichiarato nel suo access control in `auth.config.ts`
insieme a `adminRoles`: senza, ogni sua chiamata fatta da un superadmin verrebbe
rifiutata come proveniente da un non-admin.

**Gli invii verso Better Auth passano da `better-auth.bridge.ts`.** Traduce i suoi
codici nei nostri `ErrorCode`, perché il frontend renderizza `errors.<CODE>` dal nostro
catalogo: lasciar passare i suoi vorrebbe dire o una stringa non tradotta a schermo, o
un secondo catalogo da tenere allineato alle release di qualcun altro. Le chiamate
portano gli header del chiamante, così i controlli di Better Auth girano _come lui_ e
non come nessuno.

**I componenti field di spartan renderizzano un `role="alert"` nascosto per ogni input.**
Quindi in un test `querySelector('[role="alert"]')` trova sempre qualcosa, e
l'asserzione "esiste un alert" è vera anche quando il messaggio cercato non è mai
comparso. Usa `apps/app/src/testing/alerts.ts`.

**Il link di reset password atterra su `/reset-password`, non su `/sign-in`.** Better
Auth valida il token e reindirizza al `callbackURL` con `?token=` appeso: puntarlo al
form di login butta via il token su una pagina che non sa cosa farne.

**L'AWS SDK aggiunge un checksum che rompe le presigned PUT.** Dalle release recenti
PutObject firma anche `x-amz-sdk-checksum-algorithm` e un trailer CRC32. Su una URL
presigned quell'header entra nella firma, il browser non lo manda e MinIO risponde 403.
`S3Service` costruisce i client con `requestChecksumCalculation: 'WHEN_REQUIRED'` — non
toglierlo.

**La firma copre l'header Host.** Firmare `http://minio:9000` produce URL che il browser
non può usare: risolve un nome diverso e la firma non torna. Da qui `S3_PUBLIC_ENDPOINT`
e i due client dentro `S3Service`: uno interno per HEAD/DELETE, uno che firma verso
l'endpoint pubblico. In locale coincidono.

**Il `Content-Type` è firmato, la dimensione no.** La PUT deve mandare esattamente
l'header restituito in `requiredHeaders`. La lunghezza è lasciata fuori di proposito: la
imposta il browser e un mismatch sarebbe un 403 opaco. La dimensione reale si verifica
al commit con una HEAD — è lì che un upload fuori misura viene davvero fermato.

**BullMQ pretende `maxRetriesPerRequest: null`.** Con un valore finito il comando
bloccante del worker esaurisce il budget, solleva, e il worker **smette di consumare in
silenzio** con il processo ancora up e healthy.

**Un solo processor per coda** in `@nestjs/bullmq`. I lavori ricorrenti della coda
`maintenance` si smistano per `job.name` dentro `MaintenanceProcessor`; la logica di
cosa ripulire resta nella feature che possiede i dati.

**I worker partono con `autorun: false`.** I `@Processor` sono dichiarati così e la base
`QueueWorkerHost` li avvia solo se `QUEUE_RUN_WORKERS` lo dice: le opzioni del decorator
si valutano all'import, prima che la config sia validata. È ciò che permette alla stessa
immagine di girare come container API che produce e basta.

**Le pianificazioni si registrano con `upsertJobScheduler`, non con `add({ repeat })`.**
È chiavata: dieci container API dichiarano una schedulazione, non dieci, e cambiare
l'intervallo sostituisce la vecchia invece di lasciarla girare accanto alla nuova.

**I template email sono moduli TypeScript, non `.hbs`.** Il piano prevedeva Handlebars;
`tsc -b` però non copia asset e un template mancante diventerebbe un ENOENT a runtime
nel worker. Come moduli, un parametro sbagliato è un errore di compilazione. Il layout
condiviso (`templates/layout.ts`) genera HTML **e** testo dalla stessa struttura: una
email senza parte testuale viene classificata spam.

**`email_message` non contiene il link.** Il link di verifica o di reset è, finché vale,
equivalente alla password: la riga conserva i parametri **redatti**, mentre quelli veri
viaggiano nel job BullMQ, che la coda `email` cancella appena l'invio riesce
(`removeOnComplete: true`). Non è pulizia, è una proprietà di sicurezza.

**Better Auth vive fuori dalla DI**, quindi i suoi hook raggiungono `MailService` da
`mail.bridge.ts`, popolato dal costruttore di `MailModule`. Per questo `MailModule` è
importato **prima** di `AuthModule` in `app.module.ts`.

**Il test runner Angular** risolve i glob `include` dalla root del **workspace** (non
del progetto, malgrado lo schema dica il contrario) e trova i test solo **dentro** la
root del progetto: da qui il progetto `libs` separato in `angular.json`.

**`@better-auth/stripe` predefinisce `customerType: 'user'`.** Omesso, una subscription
riferita a un'**organizzazione** finisce attaccata al customer Stripe di chi ha cliccato
"attiva" — cioè esattamente ciò che la fatturazione per organizzazione dovrebbe
impedire: il piano se ne va con la persona. Non fallisce e non si vede a schermo
(`organization.stripe_customer_id` resta vuoto e la riga `subscription` porta il
customer personale), quindi `subscribe` **e** `billingPortal` lo passano esplicitamente,
derivato da `APP_MODE`, e tre test in `billing.page.spec.ts` lo sorvegliano.

**Le regole di layering non vedevano gli import con alias, e passavano in silenzio.**
`eslint-plugin-boundaries` risolve ogni import con `eslint-module-utils`, che legge
`settings['import/resolver']`. Quando non risolve, la dipendenza è descritta come
modulo **esterno** e nessuna policy la riguarda: l'import non viene rifiutato, è
invisibile. Il resolver era puntato su `tsconfig.base.json`, che **non** contiene i
path `@app/*` — quelli stanno in `tsconfig.json` — e passarli entrambi fa rispondere
"not found" a ogni alias. Risultato: per mesi le regole hanno controllato solo gli
import relativi. Ora `project: ['tsconfig.json']`, da solo.

Se aggiungi un path a `tsconfig.json`, **scrivi un import vietato che lo usa e guarda
la regola fallire**. Se non fallisce, la regola non c'è: è esattamente così che è stato
trovato questo. `'boundaries/debug': { enabled: true }` stampa cosa il plugin ha capito
di una dipendenza. Da non usare: `boundaries/alias`, che è deprecato e, attivandolo,
zittisce anche le regole che funzionavano.

**La pagina di un invito è pubblica, e deve esserlo.** Chi riceve un invito di norma
**non ha un account**: il link esiste per fargliene creare uno. Dietro `authGuard`
diventava un form di login impossibile da soddisfare — si arrivava, si veniva
rimbalzati, e non c'era modo di impostare una password. Quindi `/accept-invitation` è
una rotta pubblica fuori dalla shell, e `GET /invitations/:id` è `@AllowAnonymous`,
letto dalle tabelle invece che da `auth.api.getInvitation` (che rifiuta chi non è già
autenticato come l'invitato — cioè esattamente la persona da servire).

Ciò che protegge non è la preview ma **l'accept**, che rifiuta se l'indirizzo della
sessione non è quello invitato: un link inoltrato non aggiunge chi l'ha ricevuto. La
preview espone l'indirizzo invitato perché l'account va creato per _quello_ e il form
non deve permettere di digitarne un altro; chi ha il link ha già letto quella casella.
L'assunzione portante è che in produzione la verifica email sia accesa — senza, un link
inoltrato permetterebbe di creare un account con l'indirizzo altrui. È già obbligatoria
(`crossFieldIssues`), ed è qui che serve.

**Una CanMatch non vede la query string.** Riceve i segmenti di path, già ripuliti:
una guard che ricostruisce da lì l'URL tentato perde `?id=…`, cioè l'unica parte che
identifica un invito. Chi cliccava l'email finiva sul login e poi su una dashboard
vuota. `authGuard` legge quindi `router.getCurrentNavigation()?.extractedUrl`, e il
parametro `redirect` viaggia fino a sign-in **e** sign-up, perché un invitato senza
account passa di lì. La validazione (`safeReturnUrl`) accetta solo path della stessa
applicazione: quel valore arriva da una query string, cioè da chi ha scritto il link.

**Un form ripulito dopo un salvataggio riuscito si dipinge di rosso.** Il modello torna
vuoto ma i campi restano `touched`, quindi `required` scatta subito e la schermata
sembra segnalare un errore nel momento esatto in cui l'operazione è andata a buon fine.
Dopo un successo serve `form().reset()`, che azzera anche touched e dirty — non basta
rimettere a posto il valore. È già successo due volte: nel form delle eccezioni dei
feature flag e in quello degli inviti.

**I test non chiamano Stripe, ed è imposto — non promesso.** `createCustomerOnSignUp`
scatta a ogni `signUp`, e la suite ne fa decine per esecuzione: **18 chiamate solo dai
tre account di `billing.e2e-spec`** (misurate rimettendo il flag a `true`). Su una
sandbox _claimable_, che ha limiti bassi, questo esaurisce la quota; da lì in poi
**ogni** chiamata risponde 429, il plugin la traduce in
`UNABLE_TO_CREATE_BILLING_PORTAL` e l'interfaccia dice "non è stato possibile aprire il
portale" — un guasto che sembra del codice e non lo è. È successo.

Quindi: il plugin non crea customer sotto `NODE_ENV=test`, **e** `test/setup.ts` rifiuta
qualunque richiesta verso `stripe.com` registrandola in `stripeCallAttempts`. Un hook
nuovo che ricominciasse a chiamare Stripe fa fallire la suite invece di spendere in
silenzio: il flag è la metà gentile della regola, il blocco è quella con i denti.

Se il portale non si apre, prima di cercare il bug nel codice prova
`curl -u "$STRIPE_SECRET_KEY:" https://api.stripe.com/v1/customers/<id>`: se anche
quella risponde 429, la quota è esaurita e bisogna solo aspettare.

**Fuori dalla shell il tema scuro non si applicava, e nessuno se ne accorgeva.**
`ThemeService` è ciò che mette `.dark` sul documento, e l'unico a costruirlo era il menu
profilo — che vive dentro la shell. Login, reset password e la pagina di manutenzione
rendevano quindi in chiaro qualunque fosse la preferenza. Ora lo istanzia `App`, la root.
Trovato aprendo la pagina, come i sette prima.

**Il catalogo dei messaggi di validazione non era collegato all'i18n.**
`FORM_ERROR_KEYS` dichiara da sempre la chiave i18n di ogni validator e `form.required`
esiste in entrambi i locali, ma **nessuno chiamava `loadErrors()`**: ogni form mostrava
le stringhe inglesi hard-coded dentro `FormUtilityService`. Lo carica `App`, con un
effect sulle lingue. Se aggiungi un validator, aggiungi la chiave lì e in `it/en.json`.

**La guard di manutenzione va dopo l'autenticazione, non prima.** La decisione dipende
da `user.role`: messa prima di `AuthGuard` chiuderebbe fuori anche chi deve riaprire.
Per lo stesso motivo le rotte di Better Auth (`/api/auth/*`) sono esentate **per path** —
sono middleware e non c'è niente da decorare — e le sonde di salute con
`@AllowDuringMaintenance()`: un orchestratore legge 503 come "riavviami".

**Il bucket del rollout è un hash, non un sorteggio.** `sha256(key:subject)` mod 100, con
`subject` = organizzazione se c'è, altrimenti utente. Un sorteggio per richiesta farebbe
entrare e uscire la stessa persona dalla feature mentre la usa, e l'organizzazione prima
dell'utente evita che metà di un team veda un prodotto diverso dall'altra metà.

**Una chiave sconosciuta è "spento", su entrambi i lati.** Backend e frontend rispondono
`false` a un flag mai dichiarato: un refuso in una guard non deve aprire niente.

**Le e2e puliscono anche gli utenti e le organizzazioni che creano.** La suite condivide
il database con lo sviluppo: due spec che non lo facevano avevano lasciato 26 account
`e2e-…@test.local`, 5 organizzazioni e 712 righe `email_message` dentro le schermate di
amministrazione.

**Un'asserzione su `audit_log` va scopata agli attori del run.** `admin.e2e-spec` cercava
per sola `action` e trovava un'impersonation reale fatta dall'interfaccia giorni prima:
il test falliva sul dato di qualcun altro. Filtra sempre anche per `actorUserId`.

**Un validatore su un campo che non si può modificare rende il form invalido per sempre,
in silenzio.** Il form dei feature flag validava la chiave anche in modifica, dove la
chiave è solo testo: `notifications.inApp` non passava il pattern (minuscole-only) e il
bottone Salva non faceva **niente** — nessuna richiesta, nessun messaggio, perché
l'errore era su un campo che non viene disegnato. Due correzioni: il pattern ora accetta
i segmenti camelCase — era più stretto dell'intenzione, visto che il seed e il
suggerimento della schermata usavano entrambi `notifications.inApp` — e i validatori
della chiave si applicano solo in creazione. La regola generale: **non validare un campo
che l'utente non può raggiungere**.

**Un flag seedato che nessuno legge è un interruttore che mente.** `notifications.inApp`
esisteva nel seed, compariva nella schermata di amministrazione, si poteva spegnere — e
non era referenziato da nessuna parte tranne un commento di esempio. Spento, le notifiche
continuavano ad arrivare. Se aggiungi una riga a `seed.ts`, il flag **deve** avere almeno
un lettore, altrimenti toglilo: un controllo che accetta il click e non cambia niente è
peggio di un controllo assente, ed è la stessa cosa che qui rifiutiamo altrove (l'header
ordinabile che l'API ignora, il canale obbligatorio che risponde 403 invece di fingere).

**Un flag che spegne un canale non deve spegnere gli altri.** `notifications.inApp` chiude
il centro in-app — righe, campanella, SSE, pagina — e **non tocca l'email**: la chiave si
chiama così apposta. `billing.payment_failed` è obbligatoria via email, e un interruttore
di piattaforma che zittisse in silenzio un rinnovo fallito toglierebbe il prodotto a
qualcuno che non è stato avvisato. Le rotte delle **preferenze** restano perciò fuori dal
flag: governano anche l'email.

**`NG8113: <direttiva> is not used within the template` vuol dire che il template ha
perso del contenuto.** Non è un avviso cosmetico sugli import: è il compilatore che
segnala che quello che usava quella direttiva non c'è più. Le tab dell'area di
amministrazione sono sparite da `admin-nav.component.html` e sono state committate così,
perché filtravo l'output della build con `grep -E "ERROR|error"` e gli avvisi non li
leggevo. **Dopo una build Angular guarda anche i WARNING**, non solo gli errori — e un
NG8113 comparso dal nulla si tratta come un guasto, non come un import da togliere.

**Due handler di click sullo stesso elemento di un trigger CDK si mangiano a vicenda.**
La campanella aveva `[hlmDropdownMenuTrigger]` **e** `(click)="open()"` sullo stesso
bottone. Dopo aver attivato una voce dentro il pannello — una notifica, o "Vedi tutte" —
il click successivo sulla campanella veniva **inghiottito**: niente si apriva, il secondo
click funzionava. Riprodotto 4 volte su 4; lo stato del trigger era coerente
(`isOpen()=false`, nessun overlay), quindi il click non arrivava proprio. Il menu profilo,
che ha solo il trigger, non ne soffriva.
Il caricamento va agganciato a `(hlmDropdownMenuOpened)`, che per giunta è l'evento
giusto: con `(click)` si ricaricava anche **chiudendo**, perché anche quello è un click.
Regola generale: su un elemento che porta un trigger CDK, non aggiungere un secondo
handler dello stesso evento — usa gli output del trigger.

**Un backtick chiude la stringa anche dentro un template literal di SQL.** Stessa
trappola del template Angular qui sotto, e l'ho presa due volte nella stessa sessione:
un commento dentro `sql\`…\``che nominava una colonna fra backtick ha prodotto`Cannot find name 'filter'`su codice SQL perfettamente valido. Nei commenti dentro un
template literal si usano le virgolette, o — per l'SQL — i commenti`--` di Postgres.

**Un `LEFT JOIN` con un aggregato va protetto da `filter (where <chiave> is not null)`.**
Senza, la riga senza corrispondenza porta tutte le colonne a null, un `CASE` cade nel suo
`ELSE` e l'aggregato conta qualcosa che non esiste. Nella ripartizione dell'MRR per piano
questo mostrava il piano Business a 49 € con **zero** abbonamenti — come barra più lunga
del grafico — mentre la tile MRR sopra diceva 19 €. Due numeri in contraddizione sulla
stessa schermata, e nessun test lo avrebbe visto: l'ha trovato l'aver aperto la pagina.

**Un backtick dentro un template inline di Angular chiude la stringa.** Un commento HTML
che nominava `non-scaling-stroke` fra backtick ha prodotto `Parsing error: ',' expected`
su una riga che con l'errore non c'entrava nulla. Nei template inline di `libs/ui` si
usano le virgolette anche nei commenti.

**Un healthcheck che non può girare è peggio di nessun healthcheck.** L'immagine di Tempo
è distroless — niente shell, niente wget, niente curl — quindi la `test` HTTP che sembrava
ovvia falliva con `exec: "/bin/sh": no such file or directory`, il container restava
`unhealthy` per sempre e `depends_on: service_healthy` bloccava Alloy all'avvio. Lo stack
non partiva, e il log di Tempo diceva `Tempo started`. Tempo ora non ha healthcheck e la
prontezza si verifica da fuori; Alloy — che ha `bash` ma nessun client HTTP — usa un
connect TCP con `/dev/tcp`. Prima di scrivere una `test`, controlla cosa c'è nell'immagine:
`docker run --rm --entrypoint sh <img> -c 'command -v wget curl'`.

**Un peer opzionale nuovo può sdoppiare una dipendenza condivisa.** `drizzle-orm` dichiara
`@opentelemetry/api` come peer opzionale: nel momento in cui `apps/api` l'ha aggiunto fra le
sue dipendenze dirette, pnpm ha creato una **seconda** istanza di drizzle per quel contesto,
mentre `packages/db` è rimasto sulla prima. Il sintomo non parla di pnpm — è `tsc` che dice
che `SQL<unknown>` non è assegnabile a `SQL<unknown>` e che due proprietà private omonime
sono dichiarate separatamente. Dichiarare il peer anche nell'altro pacchetto **non basta**:
il lockfile non viene ri-risolto perché nessuno specifier è cambiato. Serve `pnpm dedupe`,
che riallinea entrambi sulla stessa istanza.

**`count(*)` grezzo in un `sql` torna una stringa, e `'0' === 0` è falso.** Il driver `pg`
restituisce i bigint come stringhe: l'helper `count()` di Drizzle lo sa e converte, un
frammento `sql` scritto a mano no. Una guardia del tipo `(row.owners ?? 0) === 0` non
scatta **mai** — e nel caso in cui è successo significava che l'unico owner di
un'organizzazione poteva cancellarsi in silenzio lasciando un tenant che nessuno può
amministrare. Si aggiunge `::int` nella query (o si passa da `Number()`), e lo si prova con
un test: qui l'ha trovato quello.

**Drizzle avvolge gli errori del driver: lo SQLSTATE è in `cause`, non sull'errore.** Un
`catch` che legge `error.code` per riconoscere una violazione di unicità (`23505`) non
combacia mai, in silenzio — e un 409 che spiega esattamente cosa è successo diventa un 500
che non dice niente. Succedeva a `deletion_request`, e l'ha trovato un test. Si cammina la
catena delle `cause` (vedi `isUniqueViolation` in `gdpr-deletion.service.ts`).

**Nelle e2e i worker girano nello stesso processo.** Quindi un job accodato da un test
viene davvero eseguito, mentre il test successivo sta girando: un'asserzione del tipo "è
ancora in preparazione" sulla riga appena accodata è una corsa che passa sulle macchine
lente. Si costruisce lo stato che serve inserendo la riga direttamente, e si prova la
pipeline chiamando il service (`app.get(GdprExportService).run(id)`) invece di aspettare la
coda — che su un deployment con `QUEUE_RUN_WORKERS=false` non arriverebbe mai.

**Le e2e che accodano un export lasciano oggetti nel bucket.** Cancellare le righe senza
cancellare gli archivi produce esattamente la spazzatura che lo sweep esiste per evitare:
`gdpr.e2e-spec` legge gli `objectKey` **prima** di cancellare le righe e chiama
`S3Service.deleteMany`.

**`@nestjs/cli` è stato rimosso**: `nest build` si rompe su Node 22+ (ciclo ESM su
`ora`). Si usa `tsc -b` con project references.

---

## 6. Stato attuale

**Fatte:** 0 tooling · 1 database · 2 auth · 3 config/envelope · 4 contratti+OpenAPI ·
5 tenancy/permessi/audit · 6 frontend · 7 billing Stripe · 8 code+email+storage ·
9a membri+inviti+pagine auth · 9b area di amministrazione · 9c feature flag + maintenance ·
9d notifiche + preferenze · 9e GDPR + cookie banner + pagine legali · 9f notifiche live (SSE) ·
10a strumentazione OTel + log strutturati + metriche custom · 10b stack di osservabilità additivo ·
10c dashboard metriche di piattaforma.

**Da fare:** 10d `infra/backup/` (dump + restore provato) · 11 Docker+CI · 12 Terraform.
(Audit UI e impersonation: fatti. La fase 9 è chiusa.)

Il piano completo è in `~/.claude/plans/voglio-realizzare-un-template-fancy-snail.md`.

**368 test.** `pnpm verify` verde.

### Cosa ha aggiunto la 9c

- **I flag si risolvono sul server**, e il browser riceve la risposta già risolta dentro
  `/me`, non le definizioni. Dal taglio di cui sotto la risoluzione è un booleano solo,
  ma il confine resta: il client chiede "è acceso", non "quali sono le regole".
  **Nota storica:** qui c'era un ordine a quattro livelli (eccezione utente → eccezione
  organizzazione → rollout percentuale → interruttore globale). È stato rimosso — vedi
  «Un flag è un interruttore, non un sistema di rollout».
- **Si applicano in tre punti**: `@RequireFeature('x')` sul backend (403
  `FEATURE_DISABLED`), `featureFlag` su una voce di `NAV_MANIFEST` — che ora `navGuard`
  e la sidebar leggono entrambi — e `*appIfFlag` nei template.
- **La manutenzione è una riga di `app_setting`**, non una variabile d'ambiente: il
  momento in cui serve è il momento in cui non vuoi fare un deploy.
- **L'area di amministrazione ha quattro schede**, ora in un componente solo
  (`admin-nav.component`), ognuna dietro il permesso della propria schermata.

### Cosa ha aggiunto la 9d

- **Niente è pre-renderizzato.** Una `notification` conserva `titleKey`, `bodyKey` e i
  `params`, mai una frase: chi legge può cambiare lingua, e una notifica scritta in
  italiano il mese scorso resterebbe italiana per sempre. Le chiavi sono _salvate_
  invece di derivate dal tipo, così una notifica vecchia mantiene la formulazione con
  cui è nata anche quando il registro cambia.
- **Una riga di preferenza assente non vuol dire "spento"**, vuol dire "mai deciso": il
  default arriva dal registro in `packages/contracts`. È ciò che permette a un tipo
  nuovo di nascere acceso senza scrivere una riga per utente per canale.
- **Alcuni canali non si spengono.** `billing.payment_failed` via email è `mandatory`, e
  il tentativo di spegnerlo risponde 403 invece di essere ignorato: un rinnovo fallito
  toglie il prodotto in pochi giorni, e chi vorrebbe zittirlo è chi ne ha più bisogno.
  Da usare con parsimonia — è l'unico oggi.
- **Le preferenze sono a scope utente, le notifiche quasi sempre a scope
  organizzazione.** "Non scrivermi per questo" è un'affermazione su una persona; "chi si
  è unito" è un fatto di un tenant. Per questo `notification_preference` è
  nell'elenco delle eccezioni a `organization_id`.
  `notification` ci è entrato dopo, con la 9e: la colonna è nullable e un valore nullo
  vuol dire "indirizzata a te, ovunque tu stia lavorando". Serviva per l'export dei dati
  e servirà per tutto ciò che riguarda l'account e non il tenant. La lettura passa da
  `NotificationsRepository`, che è l'unico repository a **non** estendere
  `TenantRepository` — e lo fa perché il predicato che conta lì è il destinatario, non
  il tenant.
- **Nessuna coda nuova.** `notify()` inserisce le righe in-app con una sola statement e
  passa le email a `MailService`, che accoda: nessun handler HTTP aspetta un mail
  server, che è la proprietà che contava. Una coda `notifications` servirà quando un
  evento si aprirà a ventaglio su centinaia di persone; oggi il massimo è "gli admin di
  un'organizzazione". Il punto in cui cambiarlo è quel metodo, e chi lo chiama non deve
  saperlo.
- **Il centro in-app sta dietro `notifications.inApp`**, e il flag è letto in quattro
  punti: `notify()` (se non scrive la riga, non c'è badge né toast né SSE), le rotte di
  lettura, la campanella nella shell e la rotta `/notifications`. La chiave sta in
  `@app/contracts/flags` — **non** nel barrel: importarla da `@app/contracts` sul percorso
  eager ha portato il bundle iniziale da 821 kB a 1.26 MB e il budget ha rifiutato la
  build, che è il meccanismo che funziona.
- **La campanella è un popover, non un menu.** Il menu CDK imponeva che ogni riga fosse
  una voce, quindi il pulsante non poteva stare accanto al testo senza annidare un
  bottone in un bottone. Il popover non impone niente: riga larga, azione di fianco al
  corpo. L'elenco completo è una `dui-table` lazy da 20 righe con filtri che vanno al
  server (stato e tipo) — filtrare nel browser vorrebbe dire "cerca fra le venti righe
  che stai guardando".
- **La campanella non fa polling** — e dalla 9f non ne ha più bisogno: il server spinge.
  Vedi la sezione 9f qui sotto. Restava ferma al valore letto alla costruzione della
  shell, quindi una notifica arrivata mentre guardavi la pagina si vedeva solo dopo un
  reload; se il badge era a zero non compariva affatto, che si legge come campanella
  rotta e non come numero vecchio.

### Cosa ha aggiunto la 9e

Il dettaglio sta in [docs/gdpr.md](./docs/gdpr.md); qui le decisioni che cambiano come si
scrive il resto.

- **L'ambito sta nella rotta, mai nel body.** Esportare sé stessi non richiede permessi,
  esportare il proprio datore di lavoro richiede `gdpr.export`, cancellare il tenant
  richiede `org.delete`: tre risposte diverse che una guard deve dare _prima_ che qualcosa
  legga un body. Un endpoint unico che prende `{ scope }` sposterebbe quella decisione
  dentro l'handler, che è dove vivono i controlli dimenticati.
- **Un archivio non contiene credenziali.** Niente hash, token OAuth, segreto TOTP o token
  di sessione: non sono informazioni _su_ una persona, sono il mezzo per diventarla, e un
  archivio che li portasse trasformerebbe un link di download in un takeover. L'elenco
  delle esclusioni è scritto dentro il file stesso (`meta.excluded`).
- **L'email che annuncia l'export non porta il link.** Finché vale, una presigned URL _è_
  l'archivio. L'email punta alla schermata; la schermata ne genera una nuova a ogni click,
  dietro la sessione che la chiede — la stessa proprietà che `email_message` compra con la
  redazione dei parametri.
- **La cancellazione è una macchina a stati, e i soldi la fermano.** 30 giorni di
  ripensamento, e `awaiting_billing` per il caso in cui un abbonamento rinasca dentro la
  finestra. Non disdiciamo noi: vedi §1.
- **Cancellare un account non cancella il registro attività.** La riga `user` sparisce con
  le sue cascate, l'`audit_log` resta con l'attore a null e `actor_email` ripulita a mano —
  è una colonna snapshot e sopravviverebbe con l'indirizzo dentro. Le organizzazioni in cui
  quell'account era l'unico membro se ne vanno con lui; una con altri membri e nessun altro
  owner blocca la richiesta.
- **Il consenso cookie è un cookie, non una riga.** Il visitatore per cui il banner esiste
  non ha un account. `CONSENT_VERSION` fa sì che aggiungere una categoria **richieda di
  nuovo** il consenso invece di ereditare un "sì" dato a una domanda diversa, e
  `parseConsent` forza a `true` le categorie necessarie perché un cookie è stato del client
  e si può modificare a mano.
- **Rifiutare costa quanto accettare.** Stesso bottone, stessa riga, stesso numero di
  click. È a una classe CSS di distanza dal diventare un dark pattern, quindi sta scritto
  nel componente.
- **Le pagine legali non stanno nel catalogo i18n.** Sono documenti — lunghi, datati,
  riscritti da un legale — e quel catalogo è eager anche nella dashboard. Stanno in
  `apps/web/src/app/pages/legal/legal-content.ts`, con i `[…]` da riempire.
- **Il sito marketing ora traduce.** Era l'unico posto che violava la regola i18n della §1
  (copy italiano hard-coded); il banner ci ha portato il runtime Transloco comunque, quindi
  tenere le stringhe fuori dal catalogo era pagare il costo senza prendere il beneficio.
  Costa ~70 kB sul bundle iniziale di `web` — vedi "Aperto, e consapevole".

### Cosa ha aggiunto la 9f

- **La campanella è viva.** `GET /notifications/stream` è un SSE: il service pubblica
  quando scrive le righe, ogni processo API ascolta, e ogni connessione riceve solo ciò
  che la riguarda. Il badge si muove senza reload e senza navigazione.
- **Pub/sub, non una coda — la differenza è il punto.** BullMQ consegna ogni job a **un
  solo** consumatore: giusto per mandare un'email, sbagliato qui. Una connessione SSE
  vive su un processo, e con due container API la notifica la scrive chi ha servito la
  POST mentre la connessione pende da chi ha scelto il proxy: con una coda l'evento
  finirebbe sul processo giusto circa una volta su due, e il badge si muoverebbe per
  alcuni e non per altri senza una riga nei log. Il pub/sub di Valkey lo manda a tutti,
  e ognuno tiene ciò che le sue connessioni hanno chiesto.
- **Sul canale viaggia il minimo che serve per agire**: destinatari, tenant, tipo, e la
  chiave i18n con i suoi parametri — abbastanza per alzare un toast nell'istante in cui
  l'evento arriva. Il **conteggio no**: quello il browser lo richiede, così il numero
  resta autorevole (viene dalla stessa query della pagina) e lo stream non diventa un
  secondo read model che può dissentire dal primo. Chiavi, mai frasi: il lettore può
  cambiare lingua.
- **All'arrivo scatta un toast, oltre al badge.** Sono due cose diverse: il badge è un
  numero piccolo in un angolo e chi sta compilando un form non lo vede cambiare, quindi
  è il toast a far _notare_ la notifica — ed è il badge a farla sopravvivere all'essere
  stata persa.
- **Il filtro del destinatario è il confine di sicurezza.** Ogni processo riceve ogni
  evento, quindi ciò che impedisce a un browser di vedere la posta di un altro è
  `userIds.includes` dentro `streamFor`, e nient'altro: sotto non c'è una query con un
  predicato di tenant a fare da rete. Un test lo sorveglia.
- **Un heartbeat ogni 25 secondi, non opzionale.** Nginx chiude una connessione
  upstream inattiva a 60, Cloudflare a 100, e una connessione che muore in silenzio è
  una che `EventSource` riapre — di continuo, trasformando una campanella viva in un
  ciclo di riconnessioni che nessuno vede.
- **`@RawResponse()`** toglie l'envelope a un handler. Serve solo agli stream: un SSE
  incartato perderebbe il `type` che dice a `EventSource` a quale listener appartiene
  ogni messaggio.

### Cosa ha aggiunto la 10a

Il dettaglio sta in [docs/osservabilita.md](./docs/osservabilita.md); qui ciò che cambia
come si scrive il resto.

- **Tre segnali, due trasporti.** Trace e metriche escono via OTLP verso Alloy; i log
  restano su **stdout** in JSON. Il pipeline log di OTLP è spento di proposito
  (`logRecordProcessors: []`): lo stack esistente raccoglie già lo stdout dal socket
  docker, e lasciarlo acceso metterebbe ogni riga in Loki due volte.
- **Dal log si salta alla trace.** Ogni riga porta `trace_id`/`span_id` presi dal contesto
  ambientale, non da un argomento. Anche `audit_log.trace_id` ora è riempita: era una
  colonna sempre nulla.
- **Lo span sa per chi è la richiesta.** `user.id`, `org.id`, `org.role`, `request.id` e
  `user.impersonator_id` — quest'ultimo separato, o le azioni di un admin sotto
  impersonation risulterebbero del cliente.
- **Le metriche passano dal meter globale, non dalla DI.** I posti che vale la pena
  contare non sono tutti nel container: gli hook di Better Auth, la base astratta dei
  worker, la callback del webhook Stripe. Con la telemetria spenta il meter è no-op,
  quindi nessun call site ha una guardia.
- **`pnpm dedupe` dopo aver aggiunto `@opentelemetry/api`.** Drizzle ce l'ha come peer
  opzionale, quindi `apps/api` e `packages/db` si sono ritrovati su due istanze diverse di
  `drizzle-orm` e i tipi hanno smesso di combaciare attraverso il confine fra i due
  pacchetti. Vedi §5.

### Cosa ha aggiunto la 10b

`infra/observability/` è uno stack Portainer a sé, **additivo**: niente Grafana, niente
Loki — ci sono già. Dettagli e passi di verifica nel suo
[README](./infra/observability/README.md).

- **Le app conoscono solo Alloy.** Un collector in mezzo vuol dire che sostituire Tempo o
  Prometheus è una modifica a `alloy/config.alloy`, non un redeploy di ogni servizio.
- **Le reti esterne sono il passo che, saltato, non dà errori.** I container partono e
  semplicemente non si vedono: il Grafana esistente deve entrare nella rete
  `observability` per interrogare Tempo, e le app per raggiungere Alloy.
- **Prometheus riceve, non raccoglie.** Le metriche arrivano spinte da Alloy e dal
  generatore di Tempo, quindi serve `--web.enable-remote-write-receiver`: senza,
  entrambe le sorgenti scrivono verso un 404 e nulla lo dice.
- **Quello che paga davvero sono i blocchi di correlazione nei datasource**, non gli URL:
  `tracesToLogsV2` per il salto trace → log, e i `derivedFields` da aggiungere al _tuo_
  Loki per quello inverso, che è quello che serve più spesso.
- **Le immagini distroless non possono avere un healthcheck HTTP.** Vedi §5.

### Cosa ha aggiunto la 10c

`/admin/metrics`: utilizzo e ricavi di piattaforma, dietro `platform.metrics.read`.

- **Separata da Grafana, e non è duplicazione.** Grafana risponde a "il sistema è
  sano?" — è ops, vive sulla VPS, chiede un accesso che non tutti hanno. Questa
  risponde a "il prodotto funziona?", vive dietro l'auth dell'app ed è parte della sua
  superficie. Due domande, due pubblici.
- **Utilizzo prima, soldi dopo.** I numeri che si muovono sono quelli sulle persone; il
  ricavo reagisce molto dopo. Un cruscotto che apre sull'MRR invita a guardare la
  metrica più lenta.
- **Cache condivisa su Valkey, 5 minuti.** Le query scansionano `session` e uniscono
  `subscription` a `plan` sul Postgres condiviso con altri 27 stack. La schermata dice
  **quando** è stata scattata e offre un bottone per rifarla: un cruscotto che sembra
  in tempo reale e non lo è fa decidere su numeri vecchi.
- **Grafici disegnati a mano in SVG, non `ngx-echarts` come diceva il piano.** ECharts è
  circa un megabyte per una schermata di back office che quasi nessuno apre; il chunk
  di `/admin/metrics` con tutto dentro è **11 kB**. Quel megabyte comprava zoom,
  autoscaling e dodici tipi di grafico: qui serve una riga con un tooltip.
- **L'asse parte da zero, sempre.** Un asse ritagliato sul minimo trasforma una
  settimana piatta in una catena montuosa, ed è il modo più comune in cui dati veri
  producono un'immagine falsa. Un test lo sorveglia.
- **Quattro difetti su cinque sono usciti aprendo la pagina**, non dai test: l'MRR per
  piano che contraddiceva la tile MRR, le linee che uscivano dalla card, il tooltip
  appoggiato esattamente sul picco che si stava leggendo, i due grafici affiancati con
  basi a quote diverse, e sotto le tile dei numeri nudi senza etichetta. §4.1 continua
  ad avere ragione.
- **Una serie per grafico, quindi nessuna legenda**; il colore viene dai token
  `--chart-*` del tema, che ha già una palette scura _scelta_ e non ribaltata. Il testo
  non indossa mai il colore della serie.
- **`signupsTrendPercent` è null, non zero, quando la finestra precedente era vuota.**
  "+100%" contro una base di niente è il numero che fa sembrare crescita la settimana
  del lancio, per sempre.
- **DAU/WAU/MAU vengono da `session.updated_at`**, quindi la granularità reale è
  `SESSION_UPDATE_AGE` e non il minuto. Conta anche chi ha solo letto, cosa che un DAU
  sul registro attività non farebbe. La schermata lo dice sotto il grafico.

### Il back office: una sola applicazione, con un confine

**Decisione presa: resta dentro `apps/app`.** Niente `apps/admin`, e non è un rinvio —
è che non serve. Quello che serviva era impedire all'area di amministrazione di
rientrare nel prodotto del cliente, e lo fa `libs/admin` con la regola di §1. Se un
giorno il back office dovrà stare dietro VPN o allowlist, lo split sarà spostare una
cartella e aggiungere un target di build; è per quello che il confine esiste adesso.

Sotto, il perché — utile solo se qualcuno riapre la questione.

L'area di amministrazione era il **42% del codice feature** della dashboard (1841 righe
su 4390) e la parte che quasi nessuno vede. Non conteneva però logiche custom: 214
righe proprie in tutto (`admin.api.ts` e `admin-nav.component`), tutto il resto preso
da `@app/core`, `@app/ui`, `@app/contracts`. È il maggior _consumatore_ delle
astrazioni condivise, non una divergenza — ed è anche dove si scopre se reggono.

Quindi è diventata `libs/admin` con un confine imposto (§1), non `apps/admin`. La
domanda che deciderà lo split è una sola, e non è di codice: **il back office deve
essere raggiungibile dai browser dei clienti?** Se no, un'app separata dietro VPN o
allowlist vale il suo prezzo; se sì, non compra molto.

Il prezzo, quando si deciderà, è soprattutto uno: **l'impersonation attraversa le due
aree** (`/admin/users` → cookie sostituito → `/dashboard` → e il ritorno riporta
indietro) e vive su una sessione same-origin. Due hostname significano cookie sul
dominio padre configurato a mano, o la funzionalità si rompe.

Non è un lavoro per la fase 11 finché quella risposta non cambia.

### Consolidamento fatto dopo la 9b, fuori piano

Non erano fasi, ma hanno cambiato le convenzioni — quindi vanno lette prima di scrivere
una schermata nuova:

- **gli elenchi sono `dui-table`**, lazy, con le azioni nei tre puntini raggruppate per
  concetto e la riga che separa quelle distruttive. Fa eccezione la pagina **file**, che
  è ancora una lista `<ul>` scritta a mano: è l'unica rimasta, ed è da convertire;
- **gli esiti delle azioni sono toast** (`ToastService` in `libs/core`, `dui-toaster`
  montato nel root). Non lo è invece una lista che non si carica: quella è lo stato
  della pagina e va detta dove sarebbe la lista;
- **`projects` è completa end-to-end** — lista in tabella e form come pagina separata,
  con Signal Forms. È l'esempio da copiare per entrambi gli idiomi;
- **il menu è a sezioni collassabili**, ordinate da `NAV_SECTIONS`;
- **`APP_MODE`** sostituisce `BILLING_SCOPE` e decide il tipo di prodotto — compresa la
  creazione automatica dell'organizzazione alla registrazione in `b2c`;
- **Node 24 è imposto** da `scripts/check-node.mjs`, primo passo di `verify`;
- **il flake degli e2e ha una causa e una correzione** — vedi §5.

### Aperto, e consapevole

- **La pagina file usa ancora una lista a mano.** Unica incoerenza rimasta dopo il
  passaggio a `dui-table`.
- **In `b2b` manca l'onboarding "crea la tua organizzazione".** Il hook non crea niente
  di proposito in quella modalità, quindi senza quella schermata un account nuovo resta
  bloccato su `ORGANIZATION_REQUIRED`. Vedi
  [docs/modalita-utente-e-organizzazione.md](./docs/modalita-utente-e-organizzazione.md).
- **I bundle iniziali superano il budget, entrambi.** `app` è a **820 kB** contro 700
  (avviso; l'errore è a 850, quindi il margine è ~30 kB e la prossima schermata lo
  consuma). `web` è a **470 kB** contro 400 (errore a 600), ed è nuovo: il sito marketing
  ha preso il runtime Transloco con i due cataloghi quando ha preso il banner cookie.
  Di quei bundle, `it.json`/`en.json` pesano ~40 kB **eager** in tutte e due le app:
  `provideI18n` li importa, non li scarica. Ogni schermata nuova aggiunge il suo testo al
  primo caricamento.
  Il passo che paga, quando si deciderà di farlo, è il loader HTTP di Transloco: toglie i
  cataloghi dal bundle iniziale di entrambe. Finché non serve, **i budget sono avvisi che
  vanno letti**, non numeri da alzare.
  Peggio: **`pnpm verify` non costruisce le app Angular** — `pnpm build` è `pnpm -r`, che
  copre solo i pacchetti del workspace — quindi i budget non li guarda nessuno. Sono
  stretti apposta e sono stati superati per tre commit senza che se ne accorgesse niente.
  Dopo una fase che tocca il frontend, lancia `pnpm ng build app` **e** `pnpm ng build web`
  a mano.
- **`webUrl` e `dashboardUrl` vanno impostati prima di un deploy reale.** Sono costanti di
  build in `apps/*/src/environments/environment.prod.ts`, non variabili d'ambiente: la
  dashboard le usa per linkare le pagine legali del sito marketing (banner cookie e form di
  registrazione), il sito marketing per linkare la dashboard. Lasciate vuote i link non
  vengono renderizzati — cioè un banner cookie senza informativa dietro.
- `AUTH_REQUIRE_EMAIL_VERIFICATION` è `false` in locale e **obbligatorio a true in
  produzione** (`crossFieldIssues`). Prima di accenderlo in dev, considera che il link
  arriva su Mailpit e funziona.
- I worker girano in-process. Il container worker separato è fase 11: basterà
  `QUEUE_RUN_WORKERS=false` sui container API.
- L'area organizzazioni dell'amministrazione è in sola lettura, per scelta: vedi il
  commento in `admin-organizations.service.ts`.
- Non esiste un modo dall'interfaccia per creare il primo superadmin — è voluto. Si fa
  una volta con una `UPDATE`, e da lì la schermata amministra se stessa.
- Il registro attività è **per tenant**. Le azioni di piattaforma hanno
  `organization_id` nullo e quindi non compaiono in nessuna schermata: serve una vista
  nell'area di amministrazione, che non c'è ancora.

### Ambiente locale già configurato

- **Utenti demo** (password `password-demo-2026`): `fabio@demo.it` / Fabio De Zuani
  (owner dell'organizzazione **e `superadmin` di piattaforma**, quindi vede l'area
  Amministrazione), `erika@demo.it` / Erika Bianchi (member), stessa organizzazione
  "Acme Srl", 4 progetti. I due sistemi di ruoli, le regole di rango e come si crea il
  primo superadmin sono spiegati con le tabelle nel [README](./README.md#ruoli).
- **Stripe**: sandbox `acct_1UGTFAKHrPM9kztL`, già rivendicata dall'account dell'utente.
  Prodotti Pro e Business creati, price id nella tabella `plan`.
  ⚠️ La chiave `rkcs_test_...` è **ristretta**: checkout e abbonamenti funzionano, i
  **test clock no**. Per quelli serve una `sk_test_...` dalla dashboard.
- `pnpm stripe:listen` **lo lancia l'utente nel suo terminale** — non avviarlo in
  background, non vedrebbe gli eventi.

### Un flag è un interruttore, non un sistema di rollout

La fase 9c aveva costruito flag con eccezioni per utente, eccezioni per organizzazione e
rollout percentuale su hash stabile. Rimosso tutto: restano `key`, `description`,
`enabled`.

Il motivo è che quella macchina serve al **rilascio graduale a una fetta di clienti**,
mentre il bisogno reale è che un superadmin possa dire «questa cosa è ancora in beta,
tienila spenta». Quattro livelli di precedenza per esprimere un booleano sono quattro
posti in cui può essere sbagliato, più una tabella, due schermate e un ordine di
risoluzione da spiegare a chiunque legga il codice.

**Cosa si perde**, ed è bene saperlo prima di rimpiangerlo: accendere una feature a un
cliente pilota e non agli altri. Se serve davvero, la risposta onesta **non** è
rimettere gli override — è un'entitlement del piano o un'impostazione
sull'organizzazione. Quelli sono dati su un cliente; un flag è una decisione sul
prodotto.

Conseguenze pratiche: `FlagsService.resolve()` e `isEnabled(key)` non prendono più un
soggetto, la cache è una sola voce, `@RequireFeature` non guarda la sessione, e la
migration `0008` fa `DROP TABLE feature_flag_override` e toglie `rollout_percent`.

### Decisioni prese (non ri-discutere senza motivo)

- **Un feature flag è un interruttore globale**, non un sistema di rollout: niente
  override per utente o organizzazione, niente percentuali. Vedi la sezione qui sopra
  per cosa si perde e qual è l'alternativa quando servirà.
- **Il back office sta nella stessa applicazione**, isolato in `libs/admin` da un
  confine imposto dal linter. Un'app separata non serve finché il back office può
  stare sulla rete pubblica — vedi §6 per cosa costerebbe (l'impersonation attraversa
  le due aree e vive su una sessione same-origin).
- Organizzazioni dal giorno uno. **`APP_MODE`** (`b2c` default, `b2b`) è l'unica
  variabile che sceglie il tipo di prodotto: chi paga, se l'organizzazione viene creata
  da sola alla registrazione, e se la schermata Membri esiste. I dati restano org-scoped
  in entrambi i casi — le organizzazioni non sono una feature del piano B2B, sono il
  confine di isolamento. Tutto in
  [docs/modalita-utente-e-organizzazione.md](./docs/modalita-utente-e-organizzazione.md),
  compreso **cosa manca**: in `b2b` l'onboarding "crea la tua organizzazione" è da
  scrivere, e senza un account nuovo resta bloccato su `ORGANIZATION_REQUIRED`.
- **Niente Stripe Connect** nel template — `docs/adr/0002` spiega perché.
- Niente Playwright: i test browser sono component test con il builder Angular.
- Backup Postgres automatici: fuori dalla v1, ma **da fare prima del primo cliente reale**.
- `minimumReleaseAge` a 0 — vedi il commento in `pnpm-workspace.yaml`.

---

## 7. Anti-pattern vietati

Presi uno a uno dal template precedente, che li aveva tutti:

password in chiaro · secret committati · token da 30 giorni · `CORS *` · 401 non
gestito · nessuna migrazione (`ddl-auto: update`) · `.dockerignore` mancante ·
artefatti di build committati · `skipTests: true` · `strict: false`.
