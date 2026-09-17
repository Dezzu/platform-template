# SaaS Template

Template per avviare rapidamente nuove piattaforme SaaS.
Angular 22 + NestJS 12 + PostgreSQL 17 + Drizzle + Better Auth + Stripe.

**Prima di lavorarci: [CLAUDE.md](./CLAUDE.md)** — convenzioni, procedura per
aggiungere una feature, stato del progetto e le trappole già pagate.

## Prerequisiti

| Strumento  | Versione                                |
| ---------- | --------------------------------------- |
| Node       | >= 24 (pnpm 12 non parte su Node 22)    |
| pnpm       | 12.4.2 (pinned — vedi `packageManager`) |
| Docker     | >= 24 con Compose v2                    |
| Terraform  | >= 1.14 (solo per il deploy)            |
| Stripe CLI | per testare i webhook in locale         |

## Avvio rapido

```bash
pnpm install
cp .env.example .env        # poi compila i segreti
pnpm docker:dev             # postgres, valkey, mailpit, minio
pnpm db:migrate && pnpm db:seed

pnpm start:api              # api su :3000
pnpm dev:app                # dashboard su :4300
pnpm dev:web                # sito marketing su :4200
```

`start:api` compila e avvia. Per lavorare sul backend con ricompilazione automatica
usa `pnpm dev:api`.

## Ruoli

Ci sono **due sistemi di ruoli indipendenti**, e non si parlano. Confonderli è il primo
malinteso che capita a chi apre l'app, perché la parola "Amministratore" compare in
entrambi e significa due cose diverse.

### Ruoli di organizzazione

Vengono dalla riga `member` che lega una persona a un'organizzazione: valgono **dentro
quella sola organizzazione**. La stessa persona può essere owner di una e semplice
membro di un'altra. Sono i ruoli che vedi nella schermata **Membri**.

| Ruolo    | Etichetta      | Cosa può fare                                                            |
| -------- | -------------- | ------------------------------------------------------------------------ |
| `owner`  | Owner          | tutto, **compreso** cancellare l'organizzazione e cambiare l'abbonamento |
| `admin`  | Amministratore | tutto **tranne** cancellare l'organizzazione e cambiare l'abbonamento    |
| `member` | Membro         | leggere tutto (progetti, file, membri, fatturazione) e caricare file     |

`admin` non ha `org.delete` né `billing.manage` di proposito: sono decisioni da owner, e
un admin che potesse prenderle potrebbe chiudere fuori l'owner o fargli lievitare il
conto.

### Ruoli di piattaforma

Vengono dalla colonna `user.role`: valgono **ovunque**, attraversano le organizzazioni e
non hanno niente a che vedere con l'appartenenza. Sono i ruoli che vedi nella schermata
**Amministrazione**, che è l'unica parte dell'applicazione che ignora di proposito il
confine fra i tenant.

| Ruolo        | Etichetta                     | Cosa può fare                                                                                                                                        |
| ------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`       | Utente                        | niente di piattaforma — è il default di ogni nuovo account                                                                                           |
| `admin`      | Amministratore di piattaforma | vedere tutti gli account e tutte le organizzazioni, cambiare ruoli ordinari, mandare il link di reset, sospendere e riattivare, chiudere le sessioni |
| `superadmin` | Super amministratore          | tutto quanto sopra, **più** impersonation, feature flag e maintenance mode                                                                           |

La riga che separa i due: `admin` è il ruolo di **supporto** e agisce su un cliente alla
volta; `superadmin` può fare le cose il cui raggio d'azione è il prodotto intero.

### Le due regole di rango

I permessi dicono cosa puoi fare alle _cose_. Non dicono cosa puoi fare alle _persone_ —
e preso alla lettera, "l'admin può rimuovere membri" include rimuovere l'owner. Per
questo, in entrambi i sistemi, il server applica due regole in più:

1. **agisci solo su chi non ti supera** — un admin non tocca un owner, né un
   amministratore di piattaforma un superadmin;
2. **assegna solo un ruolo che già possiedi** — nessuno si promuove da solo, né promuove
   qualcun altro sopra di sé.

Sui ruoli di piattaforma c'è una terza regola: **nessuno cambia il proprio**. Non è
simmetria, è un lockout — solo un superadmin può concedere superadmin, quindi l'ultimo
che si retrocedesse lascerebbe una piattaforma dove nessuno può più essere promosso,
recuperabile solo da console SQL.

### Il primo superadmin

Non si crea dall'interfaccia, ed è voluto. Si fa una volta a mano, e da lì la schermata
amministra se stessa:

```sql
update "user" set role = 'superadmin' where email = 'tu@esempio.it';
```

## Utenti demo

Creati in locale, password `password-demo-2026`. Entrambi nell'organizzazione
**Acme Srl** con 4 progetti.

| Email           | Nome           | Ruolo nell'organizzazione | Ruolo di piattaforma |
| --------------- | -------------- | ------------------------- | -------------------- |
| `fabio@demo.it` | Fabio De Zuani | Owner                     | `superadmin`         |
| `erika@demo.it` | Erika Bianchi  | Membro                    | `user`               |

Con `fabio@demo.it` vedi la voce **Amministrazione** nel menu; con `erika@demo.it` no,
ed è esattamente il comportamento atteso.

## Comandi

| Comando                            | Cosa fa                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm verify`                      | lint + typecheck + test + build — **deve essere verde prima di ogni commit** |
| `pnpm lint` / `pnpm format`        | ESLint (con regole di layering) / Prettier                                   |
| `pnpm db:generate`                 | genera una migration dal diff dello schema Drizzle                           |
| `pnpm db:migrate` / `pnpm db:seed` | applica le migration / popola dati demo                                      |
| `pnpm docker:dev`                  | avvia i servizi di sviluppo                                                  |

Lo stato di avanzamento delle fasi è in `docs/`.
