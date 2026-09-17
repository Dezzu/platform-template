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
- Signal = stato, Observable = trasporto. I servizi HTTP si chiamano `*Api`.

**Backend.**

- Migrazioni **mai** scritte a mano, **mai** modificate dopo il commit.
- Ogni tabella di dominio ha `organization_id NOT NULL`. Eccezioni: `user`, `session`,
  `account`, `verification`, `twoFactor`, `notification_preference` (scope utente);
  `plan`, `feature_flag`, `stripe_event`, `app_setting`, `subscription` (globali).
- Le query org-scoped passano da `TenantRepository`, che **pretende** un `OrgScope`.
  Non usare `this.db` direttamente in un repository: renderebbe facile la query non
  scopata, che è esattamente ciò che il meccanismo impedisce.
- Ogni GET/HEAD verso MinIO usa una **presigned URL**. Nessuna eccezione: le richieste
  firmate SigV4 negli header si rompono dietro Cloudflare.

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

**Node 24 è obbligatorio** (pnpm 12 non parte su Node 22). In una shell non
interattiva:

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
10. `apps/app/src/app/features/<x>/` — lista e form (Signal Forms, **pagina**).
    Rotta lazy con `canMatch: [navGuard('<x>')]`.
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

**Flake noto.** `auth-codes.e2e-spec.ts` è fallito due volte in una lunga sessione e
non è mai stato riproducibile (9 esecuzioni pulite, isolate e in suite). Il test ora
confronta le due risposte fra loro invece di fissare uno status, che è anche
l'invariante vero. **Se lo vedi fallire, non liquidarlo come rumore**: non è stata
trovata una causa, quindi potrebbe essere reale.

**Il test runner Angular** risolve i glob `include` dalla root del **workspace** (non
del progetto, malgrado lo schema dica il contrario) e trova i test solo **dentro** la
root del progetto: da qui il progetto `libs` separato in `angular.json`.

**`@nestjs/cli` è stato rimosso**: `nest build` si rompe su Node 22+ (ciclo ESM su
`ora`). Si usa `tsc -b` con project references.

---

## 6. Stato attuale

**Fatte:** 0 tooling · 1 database · 2 auth · 3 config/envelope · 4 contratti+OpenAPI ·
5 tenancy/permessi/audit · 6 frontend · 7 billing Stripe.

**Da fare:** 8 code+email+storage · 9 feature trasversali (notifiche, feature flag,
GDPR, maintenance) · 10 osservabilità · 11 Docker+CI · 12 Terraform.

Il piano completo è in `~/.claude/plans/voglio-realizzare-un-template-fancy-snail.md`.

**71 test.** `pnpm verify` verde.

### Ambiente locale già configurato

- **Utenti demo** (password `password-demo-2026`): `fabio@demo.it` (owner),
  `sara@demo.it` (member), stessa organizzazione "Acme Srl", 4 progetti.
- **Stripe**: sandbox `acct_1UGTFAKHrPM9kztL`, già rivendicata dall'account dell'utente.
  Prodotti Pro e Business creati, price id nella tabella `plan`.
  ⚠️ La chiave `rkcs_test_...` è **ristretta**: checkout e abbonamenti funzionano, i
  **test clock no**. Per quelli serve una `sk_test_...` dalla dashboard.
- `pnpm stripe:listen` **lo lancia l'utente nel suo terminale** — non avviarlo in
  background, non vedrebbe gli eventi.

### Decisioni prese (non ri-discutere senza motivo)

- Organizzazioni dal giorno uno; `BILLING_SCOPE` sceglie se l'abbonamento è dell'org o
  dell'utente. I dati restano org-scoped in entrambi i casi.
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
