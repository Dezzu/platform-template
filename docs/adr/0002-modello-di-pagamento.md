# ADR 0002 — Modello di pagamento: abbonamenti, non Connect

**Data:** 2026-09-17 · **Stato:** accettato

## Contesto

Nel form di onboarding Stripe era stato indicato **Connect** fra i prodotti
necessari. Vale la pena separare due cose che vengono spesso confuse, perché non
sono alternative ma integrazioni diverse:

- **Subscriptions** — _i tuoi clienti pagano te_. Il denaro arriva sul tuo account.
- **Connect** — la piattaforma **instrada denaro fra terzi**. Un cliente paga un
  professionista, tu trattieni una commissione.

## Decisione

Il template implementa **solo gli abbonamenti**. Connect non c'è.

### Perché

Connect non è una funzionalità in più: è un'integrazione a sé, con account
collegati (Accounts v2), onboarding e KYC, verifica delle _capability_ prima di
poter incassare, webhook sugli account e gestione dei payout.

Soprattutto porta decisioni che **non si possono ereditare da un template**:

- `dashboard` — quale interfaccia vedono gli account collegati
- `fees_collector` — chi Stripe fattura per le commissioni
- `losses_collector` — **chi assorbe i saldi negativi non recuperati**

L'ultima in particolare è una scelta di rischio d'impresa, diversa per ogni
piattaforma. Un template che la pre-decide sceglie al posto di chi lo userà, su una
materia dove sbagliare costa denaro reale.

La maggior parte dei progetti generati da qui vende software in abbonamento e non
instrada nulla fra terzi: per loro Connect sarebbe peso morto più una superficie di
configurazione da capire e ignorare.

### Quando aggiungerlo

Quando una piattaforma specifica fa incontrare due parti e trattiene una
commissione — un marketplace, una piattaforma di prenotazioni, un portale che paga
fornitori. A quel punto si aggiunge **in quel progetto**, con le tre decisioni sopra
prese per quel modello di business.

Regole non negoziabili al momento in cui si farà (dalla guida Stripe):

- `POST /v2/core/accounts`, mai `type: 'express' | 'custom' | 'standard'` (v1 deprecate)
- verificare `configuration.*.capabilities.*.status === 'active'` prima di incassare,
  mai i campi v1 `charges_enabled` / `payouts_enabled`
- mai `application_fee_amount` con separate charges and transfers

## Conseguenze

### Dove si appende l'abbonamento

`APP_MODE` sceglie fra `b2b` (il tenant paga) e `b2c` (default: paga la persona)
(paga la persona — portale B2C). È applicato lato server: in modalità `user` un
riferimento a un'organizzazione viene rifiutato, così un client vecchio non può
creare abbonamenti che l'applicazione non leggerà mai.

I dati di dominio restano isolati per organizzazione in **entrambe** le modalità: è
il meccanismo verificato dai test di isolamento, e per un B2C costa un'organizzazione
personale invisibile.

### IVA

`STRIPE_AUTOMATIC_TAX` è **disattivo** di default. Stripe Tax raccoglie solo dove
l'account ha una **registrazione attiva**: abilitato senza, non dà errore e non
raccoglie nulla, mentre si crede che l'IVA sia gestita. Prima di accenderlo servono
indirizzo della sede in Tax Settings, una registrazione che risulti _Collecting_ per
ogni giurisdizione, e un codice fiscale prodotto scelto con il proprio commercialista.

### Cosa resta fuori

Fatturazione elettronica italiana (SdI), che Stripe non copre: va integrata a parte
quando servirà.
