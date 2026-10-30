// -----------------------------------------------------------------------------
// The monitor on the recorded Invoice Ninja answers: the device and its states,
// the integration's own timer (the 5.2.0 trap), the connection status and the
// transport pill, and the three scene triggers with their starting point kept
// under /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANY_ID,
  CONFIG,
  createDevice,
  createNinja,
  createWorld,
  cycle,
  featureId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);

test('one device for the company, with should_poll false, and no state before it is added', async (t) => {
  const w = await world(t);
  const devices = w.fake.discoveredDevices;
  assert.equal(devices.length, 1);
  assert.equal(devices[0].external_id, `ext:test-integration:company:${COMPANY_ID}`);
  assert.equal(devices[0].name, 'Atelier Exemple');
  assert.equal(devices[0].should_poll, false);
  assert.deepEqual(
    devices[0].features.map((feature) => [feature.name, feature.unit]),
    [
      ['Factures impayées', undefined],
      ['Montant impayé', 'euro'],
      ['Factures en retard', undefined],
      ['Montant en retard', 'euro'],
      ['Encaissé ce mois-ci', 'euro'],
      ['Devis en attente', undefined],
    ],
  );
  assert.equal(w.fake.bodies('POST', '/state').length, 0);
});

test('adding the device publishes every state, then only the changes', async (t) => {
  const w = await world(t);
  const device = await createDevice(w);
  const state = (key) => w.fake.lastState(featureId(device, key));
  assert.deepEqual(
    [
      'unpaid_count',
      'unpaid_amount',
      'overdue_count',
      'overdue_amount',
      'paid_month',
      'quotes_pending',
    ].map(state),
    [3, 3980.5, 2, 1480.5, 500, 4],
  );
  const published = w.fake.bodies('POST', '/state').length;
  await cycle(w);
  assert.equal(w.fake.bodies('POST', '/state').length, published, 'nothing changed');
  w.ninja.raw.invoices.data.pop(); // 0001 paid
  await cycle(w);
  assert.equal(state('unpaid_count'), 2);
  assert.equal(state('overdue_amount'), 280.5);
});

test('the container reads by its own timer, without any poll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const w = await world(t, { timers: true });
  const reads = () =>
    w.ninja.calls.filter((call) => call.url.includes('/companies/current')).length;
  assert.equal(reads(), 1);
  t.mock.timers.tick(15 * 60 * 1000);
  await w.monitor.running;
  assert.equal(reads(), 2);
  await w.fake.configUpdated({ ...CONFIG, refresh_interval: '60' });
  const before = reads();
  t.mock.timers.tick(15 * 60 * 1000);
  assert.equal(reads(), before, 'no reading after 15 min at 60 min');
  t.mock.timers.tick(45 * 60 * 1000);
  await w.monitor.running;
  assert.equal(reads(), before + 1);
});

test('connection status and transport pill: local, cloud for invoicing.co, unreachable', async (t) => {
  const w = await world(t);
  await createDevice(w);
  const transports = () =>
    w.fake.bodies('POST', '/device/transport').map((body) => body.transports[0].transport);
  assert.deepEqual(transports(), ['local']);
  w.ninja.down = 'ECONNREFUSED';
  await cycle(w);
  assert.deepEqual(transports(), ['local', 'unreachable']);
  const status = w.fake.bodies('POST', '/connection_status').at(-1);
  assert.equal(status.connected, false);
  assert.equal(
    status.message.de,
    'Invoice Ninja antwortet nicht: die letzten Werte bleiben erhalten.',
  );
  w.ninja.down = false;
  await w.fake.configUpdated({ ...CONFIG, url: 'invoicing.co' });
  assert.deepEqual(transports(), ['local', 'unreachable', 'cloud']);
});

test('a refused token: the status says so, and the last values are dropped', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated({ ...CONFIG, api_token: 'wrong' });
  assert.equal(w.monitor.problem, 'unauthorized');
  assert.equal(w.monitor.snapshot, null);
  const status = w.fake.bodies('POST', '/connection_status').at(-1);
  assert.deepEqual(status.message.fr, "Invoice Ninja refuse le jeton d'API.");
});

test('missing configuration: no request, the status says what to enter', async (t) => {
  const ninja = createNinja();
  const w = await world(t, { ninja, config: { url: 'http://192.0.2.20' } });
  assert.equal(ninja.calls.length, 0);
  assert.equal(w.monitor.problem, 'noToken');
  const status = w.fake.bodies('POST', '/connection_status').at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.en, /API token/);
});

test('first reading: what exists is the starting point, nothing fires', async (t) => {
  const w = await world(t);
  await cycle(w);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('payment_received: a new payment, once, with its sentence', async (t) => {
  const w = await world(t);
  w.ninja.addPayment({ id: 'p9', number: '0009', amount: 750, createdAt: 1793400000 });
  await cycle(w);
  await cycle(w);
  const fired = events(w, 'payment_received');
  assert.equal(fired.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(fired[0].data).replace(/[\u00a0\u202f]/g, ' ')), {
    number: '0009',
    client: 'Studio Lumière',
    amount: 750,
    currency: 'EUR',
    date: '2026-10-30',
    text: 'Paiement reçu de Studio Lumière : 750,00 €.',
  });
});

test('payment_received: an old payment coming back into the page is not news', async (t) => {
  const w = await world(t);
  w.ninja.addPayment({ id: 'old', number: '0000', amount: 10, createdAt: 1700000000 });
  await cycle(w);
  assert.deepEqual(events(w, 'payment_received'), []);
});

test('invoice_overdue: an invoice passing its due date fires once, again after being paid off and late anew', async (t) => {
  const w = await world(t);
  const invoice = w.ninja.raw.invoices.data[0]; // 0003, Studio Lumière, 2 500 €
  invoice.due_date = '2026-10-31';
  await cycle(w, 60); // 30/10 19:00: not late yet
  assert.deepEqual(events(w, 'invoice_overdue'), []);
  await cycle(w, 60 * 6); // 31/10 01:00: due today, not late
  assert.deepEqual(events(w, 'invoice_overdue'), []);
  await cycle(w, 60 * 24); // 01/11 01:00
  await cycle(w);
  const fired = events(w, 'invoice_overdue');
  assert.equal(fired.length, 1);
  assert.equal(fired[0].data.number, '0003');
  assert.equal(fired[0].data.balance, 2500);
  assert.equal(fired[0].data.days_late, 1);
  assert.equal(fired[0].data.due_date, '2026-10-31');
  assert.match(
    fired[0].data.text,
    /^La facture 0003 de Studio Lumière est en retard : 2.500,00.€ dû le 31\/10\/2026\.$/,
  );
  // Paid, then a new due date passed again.
  w.ninja.raw.invoices.data.shift();
  await cycle(w);
  w.ninja.raw.invoices.data.unshift({ ...invoice, due_date: '2026-11-01' });
  await cycle(w, 60 * 24);
  assert.equal(events(w, 'invoice_overdue').length, 2);
});

test('quote_accepted: a quote approved or converted fires once', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'en' } });
  const [accepted] = w.ninja.raw.accepted.data;
  w.ninja.raw.accepted.data.unshift({
    ...accepted,
    id: 'q9',
    number: '0009',
    status_id: '4',
    amount: 650,
    updated_at: 1793400000,
  });
  await cycle(w);
  await cycle(w);
  const fired = events(w, 'quote_accepted');
  assert.equal(fired.length, 1);
  assert.equal(
    fired[0].data.text.replace(/[\u00a0\u202f]/g, ' '),
    'Quote 0009 accepted by Studio Lumière: €650.00.',
  );
});

test('a restart fires nothing twice; another company starts from scratch', async (t) => {
  const first = await createWorld();
  first.ninja.addPayment({ id: 'p9', number: '0009', amount: 750, createdAt: 1793400000 });
  await cycle(first);
  await first.app.stop();
  assert.equal(events(first, 'payment_received').length, 1);

  const again = await world(t, { ninja: first.ninja, dataDir: first.dataDir });
  await cycle(again);
  assert.deepEqual(again.fake.sceneEvents, []);

  const other = createNinja();
  other.raw.company.data.id = 'OtherCompany';
  other.addPayment({ id: 'p10', number: '0010', amount: 1, createdAt: 1793400000 });
  const switched = await world(t, { ninja: other, dataDir: first.dataDir });
  await cycle(switched);
  assert.deepEqual(switched.fake.sceneEvents, []);
});

test('a scene event refused by Gladys is sent again at the next cycle', async (t) => {
  const w = await world(t);
  w.ninja.addPayment({ id: 'p9', number: '0009', amount: 750, createdAt: 1793400000 });
  const publish = w.gladys.publishSceneEvent.bind(w.gladys);
  let refuse = true;
  w.gladys.publishSceneEvent = async (...args) => {
    if (refuse) {
      throw Object.assign(new Error('Gladys away'), { status: 503 });
    }
    return publish(...args);
  };
  await cycle(w);
  assert.deepEqual(events(w, 'payment_received'), []);
  refuse = false;
  await cycle(w);
  assert.equal(events(w, 'payment_received').length, 1);
});

test('a damaged state file is a fresh start, not a crash', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${first.dataDir}/invoiceninja.json`, '{"version":1,"company":"x","payments":3}');
  const w = await world(t, { dataDir: first.dataDir });
  assert.equal(w.monitor.problem, null);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('payment_received: a payment pending at first is told once completed, even after newer ones', async (t) => {
  const w = await world(t);
  const pending = w.ninja.addPayment({
    id: 'p8',
    number: '0008',
    amount: 90,
    createdAt: 1793390000,
  });
  pending.status_id = '1';
  await cycle(w);
  w.ninja.addPayment({ id: 'p9', number: '0009', amount: 750, createdAt: 1793400000 });
  await cycle(w);
  pending.status_id = '4';
  await cycle(w);
  assert.deepEqual(
    events(w, 'payment_received').map((event) => event.data.number),
    ['0009', '0008'],
  );
});

test('quote_accepted: a pending quote accepted fires, an old accepted quote edited does not', async (t) => {
  const w = await world(t);
  const [accepted] = w.ninja.raw.accepted.data;
  // Accepted long ago, outside the page read at the start, edited now.
  w.ninja.raw.accepted.data.push({
    ...accepted,
    id: 'old',
    number: '0000',
    created_at: 1700000000,
    updated_at: 1793400000,
  });
  // 0006, pending at the start, approved now.
  const pending = w.ninja.raw.pending.data.find((quote) => quote.number === '0006');
  w.ninja.raw.pending.data = w.ninja.raw.pending.data.filter((quote) => quote !== pending);
  w.ninja.raw.accepted.data.unshift({ ...pending, status_id: '3', updated_at: 1793400001 });
  await cycle(w);
  assert.deepEqual(
    events(w, 'quote_accepted').map((event) => event.data.number),
    ['0006'],
  );
});

test('the widget is asked to reload when a reading starts or stops failing', async (t) => {
  const w = await world(t);
  const count = () => w.fake.widgetRefreshes.length;
  const before = count();
  w.ninja.down = 'ECONNREFUSED';
  await cycle(w);
  assert.equal(count(), before + 1);
  w.ninja.down = false;
  await cycle(w);
  assert.equal(count(), before + 2);
});

test('quote_accepted refused by Gladys is sent again at the next cycle', async (t) => {
  const w = await world(t);
  const pending = w.ninja.raw.pending.data.find((quote) => quote.number === '0006');
  w.ninja.raw.pending.data = w.ninja.raw.pending.data.filter((quote) => quote !== pending);
  w.ninja.raw.accepted.data.unshift({ ...pending, status_id: '3', updated_at: 1793400001 });
  const publish = w.gladys.publishSceneEvent.bind(w.gladys);
  let refuse = true;
  w.gladys.publishSceneEvent = async (...args) => {
    if (refuse) {
      throw Object.assign(new Error('Gladys away'), { status: 503 });
    }
    return publish(...args);
  };
  await cycle(w);
  refuse = false;
  await cycle(w);
  await cycle(w);
  assert.deepEqual(
    events(w, 'quote_accepted').map((event) => event.data.number),
    ['0006'],
  );
});
