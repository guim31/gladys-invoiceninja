// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, REFRESH_INTERVALS } from '../src/config.js';
import { CONFIG_ACTION, SCENE_ACTIONS } from '../src/actions.js';
import { TRIGGERS, WIDGET_KEY } from '../src/monitor.js';
import { SETTINGS, WIDGETS } from '../src/widgets.js';
import { createNinja, createWorld, cycle } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const { gladys: registered, app } = await createWorld({ connect: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const field = (list, key) => list.find((entry) => entry.key === key);

test('identity: name, image, cover, transports, category', () => {
  assert.equal(manifest.name, 'Invoice Ninja');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-invoiceninja:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-invoiceninja/main/cover.png',
  );
  // Self-hosted or the hosted invoicing.co.
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.deepEqual(manifest.categories, ['services']);
});

test('Gladys 5.1.0 at least: widgets, scene triggers and actions', () => {
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('every manifest action, scene action and widget has its handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions), [CONFIG_ACTION]);
  assert.deepEqual(handlerKeys('action:'), [CONFIG_ACTION]);
  assert.deepEqual(keysOf(manifest.scene_actions), Object.values(SCENE_ACTIONS));
  assert.deepEqual(handlerKeys('sceneAction:'), Object.values(SCENE_ACTIONS));
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
});

test('the widget settings are the ones the code reads, all shown by default', () => {
  const [widget] = manifest.widgets;
  assert.deepEqual(keysOf(widget.settings), SETTINGS);
  for (const setting of widget.settings) {
    assert.equal(setting.type, 'boolean', setting.key);
    assert.equal(setting.default, true, setting.key);
  }
});

test('the outputs of the scene action are the declared ones', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const action of manifest.scene_actions) {
    const { success, data } = await world.fake.sceneAction(action.key, {});
    assert.equal(success, true, action.key);
    assert.deepEqual(Object.keys(data.outputs).sort(), keysOf(action.outputs).sort(), action.key);
    for (const output of action.outputs) {
      assert.equal(typeof data.outputs[output.key], output.type, `${action.key}.${output.key}`);
    }
  }
});

test('the scene triggers fired are declared, with their variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers), Object.values(TRIGGERS));
  const ninja = createNinja();
  const world = await createWorld({ ninja });
  t.after(() => world.app.stop());
  // A payment, an invoice falling due, a quote approved.
  ninja.addPayment({ id: 'p9', number: '0009', amount: 750, createdAt: 1793400000 });
  ninja.raw.invoices.data[0].due_date = '2026-10-31';
  const [accepted] = ninja.raw.accepted.data;
  ninja.raw.accepted.data.unshift({
    ...accepted,
    id: 'q9',
    number: '0009',
    updated_at: 1793400000,
  });
  await cycle(world, 60 * 30);
  assert.deepEqual(
    [...new Set(world.fake.sceneEvents.map((event) => event.key))].sort(),
    Object.values(TRIGGERS).sort(),
  );
  for (const event of world.fake.sceneEvents) {
    const trigger = field(manifest.scene_triggers, event.key);
    assert.deepEqual(trigger.fields, [], `${event.key}: no filter`);
    assert.deepEqual(Object.keys(event.data).sort(), keysOf(trigger.variables).sort(), event.key);
    for (const variable of trigger.variables) {
      assert.equal(typeof event.data[variable.key], variable.type, `${event.key}.${variable.key}`);
    }
  }
});

test('config_schema defaults and options are the ones of the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.deepEqual(DEFAULT_CONFIG[entry.key], entry.default, entry.key);
    }
  }
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((entry) => entry.type !== 'section')
      .map((entry) => entry.key)
      .sort(),
  );
  assert.equal(field(manifest.config_schema, 'api_token').type, 'secret');
  assert.deepEqual(optionValues(field(manifest.config_schema, 'language')), LANGUAGES);
  assert.deepEqual(
    optionValues(field(manifest.config_schema, 'refresh_interval')),
    REFRESH_INTERVALS,
  );
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('no number field (the form has no step)', () => {
  assert.deepEqual(
    allFields.filter((entry) => entry.type === 'number'),
    [],
  );
});

test('actions: no field at all (the core applies no default, #3154 and #3155)', () => {
  for (const action of manifest.actions) {
    assert.equal(action.fields, undefined, action.key);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
