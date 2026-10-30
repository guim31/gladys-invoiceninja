// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle
// (the start, Invoice Ninja lost and back, a scene trigger, a user action),
// never one line per refresh cycle; a failure that repeats at every cycle is
// logged once, plus one line when it is over. Invoices are private: no
// amount, no client name, no token and no server address, even at debug.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  TOKEN,
  URL_BASE,
  captureLogs,
  createDevice,
  createNinja,
  createWorld,
  cycle,
} from './helpers/world.js';

const strip = (line) => line.text.replace(/^\[[^\]]+\] /, '');

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('the start is one info line', async (t) => {
  const lines = captureLogs(t, 'info');
  await world(t);
  assert.deepEqual(lines.map(strip), [
    '[INFO] [invoiceninja] Started: Invoice Ninja read every 15 min',
  ]);
});

test('normal refresh cycles write nothing at info', async (t) => {
  const w = await world(t);
  await createDevice(w);
  const lines = captureLogs(t, 'info');
  w.ninja.raw.invoices.data[0].balance = 2000;
  for (let i = 0; i < 4; i += 1) {
    await cycle(w);
  }
  assert.deepEqual(lines, []);
});

test('a scene trigger is one info line, with the number only', async (t) => {
  const w = await world(t);
  const lines = captureLogs(t, 'info');
  w.ninja.addPayment({ id: 'p9', number: '0009', amount: 750, createdAt: 1793400000 });
  await cycle(w);
  assert.deepEqual(lines.map(strip), [
    '[INFO] [invoiceninja] Scene trigger payment_received: Payment #0009',
  ]);
});

test('Invoice Ninja down at every cycle: one warning, then one line at recovery', async (t) => {
  const ninja = createNinja();
  const w = await world(t, { ninja });
  const lines = captureLogs(t, 'info');
  ninja.down = 'ECONNREFUSED';
  for (let i = 0; i < 4; i += 1) {
    await cycle(w);
  }
  assert.deepEqual(lines.map(strip), [
    '[WARN] [invoiceninja] Reading Invoice Ninja failed: unreachable (ECONNREFUSED)',
  ]);
  ninja.down = false;
  await cycle(w);
  assert.deepEqual(lines.slice(1).map(strip), [
    '[INFO] [invoiceninja] Invoice Ninja answers again',
  ]);
});

test('even at debug: no amount, no client name, no token, no address', async (t) => {
  const lines = captureLogs(t, 'debug');
  const ninja = createNinja();
  const w = await world(t, { ninja });
  await createDevice(w);
  ninja.addPayment({ id: 'p9', number: '0009', amount: 750, createdAt: 1793400000 });
  await cycle(w);
  await w.fake.action('check_now', {});
  await w.fake.sceneAction('read_summary', {});
  await w.fake.widgetGet('overview', { language: 'fr', settings: {} });
  ninja.down = 'ECONNREFUSED';
  await cycle(w);
  ninja.down = 500;
  await cycle(w);
  ninja.down = false;
  await w.fake.configUpdated({ ...CONFIG, api_token: 'wrong-token-secret' });
  const text = lines.map((line) => line.text).join('\n');
  assert.ok(lines.length > 5);
  for (const secret of [
    TOKEN,
    'wrong-token-secret',
    URL_BASE,
    '192.0.2.20',
    'Atelier Exemple',
    'Boulangerie',
    'Garage Durand',
    'Studio',
    '750',
    '1200',
    '3980',
    '1480',
  ]) {
    assert.ok(!text.includes(secret), `"${secret}" in the logs`);
  }
});
