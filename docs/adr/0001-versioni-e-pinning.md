# ADR 0001 — Versioni e criteri di pinning

**Data:** 2026-09-16 · **Stato:** accettato

## Contesto

Il template genera progetti che vivranno anni. Vogliamo partire dalle versioni più
recenti per allontanare il momento della manutenzione obbligata, ma "più recente"
non coincide sempre con "giusto": a volte è bloccato a monte, a volte è una RC, a
volte diverge dalla produzione.

## Decisione

Regola generale: **ultima versione stabile**, con quattro eccezioni motivate.

### Alla versione più recente

| Componente  | Versione | Note                                                                                     |
| ----------- | -------- | ---------------------------------------------------------------------------------------- |
| Node        | 24 LTS   | supporto fino ad aprile 2028. La 26 diventa LTS a ottobre 2026: sarà un bump di una riga |
| pnpm        | 12.4.2   | richiede Node ≥ 24 e corepack ≥ 0.36                                                     |
| NestJS      | 12.0.3   | core/common/platform-express; config 12.0.0, swagger 12.0.1 — tutti al massimo           |
| Angular     | 22.1.6   | CLI/build/ssr a 22.1.8: treno di rilascio separato, compatibile                          |
| Zod         | 4.6.5    |                                                                                          |
| Better Auth | 1.7.5    | pinnato **esatto**: possiede lo schema del DB, gli aggiornamenti si fanno di proposito   |
| Tailwind    | 4.3.3    |                                                                                          |
| spartan-ng  | 1.4.1    | peer Angular `>=21 <23`                                                                  |
| Valkey      | 9        |                                                                                          |

### Non aggiornati, di proposito

**TypeScript resta 6.0.x** (esiste la 7.0.2). Angular 22 dichiara
`typescript >=6.0 <6.1`. Vincolo a monte: si sale quando sale Angular.

**Drizzle resta 0.45.2** (la 1.0.0 è a `rc.5`). Una release candidate in un
template che genererà molti progetti è un debito, non un vantaggio. Better Auth
dichiara comunque `drizzle-orm ^0.45.2`.

**PostgreSQL resta 17** (esiste la 18). L'istanza condivisa in produzione è la 17:
sviluppare su un major più recente della produzione significa scoprire in
produzione che una funzione non esiste. Le due vanno alzate insieme.

**concurrently resta 9.2.4** (esiste la 10.0.5). Aggiornarla ri-risolve
`kysely@0.29.6`, pubblicata lo stesso giorno e quindi rifiutata da
`minimumReleaseAge`. Escludere kysely dalla policy supply-chain per un runner di
script di sviluppo è uno scambio pessimo.

### Policy supply-chain

`minimumReleaseAge: 1440` (24h) **attiva**, contrariamente ai progetti precedenti
che la aggiravano pinnando pnpm. È l'unica difesa del repo contro il pull di un
pacchetto compromesso pochi minuti dopo la pubblicazione. Costo: una dipendenza
aggiunta oggi è installabile domani. Nella build Docker si usa
`pnpm install --trust-lockfile`, legittimo perché la CI ha già verificato lo
stesso lockfile.

## Conseguenze

- Il primo aggiornamento obbligato sarà TypeScript 7, e dipenderà da Angular.
- Il bump a Node 26 LTS è previsto da ottobre 2026.
- Drizzle 1.0 va rivalutato all'uscita della stabile: cambia la API delle query.
- Aggiungere una dipendenza appena pubblicata richiede di aspettare 24 ore oppure
  una voce esplicita in `minimumReleaseAgeExclude`.

## Come ricontrollare

```bash
pnpm outdated -r          # dipendenze npm
nvm ls-remote --lts       # Node
```

Le immagini Docker sono pinnate sul major in `docker/compose.dev.yml`.

---

## Nota: budget del bundle della dashboard

Il budget iniziale di `apps/app` è stato alzato da 600/800 kB a 700/850 kB quando la
shell è passata alla primitiva `hlm-sidebar` (collassabile a icone, rail, tooltip,
pannello mobile). Costo misurato: **+41 kB trasferiti**, da 111 a 152 kB.

Buona parte è `@spartan-ng/brain` che Angular sposta nel chunk `main` perché condiviso
fra più rotte lazy — quindi si paga anche sulla pagina di login, dove la sidebar non
c'è. È il prezzo di avere componenti comuni fra le schermate, e ridurlo significherebbe
non usarli sull'autenticazione.

Accettato perché è una dashboard dietro login, dove la prima visita è rara e la sessione
lunga. Il **sito marketing resta a 81 kB trasferiti**: è quello giudicato sul primo
caricamento, ed è volutamente un'applicazione separata proprio per non ereditare questo
peso.
