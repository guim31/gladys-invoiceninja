// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Invoice Ninja serving
// the answers recorded on a real Invoice Ninja 5 (test/fixtures/invoiceninja:
// three clients, three unpaid invoices of which two overdue, one partially
// paid, two payments this month, four pending quotes and one approved), a
// manual clock, a temporary /data, and the integration wired on top through
// registerHandlers. Nothing touches the network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';
process.env.TZ = 'Europe/Paris';

export const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/invoiceninja/${name}.json`, import.meta.url), 'utf8'),
  );

export const TOKEN = 'test-token-0000000000000000000000000000000000000000000000000000';
export const URL_BASE = 'http://192.0.2.20:8080';
export const CONFIG = { url: URL_BASE, api_token: TOKEN };

// The answers were recorded on 30/10/2026, Paris time.
export const START = Date.parse('2026-10-30T18:00:00+01:00');

/** The recorded company id, the platform id of the device. */
export const COMPANY_ID = 'VolejRejNm';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Fake Invoice Ninja, as a fetch. `ninja.down`: a network error code
 * ('ECONNREFUSED'...), an HTTP status, 'html' (another site), or false.
 * `ninja.raw` holds the answers to change; `ninja.calls` the URLs asked.
 */
export function createNinja() {
  const ninja = {
    down: false,
    calls: [],
    raw: {
      company: fixture('company'),
      invoices: fixture('invoices_unpaid'),
      monthPayments: fixture('payments_month'),
      latestPayments: fixture('payments_latest'),
      pending: fixture('quotes_pending'),
      accepted: fixture('quotes_accepted'),
    },

    /** A recorded payment, made new: another id, number, amount and creation time. */
    addPayment({ id, number, amount, client = 'Studio Lumière', createdAt }) {
      const [template] = fixture('payments_latest').data;
      const payment = {
        ...template,
        id,
        number,
        amount,
        applied: amount,
        created_at: createdAt,
        updated_at: createdAt,
        client: { ...template.client, name: client, display_name: client },
      };
      ninja.raw.latestPayments.data.unshift(payment);
      ninja.raw.monthPayments.data.unshift(payment);
      return payment;
    },

    async fetch(url, options = {}) {
      ninja.calls.push({ url: String(url), method: options.method ?? 'GET' });
      if (typeof ninja.down === 'string' && ninja.down !== 'html') {
        throw new TypeError('fetch failed', { cause: { code: ninja.down } });
      }
      if (typeof ninja.down === 'number') {
        return json({ message: 'Error' }, ninja.down);
      }
      if (ninja.down === 'html') {
        return new Response('<!DOCTYPE html><html></html>', {
          headers: { 'content-type': 'text/html; charset=UTF-8' },
        });
      }
      if (options.headers?.['X-API-TOKEN'] !== TOKEN) {
        return json(fixture('invalid_token'), 403);
      }
      const { pathname, searchParams } = new URL(url);
      const query = Object.fromEntries(searchParams);
      const route = `${options.method ?? 'GET'} ${pathname.replace(/^\/api\/v1/, '')}`;
      if (route === 'POST /companies/current') {
        return json(ninja.raw.company);
      }
      if (route === 'GET /invoices' && query.client_status === 'unpaid') {
        return json(ninja.raw.invoices);
      }
      if (route === 'GET /payments' && query.date_range) {
        return json(ninja.raw.monthPayments);
      }
      if (route === 'GET /payments' && query.sort === 'created_at|desc') {
        return json(ninja.raw.latestPayments);
      }
      if (route === 'GET /quotes' && query.client_status === 'sent') {
        return json(ninja.raw.pending);
      }
      if (route === 'GET /quotes' && query.client_status === 'approved,converted') {
        return json(ninja.raw.accepted);
      }
      return new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html' } });
    },
  };
  ninja.fetch = ninja.fetch.bind(ninja);
  return ninja;
}

/** A manual clock. */
export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {object} [options.ninja] from createNinja
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  config = CONFIG,
  devices = [],
  ninja = createNinja(),
  connect = true,
  clock = createClock(),
  timers = false,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-invoiceninja-')),
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const store = new Store(dataDir);
  const app = registerHandlers(gladys, {
    store,
    fetch: ninja.fetch,
    timers,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await app.monitor.running;
  }
  return { gladys, fake: gladys.fake, app, monitor: app.monitor, ninja, clock, store, dataDir };
}

/** Create the discovered device in Gladys, as the user would. */
export async function createDevice(world) {
  const [device] = world.fake.discoveredDevices;
  await world.fake.deviceCreated(device);
  return device;
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

/** Run one refresh cycle, `minutes` later. */
export async function cycle(world, minutes = 15) {
  world.clock.advance(minutes * 60 * 1000);
  await world.monitor.runCycle();
}

/**
 * Capture the integration's log lines at `level` and above (LOG_LEVEL is read
 * at every call). Returns the lines as `{ level, text }`.
 */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
