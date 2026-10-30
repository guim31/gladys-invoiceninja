// -----------------------------------------------------------------------------
// Texts produced by the container, in the four languages of Gladys (the
// language of the configuration for the feature names and the scene texts, the
// language of the dashboard for the widget), and the number and date formats.
// -----------------------------------------------------------------------------

export const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
export const LANGS = Object.keys(LOCALES);

// Feature names, frozen at creation in Gladys, keyed by feature key
// (src/devices.js).
export const NAMES = {
  en: {
    unpaid_count: 'Unpaid invoices',
    unpaid_amount: 'Amount unpaid',
    overdue_count: 'Overdue invoices',
    overdue_amount: 'Amount overdue',
    paid_month: 'Paid this month',
    quotes_pending: 'Pending quotes',
  },
  fr: {
    unpaid_count: 'Factures impayées',
    unpaid_amount: 'Montant impayé',
    overdue_count: 'Factures en retard',
    overdue_amount: 'Montant en retard',
    paid_month: 'Encaissé ce mois-ci',
    quotes_pending: 'Devis en attente',
  },
  de: {
    unpaid_count: 'Offene Rechnungen',
    unpaid_amount: 'Offener Betrag',
    overdue_count: 'Überfällige Rechnungen',
    overdue_amount: 'Überfälliger Betrag',
    paid_month: 'Diesen Monat bezahlt',
    quotes_pending: 'Offene Angebote',
  },
  es: {
    unpaid_count: 'Facturas impagadas',
    unpaid_amount: 'Importe impagado',
    overdue_count: 'Facturas vencidas',
    overdue_amount: 'Importe vencido',
    paid_month: 'Cobrado este mes',
    quotes_pending: 'Presupuestos pendientes',
  },
};

// Sentences of the scene action and of the scene triggers. Functions take `p`.
export const PHRASES = {
  en: {
    summary: (p) =>
      `${p.unpaid} unpaid invoice(s) for ${p.unpaidAmount}, ${p.overdue} overdue for ${p.overdueAmount}. Paid this month: ${p.paid}. ${p.quotes} pending quote(s).`,
    payment: (p) => `Payment received from ${p.client}: ${p.amount}.`,
    overdue: (p) => `Invoice ${p.number} of ${p.client} is overdue: ${p.amount} due on ${p.date}.`,
    quote: (p) => `Quote ${p.number} accepted by ${p.client}: ${p.amount}.`,
  },
  fr: {
    summary: (p) =>
      `${p.unpaid} facture(s) impayée(s) pour ${p.unpaidAmount}, dont ${p.overdue} en retard pour ${p.overdueAmount}. Encaissé ce mois-ci : ${p.paid}. ${p.quotes} devis en attente.`,
    payment: (p) => `Paiement reçu de ${p.client} : ${p.amount}.`,
    overdue: (p) =>
      `La facture ${p.number} de ${p.client} est en retard : ${p.amount} dû le ${p.date}.`,
    quote: (p) => `Devis ${p.number} accepté par ${p.client} : ${p.amount}.`,
  },
  de: {
    summary: (p) =>
      `${p.unpaid} offene Rechnung(en) über ${p.unpaidAmount}, davon ${p.overdue} überfällig über ${p.overdueAmount}. Diesen Monat bezahlt: ${p.paid}. ${p.quotes} offene(s) Angebot(e).`,
    payment: (p) => `Zahlung von ${p.client} erhalten: ${p.amount}.`,
    overdue: (p) =>
      `Die Rechnung ${p.number} von ${p.client} ist überfällig: ${p.amount}, fällig am ${p.date}.`,
    quote: (p) => `Angebot ${p.number} von ${p.client} angenommen: ${p.amount}.`,
  },
  es: {
    summary: (p) =>
      `${p.unpaid} factura(s) impagada(s) por ${p.unpaidAmount}, ${p.overdue} vencida(s) por ${p.overdueAmount}. Cobrado este mes: ${p.paid}. ${p.quotes} presupuesto(s) pendiente(s).`,
    payment: (p) => `Pago recibido de ${p.client}: ${p.amount}.`,
    overdue: (p) =>
      `La factura ${p.number} de ${p.client} está vencida: ${p.amount} con vencimiento el ${p.date}.`,
    quote: (p) => `Presupuesto ${p.number} aceptado por ${p.client}: ${p.amount}.`,
  },
};

// Connection status and configuration action messages, keyed by message.
export const STATUS = {
  en: {
    initFailed: 'The integration could not start: see its logs.',
    noUrl: 'Enter the address of Invoice Ninja and an API token.',
    invalidUrl: 'The address of Invoice Ninja is not understood (no user or password in it).',
    noToken: 'Enter an API token of Invoice Ninja (Settings → Account Management → API Tokens).',
    unauthorized: 'Invoice Ninja refuses the API token.',
    notInvoiceNinja: 'No Invoice Ninja 5 API at this address: check it.',
    rateLimited: 'Invoice Ninja limits the requests: the next reading will try again.',
    redirected:
      'The address of Invoice Ninja redirects elsewhere: enter the final one (often with https://).',
    serverError: 'Invoice Ninja answers with an error: the last values are kept.',
    unreachable: 'Invoice Ninja does not answer: the last values are kept.',
    readFailed: 'Invoice Ninja could not be read: see the logs of the integration.',
    summary: (p) =>
      `Connected to Invoice Ninja: ${p.unpaid} unpaid invoice(s), ${p.overdue} overdue, ${p.quotes} pending quote(s).`,
  },
  fr: {
    initFailed: "L'intégration n'a pas pu démarrer : voir ses journaux.",
    noUrl: "Indiquez l'adresse d'Invoice Ninja et un jeton d'API.",
    invalidUrl: "L'adresse d'Invoice Ninja n'est pas comprise (sans utilisateur ni mot de passe).",
    noToken:
      "Indiquez un jeton d'API d'Invoice Ninja (Paramètres → Gestion du compte → Jetons d'API).",
    unauthorized: "Invoice Ninja refuse le jeton d'API.",
    notInvoiceNinja: "Pas d'API Invoice Ninja 5 à cette adresse : vérifiez-la.",
    rateLimited: 'Invoice Ninja limite les requêtes : la prochaine lecture réessaiera.',
    redirected:
      "L'adresse d'Invoice Ninja redirige ailleurs : indiquez l'adresse finale (souvent en https://).",
    serverError: 'Invoice Ninja répond par une erreur : les dernières valeurs sont gardées.',
    unreachable: 'Invoice Ninja ne répond pas : les dernières valeurs sont gardées.',
    readFailed: "Invoice Ninja n'a pas pu être lu : voir les journaux de l'intégration.",
    summary: (p) =>
      `Connecté à Invoice Ninja : ${p.unpaid} facture(s) impayée(s), ${p.overdue} en retard, ${p.quotes} devis en attente.`,
  },
  de: {
    initFailed: 'Die Integration konnte nicht starten: siehe ihre Protokolle.',
    noUrl: 'Gib die Adresse von Invoice Ninja und ein API-Token an.',
    invalidUrl: 'Die Adresse von Invoice Ninja wird nicht verstanden (ohne Benutzer und Passwort).',
    noToken:
      'Gib ein API-Token von Invoice Ninja an (Einstellungen → Kontoverwaltung → API-Tokens).',
    unauthorized: 'Invoice Ninja lehnt das API-Token ab.',
    notInvoiceNinja: 'Keine Invoice-Ninja-5-API unter dieser Adresse: prüfe sie.',
    rateLimited: 'Invoice Ninja begrenzt die Anfragen: das nächste Lesen versucht es erneut.',
    redirected:
      'Die Adresse von Invoice Ninja leitet weiter: gib die endgültige an (oft mit https://).',
    serverError: 'Invoice Ninja antwortet mit einem Fehler: die letzten Werte bleiben erhalten.',
    unreachable: 'Invoice Ninja antwortet nicht: die letzten Werte bleiben erhalten.',
    readFailed: 'Invoice Ninja konnte nicht gelesen werden: siehe die Protokolle der Integration.',
    summary: (p) =>
      `Mit Invoice Ninja verbunden: ${p.unpaid} offene Rechnung(en), ${p.overdue} überfällig, ${p.quotes} offene(s) Angebot(e).`,
  },
  es: {
    initFailed: 'La integración no pudo iniciarse: consulte sus registros.',
    noUrl: 'Indique la dirección de Invoice Ninja y un token de API.',
    invalidUrl: 'La dirección de Invoice Ninja no se entiende (sin usuario ni contraseña).',
    noToken:
      'Indique un token de API de Invoice Ninja (Ajustes → Gestión de la cuenta → Tokens de API).',
    unauthorized: 'Invoice Ninja rechaza el token de API.',
    notInvoiceNinja: 'No hay API de Invoice Ninja 5 en esta dirección: compruébela.',
    rateLimited: 'Invoice Ninja limita las solicitudes: la próxima lectura lo volverá a intentar.',
    redirected:
      'La dirección de Invoice Ninja redirige a otra: indique la dirección final (a menudo con https://).',
    serverError: 'Invoice Ninja responde con un error: se conservan los últimos valores.',
    unreachable: 'Invoice Ninja no responde: se conservan los últimos valores.',
    readFailed: 'No se pudo leer Invoice Ninja: consulte los registros de la integración.',
    summary: (p) =>
      `Conectado a Invoice Ninja: ${p.unpaid} factura(s) impagada(s), ${p.overdue} vencida(s), ${p.quotes} presupuesto(s) pendiente(s).`,
  },
};

/** A STATUS (or PHRASES) entry as a multi-language object. */
export function render(table, key, params = {}) {
  return Object.fromEntries(
    LANGS.map((language) => {
      const entry = table[language][key];
      return [language, typeof entry === 'function' ? entry(params) : entry];
    }),
  );
}

const locale = (language) => LOCALES[language] ?? LOCALES.en;
const ISO_CURRENCY = /^[A-Z]{3}$/;

/** An amount with its currency: "1 234,56 €", "-12.30 CHF". */
export function formatAmount(value, currency, language, decimals = 2) {
  if (value === null || value === undefined) {
    return '–';
  }
  const digits = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  if (currency && ISO_CURRENCY.test(currency)) {
    try {
      return new Intl.NumberFormat(locale(language), {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        ...digits,
      }).format(value);
    } catch {
      // An unknown code falls back on the plain number.
    }
  }
  const number = new Intl.NumberFormat(locale(language), digits).format(value);
  return currency ? `${number} ${currency}` : number;
}

/** A short amount for a tile (12 characters at most): "12,3 k €". */
export function formatShortAmount(value, currency, language) {
  const plain = formatAmount(value, currency, language, 0);
  if (plain.length <= 12) {
    return plain;
  }
  const options = { notation: 'compact', maximumFractionDigits: 1 };
  try {
    return new Intl.NumberFormat(locale(language), {
      ...options,
      ...(currency && ISO_CURRENCY.test(currency)
        ? { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }
        : {}),
    })
      .format(value)
      .slice(0, 12);
  } catch {
    return new Intl.NumberFormat(locale(language), options).format(value).slice(0, 12);
  }
}

/** A date YYYY-MM-DD as the language writes it: "15/10/2026". */
export function formatDay(day, language) {
  if (!day) {
    return '–';
  }
  return new Intl.DateTimeFormat(locale(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** A short date YYYY-MM-DD: "15/10". */
export function formatShortDay(day, language) {
  if (!day) {
    return '–';
  }
  return new Intl.DateTimeFormat(locale(language), {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** Date and time in the time zone of Gladys (TZ): "15/10 17:38". */
export function formatDate(ms, language) {
  return new Intl.DateTimeFormat(locale(language), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}
