// -----------------------------------------------------------------------------
// The client of the Invoice Ninja API and the snapshot, on the answers recorded
// on a real Invoice Ninja 5 (test/fixtures/invoiceninja), and the address typed
// by the user.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHosted, normalizeConfig, parseUrl } from '../src/config.js';
import { currencyCode } from '../src/currencies.js';
import {
  InvoiceNinjaError,
  createClient,
  daysBetween,
  parseSnapshot,
  periodOf,
  readRaw,
} from '../src/invoiceninja.js';
import { START, TOKEN, URL_BASE, createNinja } from './helpers/world.js';

const read = async (ninja, token = TOKEN) =>
  readRaw(createClient({ url: URL_BASE, token, fetch: ninja.fetch }), periodOf(START));

test('a reading asks the six endpoints, with the token and the filters', async () => {
  const ninja = createNinja();
  await read(ninja);
  const asked = ninja.calls.map(({ method, url }) => {
    const { pathname, searchParams } = new URL(url);
    return `${method} ${pathname}?${searchParams.get('client_status') ?? searchParams.get('date_range') ?? searchParams.get('sort') ?? ''}`;
  });
  assert.deepEqual(asked, [
    'POST /api/v1/companies/current?',
    'GET /api/v1/invoices?unpaid',
    'GET /api/v1/payments?date,2026-10-01,2026-10-31',
    'GET /api/v1/payments?created_at|desc',
    'GET /api/v1/quotes?sent',
    'GET /api/v1/quotes?approved,converted',
  ]);
  for (const { url } of ninja.calls.slice(1)) {
    const query = new URL(url).searchParams;
    assert.equal(query.get('status'), 'active,archived', url);
    assert.equal(query.get('without_deleted_clients'), 'true', url);
  }
});

test('the snapshot of the recorded answers', async () => {
  const snapshot = parseSnapshot(await read(createNinja()), '2026-10-30');
  assert.deepEqual(snapshot.company, {
    id: 'VolejRejNm',
    name: 'Atelier Exemple',
    currency: 'EUR',
  });
  assert.equal(snapshot.unpaidCount, 3);
  assert.equal(snapshot.unpaidAmount, 3980.5);
  assert.deepEqual(
    snapshot.overdue.map((invoice) => [
      invoice.number,
      invoice.client,
      invoice.balance,
      invoice.daysLate,
    ]),
    [
      ['0001', 'Boulangerie Martin', 1200, 15],
      ['0002', 'Garage Durand', 280.5, 3],
    ],
  );
  assert.equal(snapshot.overdueAmount, 1480.5);
  assert.equal(snapshot.paidMonth, 500);
  assert.deepEqual(
    snapshot.latestPayments.map((payment) => [payment.number, payment.amount, payment.date]),
    [
      ['0002', 300, '2026-10-30'],
      ['0001', 200, '2026-10-29'],
    ],
  );
  assert.equal(snapshot.pendingQuotes, 4);
  assert.deepEqual(
    snapshot.acceptedQuotes.map((quote) => [quote.number, quote.client, quote.amount]),
    [['0005', 'Studio Lumière', 3200]],
  );
});

test('a due date of today is not late yet; a partial due date can be', async () => {
  const raw = await read(createNinja());
  const [invoice] = raw.invoices; // 0003, due 2026-11-24
  invoice.due_date = '2026-10-30';
  assert.equal(parseSnapshot(raw, '2026-10-30').overdueCount, 2);
  invoice.partial = 500;
  invoice.partial_due_date = '2026-10-20';
  const snapshot = parseSnapshot(raw, '2026-10-30');
  assert.equal(snapshot.overdueCount, 3);
  assert.equal(snapshot.overdue.find((late) => late.number === '0003').daysLate, 10);
});

test('amounts in the currency of the company, like Invoice Ninja (exchange rates)', async () => {
  const raw = await read(createNinja());
  // An invoice in a client currency: balance / rate. A payment: (amount - refunded) * rate.
  raw.invoices[0].exchange_rate = 2;
  raw.monthPayments[0].exchange_rate = 0.5;
  raw.monthPayments[1].refunded = 50;
  const snapshot = parseSnapshot(raw, '2026-10-30');
  assert.equal(snapshot.unpaidAmount, 1250 + 280.5 + 1200);
  assert.equal(snapshot.paidMonth, 150 + 150);
});

test('drafts, paid, deleted records and payments not completed are left out', async () => {
  const raw = await read(createNinja());
  raw.invoices[0].status_id = '1';
  raw.invoices[1].is_deleted = true;
  raw.monthPayments[0].status_id = '1'; // pending
  raw.latestPayments[1].status_id = '3'; // failed
  const snapshot = parseSnapshot(raw, '2026-10-30');
  assert.equal(snapshot.unpaidCount, 1);
  assert.equal(snapshot.paidMonth, 200);
  assert.deepEqual(
    snapshot.latestPayments.map((payment) => payment.number),
    ['0002'],
  );
});

test('every page of the unpaid invoices is read', async () => {
  const ninja = createNinja();
  const first = ninja.raw.invoices;
  const second = structuredClone(first);
  second.data = second.data.map((invoice) => ({ ...invoice, id: `${invoice.id}-2` }));
  first.meta.pagination.total_pages = 2;
  const fetch = (url, options) => {
    const page = new URL(url).searchParams.get('page');
    if (url.includes('/invoices') && page === '2') {
      ninja.raw.invoices = second;
    }
    const answer = ninja.fetch(url, options);
    ninja.raw.invoices = first;
    return answer;
  };
  const raw = await readRaw(createClient({ url: URL_BASE, token: TOKEN, fetch }), periodOf(START));
  assert.equal(raw.invoices.length, 6);
});

test('failures become problems the user can act on, without the address', async () => {
  const cases = [
    [403, 'unauthorized', 'HTTP 403'],
    [404, 'notInvoiceNinja', 'HTTP 404'],
    [429, 'rateLimited', 'HTTP 429'],
    [502, 'serverError', 'HTTP 502'],
    ['html', 'notInvoiceNinja', 'not-json'],
    ['ECONNREFUSED', 'unreachable', 'ECONNREFUSED'],
  ];
  for (const [down, problem, code] of cases) {
    const ninja = createNinja();
    ninja.down = down;
    await assert.rejects(read(ninja), (err) => {
      assert.ok(err instanceof InvoiceNinjaError);
      assert.equal(err.problem, problem, String(down));
      assert.equal(err.code, code);
      assert.ok(!err.message.includes('192.0.2.20'));
      return true;
    });
  }
  // A wrong token: the recorded 403 of Invoice Ninja.
  await assert.rejects(read(createNinja(), 'wrong'), { problem: 'unauthorized' });
});

test('the address typed by the user', () => {
  assert.equal(parseUrl('192.168.1.20:8000'), 'http://192.168.1.20:8000');
  assert.equal(parseUrl(' https://invoicing.co/ '), 'https://invoicing.co');
  assert.equal(parseUrl('https://example.com/ninja/api/v1/'), 'https://example.com/ninja');
  assert.equal(parseUrl('https://user:pass@example.com'), null);
  assert.equal(parseUrl(''), null);
  assert.ok(isHosted('https://invoicing.co'));
  assert.ok(!isHosted('http://192.168.1.20'));
  const config = normalizeConfig({ url: 'https://u:p@x', api_token: ' t ', refresh_interval: '7' });
  assert.deepEqual(config, {
    url: null,
    invalidUrl: true,
    token: 't',
    refreshMinutes: 15,
    language: 'fr',
  });
});

test('the month and the day in the time zone of Gladys', () => {
  // 31/10 23:30 in Paris is still October there.
  assert.deepEqual(periodOf(Date.parse('2026-10-31T22:30:00Z')), {
    today: '2026-10-31',
    first: '2026-10-01',
    last: '2026-10-31',
  });
  assert.deepEqual(periodOf(Date.parse('2028-02-10T12:00:00Z')), {
    today: '2028-02-10',
    first: '2028-02-01',
    last: '2028-02-29',
  });
  assert.equal(daysBetween('2026-10-25', '2026-10-30'), 5);
  assert.equal(currencyCode('3'), 'EUR');
  assert.equal(currencyCode(17), 'CHF');
  assert.equal(currencyCode('999999'), null);
});
