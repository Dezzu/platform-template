# Modalità utente e modalità organizzazione

Il template si può configurare per due tipi di prodotto, e la scelta si esprime con
**una sola variabile d'ambiente**: `APP_MODE`.

Questo documento spiega cosa cambia davvero, cosa non cambia (che è la parte che
sorprende), come è implementato, e cosa fare quando avvii una piattaforma nuova.

---

## 1. Le due modalità in una frase

| Modalità        | Chi paga           | Prodotto tipico                                        |
| --------------- | ------------------ | ------------------------------------------------------ |
| `b2c` (default) | La singola persona | ognuno ha il suo spazio e paga per sé                  |
| `b2b`           | Il tenant          | un'azienda compra, invita i colleghi, condivide i dati |

```bash
# .env
APP_MODE=b2c   # oppure: b2b
```

Una variabile sola, e non tre, perché **le tre cose che decide sono una decisione**: chi
paga, se l'organizzazione viene creata in silenzio alla registrazione, e se la schermata
Membri esiste. Un deployment che rispondesse a queste domande in modo incoerente — che
fattura alla persona ma mostra i colleghi, o che crea organizzazioni di nascosto dopo
averne chiesto il nome — sarebbe un prodotto che non sa spiegarsi.

Il default è `b2c` perché è la promessa più piccola: un prodotto personale che un giorno
vende ai team aggiunge una riga in `member`, mentre il contrario chiede di decidere a
posteriori chi, fra i membri, eredita l'abbonamento del tenant.

---

## 2. Cosa NON cambia mai

È il punto che genera più confusione, quindi viene prima di tutto il resto.

**Le organizzazioni esistono sempre, in entrambe le modalità.** Non sono una feature
del piano B2B: sono il **confine di isolamento dei dati**. Ogni tabella di dominio ha
`organization_id NOT NULL`, ogni query passa da `TenantRepository`, che pretende un
`OrgScope`. Vale per `project`, per `file`, per tutto quello che aggiungerai.

In `b2c` l'organizzazione c'è lo stesso — semplicemente non la si mostra: diventa
idraulica, "lo spazio di quella persona".

Perché così, invece di scrivere `user_id` sulle tabelle quando si vende alle persone:

- **si può cambiare idea.** Un prodotto B2C che un giorno vuole vendere ai team aggiunge
  membri a un'organizzazione che già esiste. La strada opposta — riscrivere ogni tabella
  da `user_id` a `organization_id` con i dati dentro — è una migrazione che nessuno vuole;
- **c'è una sola regola di isolamento da far rispettare**, e un solo test che la
  dimostra, invece di due percorsi di cui uno viene esercitato meno;
- **condividere diventa possibile senza cambiare il modello.** "Invita tuo marito a
  vedere le tue spese" è un `member` in più, non una feature nuova.

Restano quindi identici in entrambe le modalità: permessi, ruoli di organizzazione,
inviti, audit log, isolamento cross-org, e l'intera area di amministrazione.

---

## 3. Cosa cambia

|                                   | `b2b`                                 | `b2c`                        |
| --------------------------------- | ------------------------------------- | ---------------------------- |
| `subscription.reference_id`       | id dell'organizzazione                | id dell'utente               |
| Chi può comprare                  | chi ha `billing.manage` (owner)       | l'utente stesso, per sé      |
| Chi vede il piano                 | chi ha `billing.read` (tutti i ruoli) | solo l'interessato           |
| Se il compratore se ne va         | il piano resta all'organizzazione     | il piano se ne va con lui    |
| Il paywall guarda                 | l'abbonamento del tenant              | l'abbonamento della persona  |
| Cliente Stripe                    | uno per organizzazione                | uno per utente               |
| Organizzazione alla registrazione | la crea l'utente                      | creata da sola, mai nominata |
| Voce di menu **Membri**           | è il punto del prodotto               | nascosta, e la rotta rifiuta |

La riga che conta di più è la quarta. In `b2b`, chi ha pagato può lasciare l'azienda e
un collega può riprendere in mano la fatturazione: l'abbonamento non era suo. In `b2c`
è personale e sparisce con l'account — corretto per un prodotto personale, sbagliato
per uno aziendale.

---

## 4. Come è implementato

Cinque punti, tutti server-side. **La modalità non è mai una decisione del client**: il
frontend la riceve e la usa per disegnare, ma chi decide è l'API.

### 4.1 La modalità, e cosa se ne deriva

`packages/contracts/src/common/app-mode.ts` è la fonte unica. Oltre ai due valori
esporta le domande che se ne ricavano — `billsThePerson()`,
`createsOrganizationOnSignUp()` — perché siano **derivate, mai configurate a parte**:
due variabili che possono contraddirsi sono un deployment che fattura alla parte
sbagliata senza che nessuno se ne accorga fino a una fattura.

Dentro il container si legge da `appConfig.mode`. `auth.config.ts` e il plugin Stripe
sono singleton di modulo — il CLI di Better Auth importa il primo direttamente per
generare lo schema, senza container — e per loro c'è `apps/api/src/config/app-mode.ts`,
l'unico punto che legge `process.env`.

### 4.2 La scelta del riferimento

`SubscriptionService.referenceFor()` traduce la modalità in un id:

```ts
referenceFor(organizationId: string | null, userId: string): string | null {
  return billsThePerson(appMode()) ? userId : organizationId;
}
```

### 4.3 Chi può agire su un abbonamento

`canActOnSubscription()` in `stripe-plugin.ts`, passata a Better Auth come
`authorizeReference`. **Non è opzionale**: senza, Better Auth permette solo operazioni
in cui `referenceId` è l'id di chi chiama — cioè, in `b2b`, tutto fallisce.

In `b2c` rifiuta esplicitamente un riferimento a un'organizzazione, invece di
ignorarlo: così un client vecchio non può creare abbonamenti che l'applicazione non
leggerà mai.

In `b2b` verifica due cose: che chi chiama sia membro di quel tenant, e che il suo
ruolo porti il permesso giusto — `billing.read` per leggere, `billing.manage` per
modificare. È qui che si decide che un `member` vede il piano ma non lo cambia.

### 4.4 L'organizzazione alla registrazione

`apps/api/src/auth/personal-organization.ts`, agganciato a `databaseHooks.user.create.after`.
In `b2c` crea organizzazione e membership (ruolo `owner`: nessun altro entrerà mai in
quello spazio); in `b2b` non fa niente e l'utente la crea esplicitamente.

Tre proprietà, tutte sotto test:

- **idempotente.** Un database hook può girare di nuovo — una registrazione ritentata,
  un login social che si collega a un account esistente — e una seconda organizzazione
  spaccherebbe in due i dati della stessa persona;
- **non tocca chi è già membro di qualcosa.** Chi arriva da un invito non deve anche
  ritrovarsi uno spazio proprio;
- **non fa fallire la registrazione.** Se l'insert viene rifiutato, l'account esiste e
  può accedere: quello che non può ancora fare è raggiungere dei dati, ed è una
  situazione visibile e recuperabile. Una registrazione che va in 500 dopo aver scritto
  la riga utente non è né l'una né l'altra.

Scritto con Drizzle e non con `auth.api.createOrganization`, perché quell'endpoint
risolve il chiamante da una sessione e a quel punto della registrazione la sessione non
esiste ancora. Le righe sono le stesse che scriverebbe lui.

### 4.5 Il paywall, e come lo sa il frontend

`SubscriptionGuard` applica `@RequireSubscription()`. Gira **dopo** `PermissionsGuard`,
quindi il tenant è già risolto — un paywall che dovesse capire da solo di quale
organizzazione si parla sarebbe un secondo posto in cui sbagliare la tenancy.

Risponde **402 Payment Required**, non 403: chi chiama ha il diritto di farlo, non ha
pagato. Un client che non distingue i due mostra il messaggio sbagliato. Contano solo
`active` e `trialing`: `past_due` no, la carta è stata rifiutata e il periodo di
tolleranza è un problema di Stripe.

`GET /api/me` restituisce `mode`, e `PermissionsService` lo espone come signal insieme
a `personalBilling()`, che ne è derivato:

```ts
protected readonly reference = computed(() =>
  this.permissions.personalBilling()
    ? (this.auth.user()?.id ?? null)
    : this.permissions.organizationId(),
);
```

È riportato dal server e non compilato nel bundle perché è un'impostazione del server:
una copia in `environment.ts` sarebbe un secondo posto da cambiare che niente tiene
allineato.

Il menu funziona allo stesso modo: una voce di `NAV_MANIFEST` può dichiarare
`modes: ['b2b']`, e allora sparisce dalla barra laterale **e** la rotta la rifiuta —
altrimenti un segnalibro ci arriverebbe lo stesso.

---

## 5. Configurare una piattaforma nuova

### 5.1 Se vendi a persone (B2C) — il default

1. `APP_MODE=b2c` in `.env` (è il default, ma scrivilo: una variabile esplicita è una
   decisione, una assente è una dimenticanza);
2. non serve altro per l'onboarding: l'organizzazione si crea da sola e non compare mai;
3. **Membri è già nascosta** dal `modes: ['b2b']` nel manifest;
4. valuta se nascondere anche la sezione **Organizzazione** del menu, spostando
   l'abbonamento nel menu dell'account invece che nella barra laterale;
5. nei piani, le quote sensate sono quelle personali — spazio, progetti — e
   `limits.members` non ha senso: toglilo dal seed;
6. i testi cambiano registro: "la tua organizzazione" diventa "il tuo spazio". Sono
   chiavi i18n, quindi si tocca `it.json` e `en.json`, non il codice.

### 5.2 Se vendi a organizzazioni (B2B)

1. `APP_MODE=b2b`;
2. **aggiungi l'onboarding "crea la tua organizzazione"** dopo la registrazione, per chi
   non arriva da un invito. In questa modalità il hook non crea niente di proposito, e
   senza quella schermata un account nuovo prende `ORGANIZATION_REQUIRED` su ogni rotta
   scopata al tenant. È l'unico pezzo ancora da scrivere;
3. Membri compare da sola: invitare colleghi è il prodotto;
4. verifica i ruoli in `ROLE_PERMISSIONS`. Di default `admin` non ha `billing.manage`
   né `org.delete`: sono decisioni da owner, e un admin che potesse prenderle potrebbe
   chiudere fuori l'owner o fargli lievitare il conto. Cambialo solo sapendo questo;
5. nei piani, `limits.members` è la quota che conta davvero.

### 5.3 In entrambi i casi

- **Stripe**: `pnpm stripe:setup` crea i prodotti leggendo la tabella `plan`. Non
  dipende dalla modalità; dipende dall'aver messo i prezzi giusti nel seed;
- `createCustomerOnSignUp: true` crea comunque un cliente Stripe per ogni utente, e
  `organization: { enabled: true }` uno per ogni organizzazione. In `b2c` il cliente
  dell'organizzazione resta inutilizzato: è innocuo, e tenerlo significa che cambiare
  idea non richiede di crearli a posteriori;
- il paywall si applica con `@RequireSubscription()` sul controller. `insights` è
  l'esempio già scritto.

Per controllare chi è rimasto senza organizzazione:

```sql
select u.email, count(m.id) as organizzazioni
from "user" u left join member m on m.user_id = u.id
group by u.email order by organizzazioni;
```

---

## 6. Cambiare idea dopo

Si può, ma **non è solo cambiare la variabile**: gli abbonamenti esistenti hanno
`reference_id` che punta a organizzazioni o a utenti, e cambiando modalità
l'applicazione smette semplicemente di vederli. Chi ha pagato si ritrova senza piano.

Se succede con clienti veri, serve una migrazione che riscriva `reference_id` — e la
corrispondenza non è sempre ovvia: da `b2c` a `b2b` va bene finché ogni utente ha la sua
organizzazione, mentre da `b2b` a `b2c` bisogna decidere **quale** membro eredita
l'abbonamento pagato dal tenant.

Da fare prima di avere clienti. Dopo, è una conversazione con loro.
