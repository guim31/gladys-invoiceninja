// -----------------------------------------------------------------------------
// Invoice Ninja v5 API client (read only) and the snapshot the rest of the
// code works on.
//
// Every request is a GET (or the read-only POST /companies/current) on
// `<address>/api/v1/...` with the headers `X-API-TOKEN` and
// `X-Requested-With: XMLHttpRequest`. One reading is six requests:
//
//   POST /companies/current        name and currency of the company of the token
//   GET  /invoices?client_status=unpaid           sent and partially paid invoices
//   GET  /payments?date_range=date,<month>        payments dated this month
//   GET  /payments?sort=created_at|desc           the latest payments (trigger, widget)
//   GET  /quotes?client_status=sent               pending quotes (count, trigger)
//   GET  /quotes?client_status=approved,converted the latest accepted quotes (trigger)
//
// `status=active,archived` leaves deleted records out, `without_deleted_clients`
// the records of deleted clients (Invoice Ninja keeps their invoices and
// payments), as its own dashboard does.
//
// Amounts are converted to the currency of the company the way Invoice Ninja
// does it (app/Services/Chart/ChartQueries.php): an invoice balance is divided
// by its `exchange_rate`, a payment multiplied by its own.
//
// Recorded answers of a real Invoice Ninja 5: test/fixtures/invoiceninja/.
// -----------------------------------------------------------------------------

import { currencyCode } from './currencies.js';

const API = '/api/v1';
const PAGE_SIZE = 100;
// 50 pages of 100 unpaid invoices: far beyond a small business, and a bound
// against an answer that would never end.
const MAX_PAGES = 50;
export const LATEST_PAYMENTS = 10;
export const LATEST_QUOTES = 20;
const TIMEOUT_MS = 30000;

// Invoice statuses (app/Models/Invoice.php) and payment statuses
// (app/Models/Payment.php) the snapshot keeps.
const INVOICE_SENT = '2';
const INVOICE_PARTIAL = '3';
const PAYMENT_DONE = ['4', '5', '6']; // completed, partially refunded, refunded
const QUOTE_APPROVED = '3';
const QUOTE_CONVERTED = '4';

/** A failed reading: `problem` is a key of STATUS (src/texts.js), `code` a short detail for the logs. */
export class InvoiceNinjaError extends Error {
  constructor(problem, code) {
    super(`Invoice Ninja: ${problem} (${code})`);
    this.name = 'InvoiceNinjaError';
    this.problem = problem;
    this.code = code;
  }
}

/** The problem of an HTTP status. */
function problemOfStatus(status) {
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status === 404 || status === 405) {
    return 'notInvoiceNinja';
  }
  if (status === 429) {
    return 'rateLimited';
  }
  if (status >= 300 && status < 400) {
    return 'redirected';
  }
  return 'serverError';
}

/**
 * @param {object} options
 * @param {string} options.url address of Invoice Ninja (normalized, see src/config.js)
 * @param {string} options.token API token
 * @param {Function} [options.fetch] the tests pass a fake answering the fixtures
 */
export function createClient({ url, token, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  async function request(method, path, query = {}) {
    const search = new URLSearchParams(query).toString();
    let response;
    try {
      response = await fetch(`${url}${API}${path}${search ? `?${search}` : ''}`, {
        method,
        headers: {
          'X-API-TOKEN': token,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
        // Never followed: fetch would send the X-API-TOKEN header on to another
        // host, and turn the POST into a GET. The user enters the final address.
        redirect: 'manual',
      });
    } catch (err) {
      // The message of fetch can hold the address: only its code is kept.
      throw new InvoiceNinjaError(
        'unreachable',
        err?.cause?.code ?? (err?.name === 'TimeoutError' ? 'timeout' : 'network'),
      );
    }
    if (!response.ok || response.type === 'opaqueredirect') {
      await response.body?.cancel().catch(() => {});
      throw new InvoiceNinjaError(problemOfStatus(response.status), `HTTP ${response.status}`);
    }
    // An unknown path of Invoice Ninja, or another site, answers its HTML page.
    if (!/json/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel().catch(() => {});
      throw new InvoiceNinjaError('notInvoiceNinja', 'not-json');
    }
    try {
      return await response.json();
    } catch {
      throw new InvoiceNinjaError('notInvoiceNinja', 'bad-json');
    }
  }

  /** Every page of a list (bounded by MAX_PAGES). */
  async function all(path, query) {
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const answer = await request('GET', path, { ...query, per_page: PAGE_SIZE, page });
      items.push(...listOf(answer));
      const pages = Number(answer?.meta?.pagination?.total_pages ?? 1);
      if (page >= pages) {
        break;
      }
    }
    return items;
  }

  return { request, all };
}

const listOf = (answer) => {
  if (!Array.isArray(answer?.data)) {
    throw new InvoiceNinjaError('notInvoiceNinja', 'no-data');
  }
  return answer.data;
};

// Live records only: deleted ones and those of deleted clients stay out.
const LIVE = { status: 'active,archived', without_deleted_clients: 'true' };

/**
 * Read everything a snapshot needs.
 * @param {object} client from createClient
 * @param {object} period `{ first, last }`: the current month, YYYY-MM-DD
 */
export async function readRaw(client, period) {
  const company = await client.request('POST', '/companies/current');
  const invoices = await client.all('/invoices', {
    client_status: 'unpaid',
    ...LIVE,
    include: 'client',
    // A stable order across the pages.
    sort: 'id|asc',
  });
  const monthPayments = await client.all('/payments', {
    date_range: `date,${period.first},${period.last}`,
    ...LIVE,
    sort: 'id|asc',
  });
  const latestPayments = listOf(
    await client.request('GET', '/payments', {
      sort: 'created_at|desc',
      ...LIVE,
      include: 'client',
      per_page: LATEST_PAYMENTS,
    }),
  );
  // Every pending quote: an accepted quote is news when it was pending before.
  const pending = await client.all('/quotes', { client_status: 'sent', ...LIVE, sort: 'id|asc' });
  const acceptedQuotes = listOf(
    await client.request('GET', '/quotes', {
      client_status: 'approved,converted',
      sort: 'updated_at|desc',
      ...LIVE,
      include: 'client',
      per_page: LATEST_QUOTES,
    }),
  );
  return { company, invoices, monthPayments, latestPayments, pending, acceptedQuotes };
}

// --- Snapshot -------------------------------------------------------------------

const round = (value) => Math.round(value * 100) / 100;
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const rate = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};
/** YYYY-MM-DD of a date field ("2026-10-15", "2026-10-15 00:00:00"), or null. */
function dayOf(value) {
  const day = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  // A real calendar day only ("2026-00-00", "2026-02-31" are not).
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day) ? day : null;
}
const clientName = (record) =>
  String(record?.client?.display_name || record?.client?.name || '').trim();
const live = (record) => record && !record.is_deleted;

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** The invoice as the integration sees it; `overdue` like Invoice Ninja's own filter. */
function parseInvoice(invoice, today) {
  const dueDate = dayOf(invoice.due_date);
  const partialDueDate = number(invoice.partial) > 0 ? dayOf(invoice.partial_due_date) : null;
  const lateSince = [dueDate, partialDueDate].filter((day) => day && day < today).sort()[0];
  return {
    id: String(invoice.id),
    number: String(invoice.number ?? ''),
    client: clientName(invoice),
    balance: round(number(invoice.balance) / rate(invoice.exchange_rate)),
    // When late: the date that is past (the partial due date can be the one).
    dueDate: lateSince ?? dueDate,
    overdue: Boolean(lateSince),
    daysLate: lateSince ? daysBetween(lateSince, today) : 0,
  };
}

/** Amount of a payment in the currency of the company, refunds taken off. */
const paymentAmount = (payment) =>
  (number(payment.amount) - number(payment.refunded)) * rate(payment.exchange_rate);

/**
 * The snapshot of one reading.
 * @param {object} raw from readRaw
 * @param {string} today YYYY-MM-DD in the time zone of Gladys
 */
export function parseSnapshot(raw, today) {
  const company = raw.company?.data;
  if (!company?.id) {
    throw new InvoiceNinjaError('notInvoiceNinja', 'no-company');
  }
  const unpaid = raw.invoices
    .filter(live)
    .filter((invoice) => [INVOICE_SENT, INVOICE_PARTIAL].includes(String(invoice.status_id)))
    .map((invoice) => parseInvoice(invoice, today))
    .filter((invoice) => invoice.balance > 0);
  const overdue = unpaid
    .filter((invoice) => invoice.overdue)
    .sort((a, b) => b.daysLate - a.daysLate || a.number.localeCompare(b.number));
  const paid = (payment) => live(payment) && PAYMENT_DONE.includes(String(payment.status_id));
  const sum = (items, value) => round(items.reduce((total, item) => total + value(item), 0));
  return {
    company: {
      id: String(company.id),
      name: String(company.settings?.name ?? '').trim(),
      currency: currencyCode(company.settings?.currency_id),
    },
    unpaidCount: unpaid.length,
    unpaidAmount: sum(unpaid, (invoice) => invoice.balance),
    overdue,
    overdueCount: overdue.length,
    overdueAmount: sum(overdue, (invoice) => invoice.balance),
    paidMonth: sum(raw.monthPayments.filter(paid), paymentAmount),
    latestPayments: raw.latestPayments.filter(paid).map((payment) => ({
      id: String(payment.id),
      number: String(payment.number ?? ''),
      client: clientName(payment),
      amount: round(paymentAmount(payment)),
      date: dayOf(payment.date),
      createdAt: number(payment.created_at),
    })),
    pendingQuotes: raw.pending.filter(live).length,
    pendingQuoteIds: raw.pending.filter(live).map((quote) => String(quote.id)),
    acceptedQuotes: raw.acceptedQuotes
      .filter(live)
      .filter(
        (quote) =>
          [QUOTE_APPROVED, QUOTE_CONVERTED].includes(String(quote.status_id)) || quote.invoice_id,
      )
      .map((quote) => ({
        id: String(quote.id),
        number: String(quote.number ?? ''),
        client: clientName(quote),
        amount: round(number(quote.amount) / rate(quote.exchange_rate)),
        createdAt: number(quote.created_at),
        updatedAt: number(quote.updated_at),
      })),
  };
}

/** The local date and the current month, in the time zone of Gladys (TZ). */
export function periodOf(ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  );
  const { year, month, day } = parts;
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    today: `${year}-${month}-${day}`,
    first: `${year}-${month}-01`,
    last: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** The problem of any error of a reading. */
export const problemOf = (err) => (err instanceof InvoiceNinjaError ? err.problem : 'readFailed');
