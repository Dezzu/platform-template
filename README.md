# SaaS Template

Template per avviare rapidamente nuove piattaforme SaaS.
Angular 22 + NestJS 12 + PostgreSQL 17 + Drizzle + Better Auth + Stripe.

**Prima di lavorarci: [CLAUDE.md](./CLAUDE.md)** — convenzioni, procedura per
aggiungere una feature, stato del progetto e le trappole già pagate.

## Prerequisiti

| Strumento  | Versione                                 |
| ---------- | ---------------------------------------- |
| Node       | >= 22.14                                 |
| pnpm       | 10.33.0 (pinned — vedi `packageManager`) |
| Docker     | >= 24 con Compose v2                     |
| Terraform  | >= 1.14 (solo per il deploy)             |
| Stripe CLI | per testare i webhook in locale          |

## Avvio rapido

```bash
pnpm install
cp .env.example .env        # poi compila i segreti
pnpm docker:dev             # postgres, valkey, mailpit, minio
pnpm db:migrate && pnpm db:seed
pnpm dev
```

## Comandi

| Comando                            | Cosa fa                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm verify`                      | lint + typecheck + test + build — **deve essere verde prima di ogni commit** |
| `pnpm lint` / `pnpm format`        | ESLint (con regole di layering) / Prettier                                   |
| `pnpm db:generate`                 | genera una migration dal diff dello schema Drizzle                           |
| `pnpm db:migrate` / `pnpm db:seed` | applica le migration / popola dati demo                                      |
| `pnpm docker:dev`                  | avvia i servizi di sviluppo                                                  |

Lo stato di avanzamento delle fasi è in `docs/`.
