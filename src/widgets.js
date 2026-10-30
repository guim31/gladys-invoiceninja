// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `overview`.
//
//   tiles      overdue invoices, amount overdue, amount unpaid, paid this
//              month (counts and pending quotes when the amounts are hidden);
//   card-list  the overdue invoices, the most overdue first (5 at most): number
//              and client, due date and balance, days late as a red badge;
//   status     the latest payments (5 at most): client, amount and date;
//   caption    the name of the device in Gladys and the time of the reading.
//
// Every block can be hidden from the settings of the widget, and the amounts
// too (a dashboard seen by the whole family). 10 rows at most.
// Budget: 4 tiles, 1 card-list, 1 status, 1 text.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './monitor.js';
import { STATUS, formatAmount, formatDate, formatShortAmount, formatShortDay } from './texts.js';

export const MAX_OVERDUE = 5;
export const MAX_PAYMENTS = 5;
export const TTL_SECONDS = 300;

export const SETTINGS = ['show_amounts', 'show_summary', 'show_overdue', 'show_payments'];

export const TEXT = {
  waiting: {
    en: 'Waiting for Invoice Ninja…',
    fr: 'En attente d’Invoice Ninja…',
    de: 'Warte auf Invoice Ninja…',
    es: 'Esperando a Invoice Ninja…',
  },
  failed: {
    en: 'last reading failed',
    fr: 'dernière lecture en échec',
    de: 'letztes Lesen fehlgeschlagen',
    es: 'última lectura fallida',
  },
  overdue: { en: 'Overdue', fr: 'En retard', de: 'Überfällig', es: 'Vencidas' },
  overdueAmount: {
    en: 'Amount overdue',
    fr: 'Montant en retard',
    de: 'Überfälliger Betrag',
    es: 'Importe vencido',
  },
  unpaid: { en: 'Unpaid', fr: 'Impayé', de: 'Offen', es: 'Impagado' },
  unpaidCount: { en: 'Unpaid', fr: 'Impayées', de: 'Offen', es: 'Impagadas' },
  paidMonth: {
    en: 'Paid this month',
    fr: 'Encaissé ce mois',
    de: 'Diesen Monat bezahlt',
    es: 'Cobrado este mes',
  },
  quotes: {
    en: 'Pending quotes',
    fr: 'Devis en attente',
    de: 'Offene Angebote',
    es: 'Presupuestos pend.',
  },
  due: { en: 'Due', fr: 'Échue le', de: 'Fällig am', es: 'Vencía el' },
  readAt: { en: 'Read', fr: 'Lu le', de: 'Gelesen', es: 'Leído' },
};

// Days late on the badge of an overdue invoice (16 characters at most).
export const DAYS_LATE = {
  en: (days) => `${days} d late`,
  fr: (days) => `${days} j de retard`,
  de: (days) => `${days} T überfällig`,
  es: (days) => `${days} d de retraso`,
};

const t = (text, language) => text[language] ?? text.en;
const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
/** A boolean setting: shown unless turned off (the core may send strings). */
const on = (settings, key) => settings?.[key] !== false && settings?.[key] !== 'false';

/** The tiles of the summary. */
function tiles(snapshot, currency, language, amounts) {
  const overdue = {
    type: 'value',
    label: t(TEXT.overdue, language),
    value: snapshot.overdueCount,
    icon: 'alert-triangle',
    color: snapshot.overdueCount > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
  };
  if (!amounts) {
    return [
      overdue,
      {
        type: 'value',
        label: t(TEXT.unpaidCount, language),
        value: snapshot.unpaidCount,
        icon: 'file-text',
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        type: 'value',
        label: t(TEXT.quotes, language),
        value: snapshot.pendingQuotes,
        icon: 'clipboard',
        color: WIDGET_COLORS.NEUTRAL,
      },
    ];
  }
  const money = (label, value, icon, color) => ({
    type: 'value',
    label: t(label, language),
    value: formatShortAmount(value, currency, language),
    icon,
    color,
  });
  return [
    overdue,
    money(
      TEXT.overdueAmount,
      snapshot.overdueAmount,
      'clock',
      snapshot.overdueAmount > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    ),
    money(TEXT.unpaid, snapshot.unpaidAmount, 'file-text', WIDGET_COLORS.NEUTRAL),
    money(TEXT.paidMonth, snapshot.paidMonth, 'check-circle', WIDGET_COLORS.SUCCESS),
  ];
}

/** One overdue invoice of the card-list. */
export function overdueItem(invoice, currency, language, amounts) {
  const due = `${t(TEXT.due, language)} ${formatShortDay(invoice.dueDate, language)}`;
  return {
    title: clip(invoice.client ? `${invoice.number} · ${invoice.client}` : invoice.number, 60),
    subtitle: amounts ? `${due} · ${formatAmount(invoice.balance, currency, language)}` : due,
    badge: {
      text: clip(DAYS_LATE[language](invoice.daysLate), 16),
      color: WIDGET_COLORS.DANGER,
    },
  };
}

/** One payment of the status block. */
export function paymentRow(payment, currency, language, amounts) {
  const day = formatShortDay(payment.date, language);
  return {
    label: clip(payment.client || payment.number, 40),
    value: clip(amounts ? `${formatAmount(payment.amount, currency, language)} · ${day}` : day, 40),
    icon: 'check-circle',
    color: WIDGET_COLORS.SUCCESS,
  };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(monitor, { language = 'en', settings = {} } = {}) {
      const lang = TEXT.due[language] ? language : 'en';
      const snapshot = monitor.snapshot;
      if (!snapshot) {
        if (!monitor.problem) {
          const text = t(TEXT.waiting, lang);
          return { ttl_seconds: 60, components: [{ type: 'text', variant: 'heading', text }] };
        }
        // What to do: a refused token, a wrong address… not only "no answer".
        const text = STATUS[lang][monitor.problem];
        return { ttl_seconds: 60, components: [{ type: 'text', variant: 'body', text }] };
      }
      const currency = monitor.currency();
      const amounts = on(settings, 'show_amounts');
      const components = [];
      if (on(settings, 'show_summary')) {
        components.push(...tiles(snapshot, currency, lang, amounts));
      }
      if (on(settings, 'show_overdue') && snapshot.overdue.length > 0) {
        components.push({
          type: 'card-list',
          display: 'list',
          items: snapshot.overdue
            .slice(0, MAX_OVERDUE)
            .map((invoice) => overdueItem(invoice, currency, lang, amounts)),
        });
      }
      if (on(settings, 'show_payments') && snapshot.latestPayments.length > 0) {
        components.push({
          type: 'status',
          items: snapshot.latestPayments
            .slice(0, MAX_PAYMENTS)
            .map((payment) => paymentRow(payment, currency, lang, amounts)),
        });
      }
      // The name given in Gladys once the device is added.
      const name = monitor.createdDevice()?.name || snapshot.company.name || 'Invoice Ninja';
      // Last values kept: the problem in short, its detail is in the status.
      const unreachable = monitor.problem ? ` · ${t(TEXT.failed, lang)}` : '';
      components.push({
        type: 'text',
        variant: 'caption',
        text: clip(
          `${name} · ${t(TEXT.readAt, lang)} ${formatDate(monitor.lastSuccessAt, lang)}${unreachable}`,
          80,
        ),
      });
      return { ttl_seconds: TTL_SECONDS, components };
    },
  },
};
