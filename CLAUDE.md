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
3. **Dopo ogni modifica scriptata, verifica con un grep che sia andata a segno.**
   Tre modifiche sono fallite in silenzio perché Prettier aveva riformattato il testo
   cercato.
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

**`@nestjs/cli` è stato rimosso**: `nest build` si rompe su Node 22+ (ciclo ESM su
`ora`). Si usa `tsc -b` con project references.

---

## 6. Stato attuale

**Fatte:** 0 tooling · 1 database · 2 auth · 3 config/envelope · 4 contratti+OpenAPI ·
5 tenancy/permessi/audit · 6 frontend · 7 billing Stripe · 8 code+email+storage ·
9a membri+inviti+pagine auth · 9b area di amministrazione · 9c feature flag + maintenance · 9d notifiche + preferenze.

**Da fare (fase 9, nell'ordine deciso):** GDPR + cookie banner.
Poi 10 osservabilità · 11 Docker+CI · 12 Terraform.
(Audit UI e impersonation: fatti.)

Il piano completo è in `~/.claude/plans/voglio-realizzare-un-template-fancy-snail.md`.

**329 test.** `pnpm verify` verde.

### Cosa ha aggiunto la 9c

- **I flag si risolvono sul server**, in un posto solo: eccezione utente → eccezione
  organizzazione → rollout percentuale → interruttore globale. Il browser riceve la
  risposta già risolta dentro `/me`, non le definizioni: una seconda implementazione
  dell'ordine sarebbe una seconda implementazione da cui divergere.
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
- **Le preferenze sono a scope utente, le notifiche a scope organizzazione.** "Non
  scrivermi per questo" è un'affermazione su una persona; "chi si è unito" è un fatto di
  un tenant. Per questo `notification_preference` è nell'elenco delle eccezioni a
  `organization_id` e `notification` no.
- **Nessuna coda nuova.** `notify()` inserisce le righe in-app con una sola statement e
  passa le email a `MailService`, che accoda: nessun handler HTTP aspetta un mail
  server, che è la proprietà che contava. Una coda `notifications` servirà quando un
  evento si aprirà a ventaglio su centinaia di persone; oggi il massimo è "gli admin di
  un'organizzazione". Il punto in cui cambiarlo è quel metodo, e chi lo chiama non deve
  saperlo.
- **La campanella non fa polling.** Si aggiorna al caricamento della shell e dopo ogni
  azione che la cambia. Un timer sarebbe una richiesta per utente per intervallo per
  sempre, per un numero quasi sempre zero: quando servirà muoversi da sola, la risposta
  onesta sono gli SSE, non il poll.

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
- **Il bundle iniziale supera il budget**: 783 kB contro 700 (avviso; l'errore è a 850).
  Di quei 783, i due locali `it.json`/`en.json` pesano ~34 kB **eager**: `provideI18n`
  li importa, non li scarica. Ogni schermata nuova aggiunge il suo testo al primo
  caricamento — le due di questa fase da sole valgono ~9 kB.
  Peggio: **`pnpm verify` non costruisce le app Angular** — `pnpm build` è `pnpm -r`, che
  copre solo i pacchetti del workspace — quindi i budget non li guarda nessuno. Sono
  stretti apposta e sono stati superati per tre commit senza che se ne accorgesse niente.
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

### Decisioni prese (non ri-discutere senza motivo)

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
