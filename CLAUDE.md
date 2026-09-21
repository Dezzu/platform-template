# CLAUDE.md

Template per avviare piattaforme SaaS. Angular 22 + NestJS 12 + PostgreSQL 17 +
Drizzle + Better Auth + Stripe.

Questo file è il contratto: leggilo prima di toccare il codice.

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
  `email_message`, dove la colonna è **nullable** — verifica email e reset password
  partono prima che l'organizzazione esista.
- Le query org-scoped passano da `TenantRepository`, che **pretende** un `OrgScope`.
  Non usare `this.db` direttamente in un repository: renderebbe facile la query non
  scopata, che è esattamente ciò che il meccanismo impedisce.
- Ogni GET/HEAD verso MinIO usa una **presigned URL**. Nessuna eccezione: le richieste
  firmate SigV4 negli header si rompono dietro Cloudflare.
- **Nessun endpoint accetta o restituisce byte di file.** L'upload è in due tempi —
  ticket → PUT presigned dal browser → `POST /files/:id/commit`, che rilegge l'oggetto
  con una HEAD. Solo il commit si fida dello storage: quello che ha dichiarato il
  client (dimensione, content type) non è mai un fatto.
- **Mai inviare email dentro un handler HTTP.** Si passa sempre da `MailService.send`,
  che renderizza, scrive la riga `email_message` e accoda: un invito spedito inline è
  un membro non aggiunto perché SES ha avuto un brutto secondo.
- Ogni payload di job è validato con Zod nel worker. Un payload avvelenato solleva
  `UnrecoverableError` (niente retry): fra cinque tentativi non diventerà valido.
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

Questa sezione esiste perché in questo progetto **sette difetti su sette** sono stati
trovati aprendo l'applicazione, zero scrivendo test.

1. **Apri la pagina.** Compilare e chiamare l'API non basta: il login mandava la
   password nell'URL, la sidebar non aveva icone, la pagina mostrava `plans.pro.name`.
   Tutto compilava, tutto passava i test.
2. **Guarda i log del dev server.** `Missing translation` e `Failed to resolve
dependency: zod` erano lì ore prima che diventassero bug visibili.
3. **Dopo ogni modifica scriptata, verifica con un grep che sia andata a segno.**
   Tre modifiche in questa sessione sono fallite in silenzio perché Prettier aveva
   riformattato il testo cercato.
4. **`pnpm verify` va letto dal suo exit code**, non filtrando l'output con un grep:
   un filtro che non intercetta la riga giusta nasconde un fallimento e lascia
   committare codice rotto. È già successo qui.
5. **Un test nuovo va provato rompendo il codice.** Se non fallisce, non protegge
   nulla. Un test che passa per il motivo sbagliato è peggio di nessun test.

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

**Il flake degli e2e: causa trovata, 2026-09-21.** Per settimane la suite API ha
fallito di rado e mai in modo riproducibile, su spec diversi e con due sintomi:
`Parse Error: Expected HTTP/, RTSP/ or ICE/`, e uno status sbagliato dove la rotta
esiste (`404` al posto di `400`/`403`). Sempre dentro un `pnpm verify` completo, mai
isolando lo spec.

La causa è **Node 19, che ha acceso `keepAlive` su `http.globalAgent`**. supertest lo
usa, ogni richiesta ascolta su una porta effimera e ogni spec costruisce e chiude la
propria applicazione Nest: il sistema operativo ricicla quei numeri di porta, quindi un
socket in pool verso `127.0.0.1:PORT` finisce servito a una richiesta diretta a
un'applicazione _diversa_, o a una già chiusa. Da lì byte che non sono HTTP, oppure una
richiesta che atterra su un'app che quella rotta non ce l'ha.

`apps/api/test/setup.ts` disattiva il pooling nel processo di test. Il pooling lì non
comprava niente: la suite è sequenziale e aprire un socket costa nulla rispetto ad
avviare un'applicazione Nest per file.

**Non toccare quel file** pensando che sia una micro-ottimizzazione da togliere.

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

**`@nestjs/cli` è stato rimosso**: `nest build` si rompe su Node 22+ (ciclo ESM su
`ora`). Si usa `tsc -b` con project references.

---

## 6. Stato attuale

**Fatte:** 0 tooling · 1 database · 2 auth · 3 config/envelope · 4 contratti+OpenAPI ·
5 tenancy/permessi/audit · 6 frontend · 7 billing Stripe · 8 code+email+storage ·
9a membri+inviti+pagine auth · 9b area di amministrazione.

**Da fare (fase 9, nell'ordine deciso):** audit UI + impersonation · feature flag +
maintenance · notifiche + preferenze · GDPR + cookie banner. Poi 10 osservabilità ·
11 Docker+CI · 12 Terraform.

Il piano completo è in `~/.claude/plans/voglio-realizzare-un-template-fancy-snail.md`.

**152 test.** `pnpm verify` verde.

**Lasciato in sospeso dalla fase 8**, di proposito:

- `AUTH_REQUIRE_EMAIL_VERIFICATION` è `false` in locale e **obbligatorio a true in
  produzione** (`crossFieldIssues`). Prima di accenderlo in dev, considera che il link
  arriva su Mailpit e funziona.
- I worker girano in-process. Il container worker separato è fase 11: basterà
  `QUEUE_RUN_WORKERS=false` sui container API.
- L'area organizzazioni dell'amministrazione è in sola lettura, per scelta: vedi il
  commento in `admin-organizations.service.ts`.
- Non esiste un modo dall'interfaccia per creare il primo superadmin — è voluto. Si fa
  una volta con una `UPDATE`, e da lì la schermata amministra se stessa.

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

### Decisioni prese (non ri-discutere senza motivo)

- Organizzazioni dal giorno uno; `BILLING_SCOPE` sceglie se l'abbonamento è dell'org o
  dell'utente. I dati restano org-scoped in entrambi i casi — le organizzazioni non sono
  una feature del piano B2B, sono il confine di isolamento. Spiegato per intero in
  [docs/modalita-utente-e-organizzazione.md](./docs/modalita-utente-e-organizzazione.md),
  compreso **cosa manca oggi**: nessuno crea l'organizzazione alla registrazione, quindi
  un account nuovo resta bloccato su `ORGANIZATION_REQUIRED`.
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
