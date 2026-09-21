# Modalità utente e modalità organizzazione

Il template si può configurare per due tipi di prodotto, e la scelta si esprime con
**una sola variabile d'ambiente**: `BILLING_SCOPE`.

Questo documento spiega cosa cambia davvero, cosa non cambia (che è la parte che
sorprende), come è implementato, e cosa fare quando avvii una piattaforma nuova.

---

## 1. Le due modalità in una frase

| Modalità                 | Chi paga           | Prodotto tipico                                             |
| ------------------------ | ------------------ | ----------------------------------------------------------- |
| `organization` (default) | Il tenant          | B2B: un'azienda compra, invita i colleghi, condivide i dati |
| `user`                   | La singola persona | B2C: ognuno ha il suo spazio e paga per sé                  |

```bash
# .env
BILLING_SCOPE=organization   # oppure: user
```

---

## 2. Cosa NON cambia mai

È il punto che genera più confusione, quindi viene prima di tutto il resto.

**Le organizzazioni esistono sempre, in entrambe le modalità.** Non sono una feature
del piano B2B: sono il **confine di isolamento dei dati**. Ogni tabella di dominio ha
`organization_id NOT NULL`, ogni query passa da `TenantRepository`, che pretende un
`OrgScope`. Vale per `project`, per `file`, per tutto quello che aggiungerai.

In modalità `user` l'organizzazione c'è lo stesso — semplicemente non la si mostra:
diventa idraulica, "lo spazio di quella persona".

Perché così, invece di scrivere `user_id` sulle tabelle quando si è in modalità utente:

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

Solo una cosa, ma tocca parecchi punti: **a cosa è agganciato l'abbonamento**.

|                             | `organization`                             | `user`                      |
| --------------------------- | ------------------------------------------ | --------------------------- |
| `subscription.reference_id` | id dell'organizzazione                     | id dell'utente              |
| Chi può comprare            | chi ha `billing.manage` nel tenant (owner) | l'utente stesso, per sé     |
| Chi vede il piano           | chi ha `billing.read` (tutti i ruoli)      | solo l'interessato          |
| Se il compratore se ne va   | il piano resta all'organizzazione          | il piano se ne va con lui   |
| Il paywall guarda           | l'abbonamento del tenant                   | l'abbonamento della persona |
| Cliente Stripe              | uno per organizzazione                     | uno per utente              |

La riga che conta di più è la quarta. In `organization`, chi ha pagato può lasciare
l'azienda e un collega può riprendere in mano la fatturazione: l'abbonamento non era
suo. In `user`, l'abbonamento è personale e sparisce con l'account — che è corretto per
un prodotto personale e sbagliato per uno aziendale.

---

## 4. Come è implementato

Quattro punti, tutti server-side. **La modalità non è mai una decisione del client**:
il frontend la riceve e la usa per disegnare, ma chi decide è l'API.

### 4.1 La scelta del riferimento

`SubscriptionService.referenceFor()` — è l'unico posto che traduce la modalità in un id:

```ts
referenceFor(organizationId: string | null, userId: string): string | null {
  return (process.env['BILLING_SCOPE'] ?? 'organization') === 'user' ? userId : organizationId;
}
```

### 4.2 Chi può agire su un abbonamento

`canActOnSubscription()` in `stripe-plugin.ts`, passata a Better Auth come
`authorizeReference`. **Non è opzionale**: senza, Better Auth permette solo operazioni
in cui `referenceId` è l'id di chi chiama — cioè, in modalità organizzazione, tutto
fallisce.

In modalità `user` rifiuta esplicitamente un riferimento a un'organizzazione, invece di
ignorarlo: così un client vecchio non può creare abbonamenti che l'applicazione non
leggerà mai.

In modalità `organization` verifica due cose: che chi chiama sia membro di quel tenant,
e che il suo ruolo porti il permesso giusto — `billing.read` per leggere,
`billing.manage` per modificare. È qui che si decide che un `member` vede il piano ma
non lo cambia.

### 4.3 Il paywall

`SubscriptionGuard` applica `@RequireSubscription()`. Gira **dopo** `PermissionsGuard`,
quindi il tenant è già risolto — un paywall che dovesse capire da solo di quale
organizzazione si parla sarebbe un secondo posto in cui sbagliare la tenancy.

Risponde **402 Payment Required**, non 403: chi chiama ha il diritto di farlo, non ha
pagato. Un client che non distingue i due mostra il messaggio sbagliato.

Contano solo `active` e `trialing`. `past_due` no: la carta è stata rifiutata, e il
periodo di tolleranza è un problema di Stripe, non una ragione per continuare a servire.

### 4.4 Come lo sa il frontend

`GET /api/me` restituisce `billingScope`, e `PermissionsService` lo espone come signal.
La pagina abbonamento calcola il riferimento da lì:

```ts
protected readonly reference = computed(() =>
  this.permissions.billingScope() === 'user'
    ? (this.auth.user()?.id ?? null)
    : this.permissions.organizationId(),
);
```

È riportato dal server e non compilato nel bundle perché è un'impostazione del server:
una copia in `environment.ts` sarebbe un secondo posto da cambiare che niente tiene
allineato.

---

## 5. Un buco da colmare prima di andare in produzione

**Nessuno crea l'organizzazione.** Oggi, dopo la registrazione, un account non ha
nessuna membership: `PermissionsGuard` risponde `ORGANIZATION_REQUIRED` (400) su ogni
rotta scopata al tenant, e non esiste una schermata per crearne una. Si entra solo se
qualcuno ti invita, oppure inserendo la riga a mano.

Si verifica in un secondo:

```sql
select u.email, count(m.id) as organizzazioni
from "user" u left join member m on m.user_id = u.id
group by u.email order by organizzazioni;
```

Va affrontato **in entrambe le modalità**, ma con risposte diverse:

- **`organization`**: serve una schermata di onboarding — "crea la tua organizzazione" —
  subito dopo la registrazione, per chi non arriva da un invito. È una scelta di
  prodotto: chiedere il nome dell'azienda è un passaggio in più che però fa capire
  subito com'è fatto il prodotto;
- **`user`**: l'organizzazione non deve mai comparire. Va creata **automaticamente alla
  registrazione**, con un nome che nessuno vedrà. Il punto giusto è un `databaseHook`
  del plugin organization di Better Auth in `auth.config.ts`, così vale anche per chi si
  registra con Google e per chi viene creato dall'area amministrativa.

Finché non è fatto, un account nuovo resta bloccato.

---

## 6. Configurare una piattaforma nuova

### 6.1 Se vendi a organizzazioni (B2B)

1. `BILLING_SCOPE=organization` in `.env` (è il default, ma scrivilo: una variabile
   esplicita è una decisione, una assente è una dimenticanza);
2. aggiungi l'onboarding "crea la tua organizzazione" dopo la registrazione;
3. lascia visibile la voce **Membri** nel menu: invitare colleghi è il prodotto;
4. verifica i ruoli in `ROLE_PERMISSIONS`. Di default `admin` non ha `billing.manage`
   né `org.delete`: sono decisioni da owner, e un admin che potesse prenderle potrebbe
   chiudere fuori l'owner o fargli lievitare il conto. Cambialo solo sapendo questo;
5. nei piani, `limits.members` è la quota che conta davvero: è il numero che distingue
   un piano dall'altro.

### 6.2 Se vendi a persone (B2C)

1. `BILLING_SCOPE=user`;
2. crea l'organizzazione automaticamente alla registrazione (§5);
3. **nascondi la voce Membri** da `NAV_MANIFEST` in `libs/core/src/navigation/nav.manifest.ts`.
   Togli la voce, non il permesso: il backend continua a funzionare e riaccenderla un
   giorno è una riga;
4. valuta se nascondere anche la sezione **Organizzazione** del menu, lasciando
   l'abbonamento nel menu dell'account invece che nella barra laterale;
5. nei piani, le quote sensate sono quelle personali — spazio, progetti — e
   `limits.members` non ha senso: toglilo dal seed;
6. i testi cambiano registro: "la tua organizzazione" diventa "il tuo spazio". Sono
   chiavi i18n, quindi è una modifica ai due file di traduzione e non al codice.

### 6.3 In entrambi i casi

- **Stripe**: `pnpm stripe:setup` crea i prodotti leggendo la tabella `plan`. Non
  dipende dalla modalità; dipende dall'aver messo i prezzi giusti nel seed;
- `createCustomerOnSignUp: true` crea comunque un cliente Stripe per ogni utente, e
  `organization: { enabled: true }` uno per ogni organizzazione. In modalità `user` il
  cliente dell'organizzazione resta inutilizzato: è innocuo, e tenerlo significa che
  cambiare idea non richiede di crearli a posteriori;
- il paywall si applica con `@RequireSubscription()` sul controller. `insights` è
  l'esempio già scritto.

---

## 7. Cambiare idea dopo

Si può, ma **non è solo cambiare la variabile**: gli abbonamenti esistenti hanno
`reference_id` che punta a organizzazioni o a utenti, e cambiando modalità
l'applicazione smette semplicemente di vederli. Chi ha pagato si ritrova senza piano.

Se succede con clienti veri, serve una migrazione che riscriva `reference_id` — e la
corrispondenza non è sempre ovvia: da `user` a `organization` va bene finché ogni utente
ha la sua organizzazione, mentre da `organization` a `user` bisogna decidere **quale**
membro eredita l'abbonamento pagato dal tenant.

Da fare prima di avere clienti. Dopo, è una conversazione con loro.
