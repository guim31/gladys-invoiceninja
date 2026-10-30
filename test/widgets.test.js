// -----------------------------------------------------------------------------
// The `overview` widget and the scene and configuration actions, on the
// recorded Invoice Ninja answers: within the budget of the core, in the
// language asked, each block and the amounts hideable.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { CONFIG, createDevice, createNinja, createWorld } from './helpers/world.js';

const plain = (value) => JSON.parse(JSON.stringify(value).replace(/[\u00a0\u202f]/g, ' '));

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const content = async (w, language = 'en', settings = {}) => {
  const { success, data } = await w.fake.widgetGet('overview', { language, settings });
  assert.equal(success, true);
  return data.content;
};

test('the widget: tiles, overdue invoices, latest payments, within the core budget', async (t) => {
  const w = await world(t);
  for (const language of ['en', 'fr', 'de', 'es']) {
    assert.deepEqual(validateWidgetContent(await content(w, language)), [], language);
  }
  const data = plain(await content(w, 'fr'));
  assert.deepEqual(
    data.components.filter((c) => c.type === 'value').map((c) => [c.label, c.value, c.color]),
    [
      ['En retard', 2, 'danger'],
      ['Montant en retard', '1 481 €', 'danger'],
      ['Impayé', '3 981 €', 'neutral'],
      ['Encaissé ce mois', '500 €', 'success'],
    ],
  );
  const list = data.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.subtitle, item.badge.text]),
    [
      ['0001 · Boulangerie Martin', 'Échue le 15/10 · 1 200,00 €', '15 j de retard'],
      ['0002 · Garage Durand', 'Échue le 27/10 · 280,50 €', '3 j de retard'],
    ],
  );
  const status = data.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Garage Durand', '300,00 € · 30/10'],
      ['Garage Durand', '200,00 € · 29/10'],
    ],
  );
  assert.equal(data.components.at(-1).text, 'Atelier Exemple · Lu le 30/10 18:00');
});

test('amounts hidden: counts and dates only', async (t) => {
  const w = await world(t);
  const data = plain(await content(w, 'en', { show_amounts: false }));
  assert.deepEqual(validateWidgetContent(data), []);
  assert.deepEqual(
    data.components.filter((c) => c.type === 'value').map((c) => [c.label, c.value]),
    [
      ['Overdue', 2],
      ['Unpaid', 3],
      ['Pending quotes', 4],
    ],
  );
  const text = JSON.stringify(data);
  for (const amount of ['1,200', '280.50', '300.00', '3,981', '€']) {
    assert.ok(!text.includes(amount), amount);
  }
});

test('every block can be hidden; at most 10 rows', async (t) => {
  const ninja = createNinja();
  const [late] = ninja.raw.invoices.data.slice(-1);
  for (let i = 0; i < 9; i += 1) {
    ninja.raw.invoices.data.push({ ...late, id: `late-${i}`, number: `L${i}` });
  }
  for (let i = 0; i < 9; i += 1) {
    ninja.addPayment({ id: `p-${i}`, number: `P${i}`, amount: 10, createdAt: 1793300000 + i });
  }
  const w = await world(t, { ninja });
  const data = await content(w, 'es');
  assert.deepEqual(validateWidgetContent(data), []);
  const rows =
    data.components.find((c) => c.type === 'card-list').items.length +
    data.components.find((c) => c.type === 'status').items.length;
  assert.equal(rows, 10);
  const none = await content(w, 'es', {
    show_summary: false,
    show_overdue: false,
    show_payments: false,
  });
  assert.deepEqual(
    none.components.map((c) => c.type),
    ['text'],
  );
});

test('the widget shows the name given in Gladys, and is refreshed when it changes', async (t) => {
  const w = await world(t);
  const device = await createDevice(w);
  w.clock.advance(60 * 1000);
  const refreshes = w.fake.widgetRefreshes.length;
  await w.fake.deviceUpdated({ ...device, name: 'Mes factures' });
  assert.match((await content(w, 'en')).components.at(-1).text, /^Mes factures · Read/);
  assert.ok(w.fake.widgetRefreshes.length > refreshes);
});

test('the widget before any answer, and with values kept after a failure', async (t) => {
  const down = createNinja();
  down.down = 403;
  const refused = await world(t, { ninja: down });
  assert.deepEqual(await content(refused, 'fr'), {
    ttl_seconds: 60,
    components: [{ type: 'text', variant: 'body', text: "Invoice Ninja refuse le jeton d'API." }],
  });
  const w = await world(t);
  w.ninja.down = 'ECONNREFUSED';
  await w.monitor.fresh(true);
  assert.match((await content(w, 'en')).components.at(-1).text, / · last reading failed$/);
});

test('read_summary: a sentence in the language of the configuration, and the numbers', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'de' } });
  const { success, data } = await w.fake.sceneAction('read_summary', {});
  assert.equal(success, true);
  assert.deepEqual(plain(data.outputs), {
    text: '3 offene Rechnung(en) über 3.980,50 €, davon 2 überfällig über 1.480,50 €. Diesen Monat bezahlt: 500,00 €. 4 offene(s) Angebot(e).',
    unpaid_count: 3,
    unpaid_amount: 3980.5,
    overdue_count: 2,
    overdue_amount: 1480.5,
    paid_month: 500,
    quotes_pending: 4,
  });
});

test('read_summary keeps the last values when the server is away, not when it refuses the token', async (t) => {
  const w = await world(t);
  w.ninja.down = 'ECONNREFUSED';
  w.clock.advance(60 * 60 * 1000);
  assert.equal((await w.fake.sceneAction('read_summary', {})).success, true);
  w.ninja.down = 401;
  w.clock.advance(60 * 60 * 1000);
  const refused = await w.fake.sceneAction('read_summary', {});
  assert.equal(refused.success, false);
  assert.match(refused.error, /refuse le jeton/);
});

test('check_now reads again and says what it found', async (t) => {
  const w = await world(t);
  const calls = w.ninja.calls.length;
  const { success, data } = await w.fake.action('check_now', {});
  assert.equal(success, true);
  assert.equal(w.ninja.calls.length, calls + 6);
  assert.equal(
    data.message.fr,
    'Connecté à Invoice Ninja : 3 facture(s) impayée(s), 2 en retard, 4 devis en attente.',
  );
  w.ninja.down = 'html';
  const wrong = await w.fake.action('check_now', {});
  assert.equal(wrong.data.message.en, 'No Invoice Ninja 5 API at this address: check it.');
});
