# GDPR: accesso, cancellazione, consenso

Tre meccanismi, e tre decisioni che vale la pena conoscere prima di toccarli.

---

## 1. Copia dei dati (art. 15)

`POST /gdpr/exports/me` — o `/organization`, dietro il permesso `gdpr.export` — inserisce
una riga `gdpr_export_request` e accoda un job. **Niente viene letto nell'handler**: un
export percorre una dozzina di tabelle e carica il risultato, che su un tenant grosso è
minuti di lavoro. Inline sarebbe una richiesta che il chiamante aspetta e un gateway
timeout nel momento esatto in cui l'export vale qualcosa.

Il worker costruisce un JSON, lo scrive su MinIO sotto `exports/{subjectId}/…` e mette la
riga in `ready` con una `expiresAt`. La pagina genera una presigned GET **a ogni click**.

**Cosa non entra nell'archivio**, e perché sta scritto anche dentro il file (`meta.excluded`):

- hash della password, access e refresh token OAuth;
- segreto TOTP e codici di recupero;
- token di sessione.

Non sono informazioni _su_ una persona, sono il mezzo per diventarla. Un archivio che li
contenesse trasformerebbe un link di download in un takeover. IP, user agent e orari delle
sessioni invece ci sono: quelli sono dati personali a tutti gli effetti.

**L'email che annuncia l'archivio non contiene il link.** Finché è valida, una presigned URL
_è_ l'archivio: in una casella di posta è inoltrabile, cercabile e sopravvive al momento in
cui serviva. L'email punta alla schermata; la schermata genera una URL nuova dietro la
sessione che la chiede.

**Chi può scaricare.** La riga deve essere del chiamante — e per un export di
organizzazione si ricontrolla che _ancora oggi_ abbia `gdpr.export` in quel tenant. Chi ha
chiesto i dati del datore di lavoro e poi se n'è andato non deve conservare un download
funzionante. Una riga di qualcun altro risponde 404, mai 403: un 403 confermerebbe che
quell'id esiste.

**La riga sopravvive all'archivio.** Passata la finestra di ritenzione
(`GDPR_EXPORT_TTL_HOURS`) lo sweep cancella l'oggetto e mette la riga in `expired`. "Chi ha
chiesto cosa, e quando" è a sua volta una domanda che arriva, e si risponde con una riga
che dice `expired`, non con un buco.

---

## 2. Cancellazione (art. 17)

`deletion_request` è una **macchina a stati**, non un flag:

```
scheduled ──(dovuta, nessun abbonamento)──> executed
    │                                         ▲
    │  (dovuta, abbonamento vivo)             │
    ▼                                         │
awaiting_billing ──────(sweep successivo)─────┘
    │
    └──(annullata entro i 30 giorni)──> cancelled
```

### È programmata, non immediata

L'articolo 17 non chiede la cancellazione entro il secondo, e un account cancellato per
sbaglio è l'unico errore qui che non si può disfare. I 30 giorni
(`GDPR_DELETION_GRACE_DAYS`) sono ciò che rende il bottone offribile. L'email di conferma
parte comunque, anche se la persona ha appena cliccato: è l'unica email che conta nel caso
in cui **non** sia stata lei.

### Cosa succede davvero a un account

Non "si cancella tutto". Si cancella la riga `user` — e con lei, in cascata, sessioni,
credenziali, secondo fattore, appartenenze, notifiche, preferenze e richieste di export —
mentre **il registro attività resta**, con `actor_user_id` messo a null dal vincolo e
`actor_email` ripulito a mano (è una colonna snapshot, sopravviverebbe con l'indirizzo
dentro). "Chi ha cambiato questa impostazione" deve restare una domanda con risposta, e un
attore nullo risponde quanto bastava un nome, senza dire niente su una persona.

Le organizzazioni in cui quell'account era **l'unico membro** se ne vanno con lui: esistono
per contenere i suoi dati e nessun altro le aprirebbe mai più. Un'organizzazione con altri
membri e nessun altro owner invece **blocca** la richiesta (`ORGANIZATION_LAST_OWNER`): la
risposta è "passala a qualcun altro prima", non "lasciamo un tenant che nessuno può
amministrare".

### I soldi la fermano

Un soggetto con un abbonamento vivo (`active`, `trialing`, `past_due`) non viene cancellato:
la richiesta è **rifiutata** con `GDPR_DELETION_BLOCKED_BY_SUBSCRIPTION`, e se un abbonamento
rinasce durante i 30 giorni la richiesta scivola in `awaiting_billing` e lo sweep riguarda.

Qui il piano originale (rischio R3) prevedeva che fosse il sistema a disdire l'abbonamento
e ad aspettare il webhook. **Non lo fa, ed è deliberato**: disdire l'abbonamento di qualcuno
come effetto collaterale di una richiesta di cancellazione è denaro che si muove senza un
click, e cancellare un tenant che sta pagando perché un job è scaduto sarebbe peggio. La
disdetta si fa dalla schermata fatturazione, che è dove la persona sa cosa sta facendo.

### Le fatture non si cancellano

In Italia i documenti fiscali si conservano circa dieci anni, quindi "cancella tutto" per le
fatture è giuridicamente sbagliato. Si anonimizzano i dati personali e si conservano i
documenti contabili — che nel nostro caso vivono su Stripe. È detto nella privacy policy e
sotto il bottone di cancellazione, perché una promessa che non possiamo mantenere è peggio
di una limitazione dichiarata.

---

## 3. Consenso cookie

Un **cookie di prima parte**, non una riga di database. Il visitatore per cui il banner
esiste è quello che un account non ce l'ha: un record lato server coprirebbe solo la
minoranza che è già cliente. Il cookie non contiene identificativi — registra una risposta,
non una persona — è `SameSite=Lax` e vale sei mesi.

**L'assenza non è consenso.** Nessun cookie, un cookie malformato o uno scritto contro una
`CONSENT_VERSION` precedente significano tutti la stessa cosa: a _questa_ domanda non è
stato risposto. Il banner torna e tutto ciò che è opzionale resta spento. Alzare la versione
è il modo di far _richiedere_ il consenso quando si aggiunge una categoria, invece di
ereditare un "sì" dato a una domanda diversa.

**Rifiutare costa esattamente quanto accettare**: stesso bottone, stessa riga, stesso numero
di click. Un banner in cui "rifiuta" richiede una schermata in più è il dark pattern su cui
i garanti sono effettivamente intervenuti, ed è sempre a una classe CSS di distanza.

**Revocare è facile quanto dare**: il link "Preferenze cookie" nel footer del sito e il
bottone nella pagina Privacy del prodotto riaprono il banner.

Il banner è `@defer`: la maggior parte delle visite non lo vede mai, e sulle pagine
prerenderizzate del sito marketing il server — che il cookie non ce l'ha — lo metterebbe
altrimenti dentro l'HTML statico, facendolo lampeggiare a ogni visitatore di ritorno prima
che l'hydration se lo riprenda.

---

## 4. Le pagine legali

Stanno in `apps/web/src/app/pages/legal/legal-content.ts`, **non** nel catalogo i18n. Quel
catalogo è importato in modo eager anche dalla dashboard, dove ogni kilobyte finisce nel
bundle iniziale, e una privacy policy pesa parecchi kilobyte. Sono documenti: lunghi,
versionati da una data, riscritti da un legale e non da chi traduce un bottone.

⚠️ **Sono un template, non un parere legale.** Ogni `[…]` va riempito e il testo va
rivisto da qualcuno di competente prima che un prodotto vero esca con quella pagina. Ciò
che è già giusto è la _struttura_ che il GDPR chiede — chi è il titolare, su quale base,
per quanto, chi altro vede i dati, quali diritti hai — e il fatto che quei diritti siano
collegati a schermate che funzionano davvero.

---

## 5. Variabili d'ambiente

| Variabile                  | Cosa decide                                                            |
| -------------------------- | ---------------------------------------------------------------------- |
| `GDPR_DELETION_GRACE_DAYS` | i giorni di ripensamento prima che la cancellazione venga eseguita     |
| `GDPR_EXPORT_TTL_HOURS`    | per quanto un archivio resta scaricabile prima che lo sweep lo elimini |

Lo sweep (`gdpr.sweep`) gira **ogni ora** sulla coda `maintenance`, non di notte: un archivio
scade a un orario e una cancellazione matura a un orario, e uno sweep giornaliero
significherebbe una finestra di ritenzione "di 48 ore, più o meno un giorno".
