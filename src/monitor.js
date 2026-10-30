// -----------------------------------------------------------------------------
// The monitor: reads Invoice Ninja every `refresh_interval` minutes, publishes
// the company device and its states, fires the scene triggers and serves the
// widget and the actions.
//
// The device is published with should_poll: false: the container runs its own
// timer (the core only polls up to one minute, and see the 5.2.0 trap in
// CLAUDE.md). States go to the device once it is added in Gladys; the scene
// triggers and the widget work without it.
//
// Triggers: `payment_received` (a new payment), `invoice_overdue` (an unpaid
// invoice passes its due date) and `quote_accepted` (a quote approved or
// converted to an invoice). What exists at the first reading of a company is
// the starting point, not news. What was seen is kept under /data: a restart
// fires nothing twice.
//
// Invoices are private: the logs only ever hold counts, error codes and short
// references, never an amount, a client name, the token or the address.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isHosted } from './config.js';
import { buildDevice, deviceIds, statesOf } from './devices.js';
import { createClient, parseSnapshot, periodOf, problemOf, readRaw } from './invoiceninja.js';
import { PHRASES, STATUS, formatAmount, formatDay, render } from './texts.js';

const logger = createLogger({ name: 'invoiceninja' });

export const WIDGET_KEY = 'overview';
export const TRIGGERS = {
  PAYMENT: 'payment_received',
  OVERDUE: 'invoice_overdue',
  QUOTE: 'quote_accepted',
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// Ids kept per trigger: more than any page read, so an id read again is known.
const MAX_SEEN = 200;

export const DEFAULT_TIMINGS = {
  heartbeatMs: 12 * HOUR,
  // requestWidgetRefresh is rate-limited to one call every 10 s by the core.
  widgetRefreshMs: 10000,
};

export class Monitor {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {object} options.store see src/store.js
   * @param {Function} [options.fetch] fetch (the tests pass a fake Invoice Ninja)
   * @param {boolean} [options.timers] false: no background timer (tests drive the cycles)
   * @param {Function} [options.now] clock in ms
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   */
  constructor({ gladys, store, fetch, timers = true, now, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch ?? globalThis.fetch;
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    this.ready = false;
    this.data = emptyData();
    this.snapshot = null;
    this.problem = null;
    this.lastSuccessAt = null;
    this.lastCycleAt = -Infinity;
    this.discovered = null;
    this.statusMessage = undefined;
    this.transport = null;
    this.cycleTimer = null;
    this.running = null;
    this.lastRefreshAt = -Infinity;
    this.refreshTimer = null;
    this.signature = null;
    this.stopped = false;
    // Keys of the failures already logged, so a repeated one is not logged again.
    this.failing = new Set();
  }

  /** Log a failure once (warn or error), then at debug until `recovered(key)`. */
  failed(key, level, message) {
    if (this.failing.has(key)) {
      logger.debug(message);
      return;
    }
    this.failing.add(key);
    logger[level](message);
  }

  /** One line when a failure logged by `failed(key)` is over. */
  recovered(key, message) {
    if (this.failing.delete(key)) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.data = restore(await this.store.load());
    this.configure(config);
    logger.info(`Started: Invoice Ninja read every ${config.refreshMinutes} min`);
    this.schedule();
    this.runCycle();
  }

  configure(config) {
    this.config = config;
    this.ready = Boolean(config.url && config.token);
    if (!this.ready) {
      this.problem = config.invalidUrl ? 'invalidUrl' : config.url ? 'noToken' : 'noUrl';
      logger.warn(
        config.invalidUrl
          ? 'The address of Invoice Ninja is not understood'
          : 'Address or API token of Invoice Ninja missing',
      );
    }
  }

  /** Reconnection: Gladys may have restarted, publish everything again. */
  async resync(config) {
    if (connectionOf(config) !== connectionOf(this.config)) {
      // The configuration changed while Gladys was away.
      await this.reconfigure(config);
      return;
    }
    this.config = config;
    this.discovered = null;
    await this.publishDiscovered();
    this.statusMessage = undefined;
    this.transport = null;
    await this.updateConnectionStatus();
    this.gladys.forgetPublishedStates?.();
    await this.publishStates();
    this.requestRefresh();
  }

  async reconfigure(config) {
    await this.running;
    this.problem = null;
    this.failing.delete('invoiceninja');
    logger.info('Configuration saved');
    if (config.url !== this.config?.url || config.token !== this.config?.token) {
      // Another server or company: its data must not be shown under the old one.
      this.snapshot = null;
      this.signature = null;
      this.lastSuccessAt = null;
    }
    this.configure(config);
    // The language may have changed: device published again.
    this.discovered = null;
    this.schedule();
    await this.runCycle();
    this.requestRefresh();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.cycleTimer);
    clearTimeout(this.refreshTimer);
    this.cycleTimer = null;
    await this.running?.catch(() => {});
    await this.store.flush();
  }

  schedule() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => this.runCycle(), this.config.refreshMinutes * MINUTE);
    this.cycleTimer.unref?.();
  }

  // --- Device -------------------------------------------------------------------

  /** External ids of the company device of the last snapshot, or null. */
  ids() {
    return this.snapshot ? deviceIds(this.gladys, this.snapshot.company.id) : null;
  }

  /** The company device as added in Gladys, or undefined. */
  createdDevice() {
    const ids = this.ids();
    return ids && (this.gladys.devices ?? []).find((device) => device.external_id === ids.device);
  }

  /** Whether an external id is the device of this integration. */
  owns(externalId) {
    return Boolean(externalId) && this.ids()?.device === externalId;
  }

  /** The currency of the amounts: the one of the company in Invoice Ninja. */
  currency() {
    return this.snapshot?.company.currency ?? null;
  }

  // --- Cycles -----------------------------------------------------------------

  runCycle() {
    if (this.running || this.stopped) {
      return this.running;
    }
    this.running = this.cycle()
      // The name only: a message could hold an amount or a client name.
      .catch((err) => this.failed('cycle', 'error', `Refresh cycle failed: ${err.name ?? 'error'}`))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async cycle() {
    const now = this.now();
    this.lastCycleAt = now;
    if (!this.ready) {
      await this.updateConnectionStatus();
      return;
    }
    const period = periodOf(now);
    try {
      const client = createClient({
        url: this.config.url,
        token: this.config.token,
        fetch: this.fetch,
      });
      this.snapshot = parseSnapshot(await readRaw(client, period), period.today);
      this.problem = null;
      this.lastSuccessAt = this.now();
      this.recovered('invoiceninja', 'Invoice Ninja answers again');
    } catch (err) {
      this.problem = problemOf(err);
      // The problem and a short code only: no address, no token.
      this.failed(
        'invoiceninja',
        'warn',
        `Reading Invoice Ninja failed: ${this.problem} (${err.code ?? err.name ?? 'error'})`,
      );
      await this.updateConnectionStatus();
      this.refreshOnChange();
      return;
    }
    const { unpaidCount, overdueCount, latestPayments } = this.snapshot;
    logger.debug(
      `Refresh cycle: ${unpaidCount} unpaid, ${overdueCount} overdue, ${latestPayments.length} latest payments`,
    );
    this.recovered('cycle', 'Refresh cycles work again');
    await this.publishDiscovered();
    await this.publishStates();
    try {
      await this.checkTriggers();
    } finally {
      // What was fired is kept even if a later event failed.
      this.store.save(this.data);
    }
    await this.updateConnectionStatus();
    this.refreshOnChange();
  }

  /** Ask the widget to reload when what it shows changed (values, or a failure). */
  refreshOnChange() {
    const signature = JSON.stringify([this.snapshot, this.problem]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.requestRefresh();
    }
  }

  async publishDiscovered() {
    if (!this.config || !this.snapshot) {
      return;
    }
    const devices = [buildDevice(this.gladys, this.snapshot.company, this.config.language)];
    const signature = JSON.stringify(devices);
    if (signature === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = signature;
      this.recovered('discovery', 'Publishing the device works again');
    } catch (err) {
      this.failed('discovery', 'warn', `Publishing the device failed: ${errorOf(err)}`);
    }
  }

  async publishStates() {
    if (!this.snapshot || !this.createdDevice()) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(statesOf(this.ids(), this.snapshot), {
        heartbeat: this.timings.heartbeatMs,
      });
      this.recovered('publish', 'Publishing the states works again');
    } catch (err) {
      // Sent again at the next cycle (the SDK forgets what Gladys refused).
      this.failed('publish', 'warn', `Publishing the states failed: ${errorOf(err)}`);
    }
  }

  async updateConnectionStatus() {
    const connected = this.problem === null && this.lastSuccessAt !== null;
    const message = this.problem ? render(STATUS, this.problem) : undefined;
    const key = JSON.stringify([connected, message]);
    if (key !== this.statusMessage) {
      this.statusMessage = key;
      await this.gladys.setConnectionStatus(connected, message).catch(() => {});
    }
    await this.publishTransport();
  }

  /** The pill of the device: local or cloud (invoicing.co), unreachable on failure. */
  async publishTransport() {
    const device = this.createdDevice();
    if (!device) {
      return;
    }
    const transport =
      this.problem === null ? (isHosted(this.config.url) ? 'cloud' : 'local') : 'unreachable';
    const key = `${device.external_id}:${transport}`;
    if (key === this.transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([{ external_id: device.external_id, transport }]);
      this.transport = key;
    } catch (err) {
      logger.debug(`Publishing the transport failed: ${errorOf(err)}`);
    }
  }

  // --- Scene triggers -------------------------------------------------------------

  async checkTriggers() {
    const snapshot = this.snapshot;
    const data = this.data;
    if (data.company !== snapshot.company.id) {
      // First reading of this company: what exists is the starting point.
      this.data = {
        ...emptyData(),
        company: snapshot.company.id,
        payments: watermark(snapshot.latestPayments, 'createdAt'),
        quotes: {
          ...watermark(snapshot.acceptedQuotes, 'createdAt'),
          pending: snapshot.pendingQuoteIds,
        },
        overdue: snapshot.overdue.map((invoice) => invoice.id),
      };
      return;
    }
    const language = this.config.language;
    const phrases = PHRASES[language];
    const currency = this.currency();
    const amount = (value) => formatAmount(value, currency, language);

    // Oldest first, so the scenes see them in their order.
    for (const payment of fresh(data.payments, snapshot.latestPayments, 'createdAt')) {
      const sent = await this.fire(TRIGGERS.PAYMENT, `Payment #${payment.number}`, {
        number: payment.number,
        client: payment.client,
        amount: payment.amount,
        currency: currency ?? '',
        date: payment.date ?? '',
        text: phrases.payment({ client: payment.client, amount: amount(payment.amount) }),
      });
      if (!sent) {
        break; // tried again at the next cycle
      }
      remember(data.payments, payment);
    }

    const known = new Set(data.overdue);
    const fired = [];
    let failed = false;
    for (const invoice of snapshot.overdue) {
      if (known.has(invoice.id)) {
        fired.push(invoice.id);
        continue;
      }
      if (failed) {
        continue; // not marked: tried again at the next cycle
      }
      const sent = await this.fire(TRIGGERS.OVERDUE, `Invoice #${invoice.number}`, {
        number: invoice.number,
        client: invoice.client,
        balance: invoice.balance,
        currency: currency ?? '',
        due_date: invoice.dueDate ?? '',
        days_late: invoice.daysLate,
        text: phrases.overdue({
          number: invoice.number,
          client: invoice.client,
          amount: amount(invoice.balance),
          date: formatDay(invoice.dueDate, language),
        }),
      });
      if (sent) {
        fired.push(invoice.id);
      } else {
        failed = true;
      }
    }
    // An invoice paid, or due again, leaves the list: overdue again later is news.
    data.overdue = fired;

    // An accepted quote is news if it was pending at the last reading, or
    // created since the starting point (sent and accepted between two
    // readings); never one accepted long ago and only edited now.
    const wasPending = new Set(data.quotes.pending);
    const seenQuotes = new Set(data.quotes.seen);
    const accepted = snapshot.acceptedQuotes
      .filter(
        (quote) =>
          !seenQuotes.has(quote.id) &&
          (wasPending.has(quote.id) || quote.createdAt >= data.quotes.since),
      )
      .sort((a, b) => a.updatedAt - b.updatedAt);
    data.quotes.pending = snapshot.pendingQuoteIds;
    for (const quote of accepted) {
      const sent = await this.fire(TRIGGERS.QUOTE, `Quote #${quote.number}`, {
        number: quote.number,
        client: quote.client,
        amount: quote.amount,
        currency: currency ?? '',
        text: phrases.quote({
          number: quote.number,
          client: quote.client,
          amount: amount(quote.amount),
        }),
      });
      if (!sent) {
        break;
      }
      remember(data.quotes, quote);
    }
  }

  async fire(key, line, data) {
    // A number only: client names and amounts stay out of the logs.
    logger.info(`Scene trigger ${key}: ${line}`);
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.recovered('scene', 'Scene triggers work again');
      return true;
    } catch (err) {
      this.failed('scene', 'warn', `Firing the scene trigger failed: ${errorOf(err)}`);
      return false;
    }
  }

  // --- Gladys events --------------------------------------------------------------

  async onDeviceCreated(device) {
    if (!this.owns(device?.external_id)) {
      return;
    }
    // The SDK forgot the states of the device: everything is published again.
    this.transport = null;
    await this.publishStates();
    await this.publishTransport();
    this.requestRefresh();
  }

  async onDeviceDeleted(device) {
    if (this.owns(device?.external_id)) {
      this.transport = null;
      this.requestRefresh();
    }
  }

  /** onPoll fallback: should_poll is false, but a Gladys polling anyway gets an answer. */
  async poll(device) {
    if (!this.owns(device?.external_id)) {
      return;
    }
    if (this.now() - this.lastCycleAt >= (this.config.refreshMinutes * MINUTE) / 2) {
      await this.runCycle();
    } else {
      await this.publishStates();
    }
  }

  /** The snapshot, read again if the last cycle is older than one interval (or `force`). */
  async fresh(force = false) {
    if (this.running) {
      // A reading in progress is fresh enough, even for "Test the connection".
      await this.running;
      return this.snapshot;
    }
    if (force || this.now() - this.lastCycleAt >= this.config.refreshMinutes * MINUTE) {
      await this.runCycle();
    }
    return this.snapshot;
  }

  // --- Widget -------------------------------------------------------------------

  requestRefresh() {
    if (this.stopped) {
      return;
    }
    const now = this.now();
    const wait = this.lastRefreshAt + this.timings.widgetRefreshMs - now;
    if (wait <= 0) {
      this.lastRefreshAt = now;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } else if (this.timers && !this.refreshTimer) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      this.refreshTimer.unref?.();
    }
  }
}

/** The starting point of a trigger: the ids read, and the newest time among them. */
const watermark = (items, field) => ({
  since: Math.max(0, ...items.map((item) => item[field])),
  seen: items.map((item) => item.id),
});

/**
 * The items not seen yet and not older than the starting point (an old record
 * coming back into the page, after a deletion, is not news), oldest first.
 */
function fresh(record, items, field) {
  const seen = new Set(record.seen);
  return items
    .filter((item) => !seen.has(item.id) && item[field] >= record.since)
    .sort((a, b) => a[field] - b[field]);
}

/**
 * Mark an item as seen. The starting point does not move: a payment recorded
 * as pending and completed later, after a newer one, is still news.
 */
function remember(record, item) {
  record.seen = [item.id, ...record.seen.filter((id) => id !== item.id)].slice(0, MAX_SEEN);
}

/** A failure of the Gladys API, without its message (it could echo a name). */
const errorOf = (err) => (err?.status ? `HTTP ${err.status}` : (err?.code ?? err?.name ?? 'error'));

/** What identifies the server, the token and the reading pace of a configuration. */
const connectionOf = (config) =>
  config && JSON.stringify([config.url, config.token, config.refreshMinutes, config.language]);

/** The trigger state read from /data, or a new one when it is missing or damaged. */
function restore(saved) {
  const ids = (value) => Array.isArray(value) && value.every((id) => typeof id === 'string');
  const record = (value) =>
    value && Number.isFinite(value.since) && ids(value.seen)
      ? { since: value.since, seen: value.seen }
      : null;
  if (saved?.version !== 1 || typeof saved.company !== 'string') {
    return emptyData();
  }
  const payments = record(saved.payments);
  const quotes = record(saved.quotes);
  if (!payments || !quotes || !ids(saved.overdue) || !ids(saved.quotes.pending ?? [])) {
    return emptyData();
  }
  quotes.pending = saved.quotes.pending ?? [];
  return { version: 1, company: saved.company, payments, quotes, overdue: saved.overdue };
}

function emptyData() {
  return {
    version: 1,
    company: null,
    payments: { since: 0, seen: [] },
    quotes: { since: 0, seen: [], pending: [] },
    overdue: [],
  };
}
