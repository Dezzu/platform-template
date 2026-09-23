/**
 * The legal documents, as content rather than as translations.
 *
 * They deliberately do **not** live in `libs/i18n`. That catalogue is imported eagerly
 * by the dashboard, where every kilobyte lands in the initial bundle — and a privacy
 * policy is several. These are documents: long, versioned by a date, rewritten by a
 * lawyer rather than by whoever is translating a button. Keeping them here means the
 * marketing site pays for them and nothing else does.
 *
 * ⚠️ **This is a template, not legal advice.** Every `[…]` placeholder has to be
 * filled in, and the whole thing reviewed by somebody qualified, before a real product
 * goes out with it. What it gets right is the *structure* the GDPR asks for — who the
 * controller is, on what basis, for how long, who else sees it, and what rights the
 * reader has — and the fact that those rights are wired to screens that work.
 */

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  /** Rendered as a list under the paragraphs. */
  bullets?: string[];
}

export interface LegalDocument {
  title: string;
  /** Shown at the top. A policy without a date is a policy nobody can rely on. */
  updated: string;
  intro: string[];
  sections: LegalSection[];
}

export type LegalDocumentId = 'privacy' | 'terms';
export type LegalLocale = 'it' | 'en';

/** Last substantive revision. Update it when the text changes, not when a typo does. */
const UPDATED = '2026-09-23';

const PRIVACY_IT: LegalDocument = {
  title: 'Informativa sulla privacy',
  updated: UPDATED,
  intro: [
    'Questa informativa spiega quali dati personali raccogliamo, perché, per quanto tempo li conserviamo e come puoi esercitare i tuoi diritti.',
    'Titolare del trattamento: [Ragione sociale], [indirizzo], P.IVA [numero]. Per qualsiasi questione relativa ai tuoi dati scrivi a [privacy@esempio.it].',
  ],
  sections: [
    {
      heading: 'Quali dati trattiamo',
      paragraphs: ['Raccogliamo solo i dati necessari a farti usare il servizio.'],
      bullets: [
        'Dati di account: nome, indirizzo email, password (conservata solo come hash) e, se lo attivi, il secondo fattore.',
        'Dati di utilizzo: le azioni che compi nel prodotto, con data, indirizzo IP e browser, conservate nel registro attività.',
        'Dati di fatturazione: piano, stato dell’abbonamento e dati fiscali. I pagamenti sono gestiti da Stripe: non vediamo mai il numero della tua carta.',
        'Contenuti che carichi tu: file, progetti e tutto ciò che scrivi nel prodotto.',
      ],
    },
    {
      heading: 'Perché li trattiamo, e su quale base',
      paragraphs: [
        'Per erogare il servizio che hai richiesto (esecuzione del contratto): account, autenticazione, funzionalità del prodotto, fatturazione.',
        'Per tenere il servizio sicuro e funzionante (legittimo interesse): registro attività, protezione dagli abusi, diagnostica degli errori.',
        'Per adempiere a obblighi di legge: conservazione dei documenti fiscali.',
        'Per cookie e tecnologie non necessarie usiamo esclusivamente il tuo consenso, che puoi revocare in qualsiasi momento.',
      ],
    },
    {
      heading: 'Per quanto tempo',
      paragraphs: [
        'I dati di account restano finché l’account esiste. Quando ne chiedi la cancellazione vengono eliminati dopo un periodo di ripensamento di 30 giorni, durante il quale puoi annullare la richiesta.',
        'Il registro attività viene conservato come prova di cosa è successo: dopo la cancellazione di un account le voci restano, ma senza più alcun riferimento alla persona.',
        'I documenti fiscali si conservano per il periodo previsto dalla legge italiana (circa dieci anni). Questo significa che “cancella tutto” non è, per le fatture, una richiesta che possiamo soddisfare: i dati personali vengono anonimizzati, i documenti contabili no.',
      ],
    },
    {
      heading: 'Chi altro vede i tuoi dati',
      paragraphs: ['Ci affidiamo a fornitori che trattano dati per nostro conto:'],
      bullets: [
        'Stripe, per i pagamenti e la fatturazione.',
        'Il fornitore di posta elettronica, per le email transazionali.',
        'Il fornitore di hosting e di archiviazione dei file.',
      ],
    },
    {
      heading: 'Dove sono trattati',
      paragraphs: [
        'L’infrastruttura è collocata nell’Unione Europea. Quando un fornitore tratta dati fuori dall’UE lo fa sulla base delle clausole contrattuali standard approvate dalla Commissione europea.',
      ],
    },
    {
      heading: 'I tuoi diritti',
      paragraphs: [
        'Puoi chiedere accesso, rettifica, cancellazione, limitazione, portabilità e opporti al trattamento.',
        'Due di questi diritti sono automatici e li eserciti da solo, dalla pagina “Privacy e dati” dentro il prodotto: puoi scaricare una copia completa dei tuoi dati in formato JSON e puoi programmare la cancellazione dell’account.',
        'Hai anche il diritto di presentare reclamo al Garante per la protezione dei dati personali.',
      ],
    },
    {
      heading: 'Cookie',
      paragraphs: [
        'Usiamo cookie tecnici necessari al funzionamento (sessione, preferenze di interfaccia, memoria della tua scelta sui cookie). Non li puoi disattivare: senza, il servizio non funziona.',
        'Ogni altra categoria — preferenze, statistiche, marketing — è disattivata finché non la attivi tu. La tua scelta è registrata in un cookie di prima parte, senza alcun identificativo, e resta valida sei mesi.',
        'Puoi cambiarla in qualsiasi momento dal link “Preferenze cookie” a fondo pagina.',
      ],
    },
    {
      heading: 'Modifiche',
      paragraphs: [
        'Se cambiamo questa informativa aggiorniamo la data in alto e, quando la modifica è sostanziale, te lo diciamo per email o dentro il prodotto.',
      ],
    },
  ],
};

const PRIVACY_EN: LegalDocument = {
  title: 'Privacy policy',
  updated: UPDATED,
  intro: [
    'This policy explains what personal data we collect, why, how long we keep it, and how you can exercise your rights.',
    'Controller: [Company name], [address], VAT [number]. For anything about your data, write to [privacy@example.com].',
  ],
  sections: [
    {
      heading: 'What we process',
      paragraphs: ['We collect only what letting you use the service requires.'],
      bullets: [
        'Account data: name, email address, password (stored only as a hash) and, if you turn it on, your second factor.',
        'Usage data: what you do in the product, with time, IP address and browser, kept in the activity log.',
        'Billing data: plan, subscription state and tax details. Payments go through Stripe — we never see your card number.',
        'What you upload: files, projects and anything you write in the product.',
      ],
    },
    {
      heading: 'Why, and on what basis',
      paragraphs: [
        'To provide the service you asked for (performance of a contract): account, authentication, product features, billing.',
        'To keep the service safe and working (legitimate interest): activity log, abuse protection, error diagnostics.',
        'To meet legal obligations: retention of accounting documents.',
        'For non-essential cookies we rely on your consent alone, and you can withdraw it at any time.',
      ],
    },
    {
      heading: 'How long',
      paragraphs: [
        'Account data stays while the account exists. When you ask for erasure it is carried out after a 30-day grace period, during which you can call it off.',
        'The activity log is kept as the record of what happened: after an account is erased the entries remain, with every reference to the person removed.',
        'Accounting documents are kept for as long as Italian law requires (roughly ten years). That means "delete everything" is not something we can do for invoices: personal data is anonymised, accounting records are not.',
      ],
    },
    {
      heading: 'Who else sees it',
      paragraphs: ['We rely on providers who process data on our behalf:'],
      bullets: [
        'Stripe, for payments and invoicing.',
        'Our email provider, for transactional mail.',
        'Our hosting and object storage provider.',
      ],
    },
    {
      heading: 'Where it is processed',
      paragraphs: [
        'The infrastructure sits in the European Union. Where a provider processes data outside the EU, it does so under the standard contractual clauses approved by the European Commission.',
      ],
    },
    {
      heading: 'Your rights',
      paragraphs: [
        'You may ask for access, rectification, erasure, restriction, portability, and you may object to processing.',
        'Two of those are automatic and you exercise them yourself, from the "Privacy and data" screen inside the product: you can download a complete copy of your data as JSON, and you can schedule the erasure of your account.',
        'You also have the right to lodge a complaint with your data protection authority.',
      ],
    },
    {
      heading: 'Cookies',
      paragraphs: [
        'We use strictly necessary cookies (session, interface preferences, and the record of your cookie choice). They cannot be switched off: without them the service does not work.',
        'Every other category — preferences, analytics, marketing — stays off until you turn it on. Your choice is stored in a first-party cookie carrying no identifier, and it lasts six months.',
        'You can change it at any time from the "Cookie preferences" link in the footer.',
      ],
    },
    {
      heading: 'Changes',
      paragraphs: [
        'If this policy changes we update the date above, and when the change is material we tell you by email or in the product.',
      ],
    },
  ],
};

const TERMS_IT: LegalDocument = {
  title: 'Termini di servizio',
  updated: UPDATED,
  intro: [
    'Questi termini regolano l’uso del servizio. Usandolo, li accetti.',
    'Fornitore: [Ragione sociale], [indirizzo], P.IVA [numero].',
  ],
  sections: [
    {
      heading: 'Account',
      paragraphs: [
        'Per usare il servizio serve un account. Sei responsabile delle credenziali e di tutto ciò che accade sotto il tuo account: se sospetti un accesso non autorizzato, cambia subito la password e scrivici.',
        'Devi avere almeno 18 anni, o l’età minima prevista nel tuo paese, e fornire dati veri.',
      ],
    },
    {
      heading: 'Uso accettabile',
      paragraphs: ['Non puoi usare il servizio per:'],
      bullets: [
        'attività illecite, o per violare diritti altrui;',
        'inviare spam o contenuti malevoli;',
        'tentare di accedere a dati di altre organizzazioni, o di aggirare i limiti tecnici;',
        'rivendere il servizio senza un accordo scritto.',
      ],
    },
    {
      heading: 'I tuoi contenuti',
      paragraphs: [
        'I contenuti che carichi restano tuoi. Ci concedi solo la licenza tecnica necessaria a erogare il servizio: archiviarli, trasmetterli e mostrarteli.',
        'Sei responsabile di avere i diritti su ciò che carichi.',
      ],
    },
    {
      heading: 'Abbonamenti e pagamenti',
      paragraphs: [
        'I piani a pagamento si rinnovano automaticamente alla scadenza del periodo, finché non disdici. La disdetta ha effetto alla fine del periodo già pagato: continui a usare il piano fino a quel momento.',
        'I prezzi sono indicati al netto delle imposte, che vengono aggiunte quando dovute.',
        'I pagamenti sono gestiti da Stripe.',
      ],
    },
    {
      heading: 'Disponibilità',
      paragraphs: [
        'Ci impegniamo a mantenere il servizio disponibile, ma non garantiamo un funzionamento ininterrotto. Le manutenzioni programmate vengono annunciate in anticipo quando possibile.',
      ],
    },
    {
      heading: 'Chiusura dell’account',
      paragraphs: [
        'Puoi chiudere il tuo account quando vuoi dalla pagina “Privacy e dati”. La cancellazione viene eseguita dopo 30 giorni ed è definitiva.',
        'Possiamo sospendere o chiudere un account che violi questi termini, dandone comunicazione salvo che la legge lo impedisca.',
      ],
    },
    {
      heading: 'Responsabilità',
      paragraphs: [
        'Il servizio è fornito “così com’è”. Nei limiti consentiti dalla legge, la nostra responsabilità complessiva è limitata a quanto hai pagato nei dodici mesi precedenti l’evento.',
        'Nulla in questi termini limita i diritti che la legge ti riconosce come consumatore.',
      ],
    },
    {
      heading: 'Legge applicabile',
      paragraphs: [
        'Si applica la legge italiana. Per le controversie è competente il foro di [città], salvo il foro del consumatore quando previsto.',
      ],
    },
  ],
};

const TERMS_EN: LegalDocument = {
  title: 'Terms of service',
  updated: UPDATED,
  intro: [
    'These terms govern your use of the service. By using it, you accept them.',
    'Provider: [Company name], [address], VAT [number].',
  ],
  sections: [
    {
      heading: 'Account',
      paragraphs: [
        'Using the service requires an account. You are responsible for your credentials and for everything that happens under your account: if you suspect unauthorised access, change your password immediately and tell us.',
        'You must be at least 18, or the minimum age in your country, and give accurate details.',
      ],
    },
    {
      heading: 'Acceptable use',
      paragraphs: ['You may not use the service to:'],
      bullets: [
        'do anything unlawful, or infringe anybody’s rights;',
        'send spam or malicious content;',
        'attempt to reach other organizations’ data, or to work around technical limits;',
        'resell the service without a written agreement.',
      ],
    },
    {
      heading: 'Your content',
      paragraphs: [
        'What you upload stays yours. You grant us only the technical licence needed to run the service: to store it, transmit it and show it back to you.',
        'You are responsible for holding the rights to what you upload.',
      ],
    },
    {
      heading: 'Subscriptions and payment',
      paragraphs: [
        'Paid plans renew automatically at the end of each period until you cancel. Cancelling takes effect at the end of the period you have already paid for — you keep the plan until then.',
        'Prices are shown excluding tax, which is added where due.',
        'Payments are handled by Stripe.',
      ],
    },
    {
      heading: 'Availability',
      paragraphs: [
        'We work to keep the service available, but we do not guarantee uninterrupted operation. Planned maintenance is announced in advance where possible.',
      ],
    },
    {
      heading: 'Closing your account',
      paragraphs: [
        'You can close your account at any time from the "Privacy and data" screen. Erasure is carried out after 30 days and is final.',
        'We may suspend or close an account that breaches these terms, telling you unless the law prevents it.',
      ],
    },
    {
      heading: 'Liability',
      paragraphs: [
        'The service is provided "as is". To the extent the law allows, our total liability is limited to what you paid in the twelve months before the event.',
        'Nothing here limits the rights the law gives you as a consumer.',
      ],
    },
    {
      heading: 'Governing law',
      paragraphs: [
        'Italian law applies. Disputes fall to the courts of [city], save where consumer law provides otherwise.',
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalDocumentId, Record<LegalLocale, LegalDocument>> = {
  privacy: { it: PRIVACY_IT, en: PRIVACY_EN },
  terms: { it: TERMS_IT, en: TERMS_EN },
};
