// -----------------------------------------------------------------------------
// The one Gladys device: the company of the API token, with its unpaid and
// overdue invoices (count and amount), the money received this month and the
// pending quotes.
//
// The platform id is the id Invoice Ninja gives the company: renaming it keeps
// the device. Every feature is read-only, with should_poll: false: the readings
// run in the container (src/monitor.js).
//
// Couples checked against the Gladys front in test/gladys-rules.test.js.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { NAMES } from './texts.js';

export const DEVICE_TYPE = 'company';

export const FEATURE_KEYS = [
  'unpaid_count',
  'unpaid_amount',
  'overdue_count',
  'overdue_amount',
  'paid_month',
  'quotes_pending',
];

// Display bounds only (the core never applies them).
const MAX_AMOUNT = 1e12;
const MAX_COUNT = 1e6;

const CURRENCY_UNITS = { EUR: UNITS.EURO, USD: UNITS.DOLLAR, GBP: UNITS.POUND_STERLING };

/** The unit of an amount in this currency, or undefined. */
export const unitOf = (currency) => CURRENCY_UNITS[currency];

/** The platform id of the company: its Invoice Ninja id, kept to safe characters. */
export const platformIdOf = (id) => String(id).replace(/[^A-Za-z0-9-]/g, '_');

/** External ids of the device of a company and of its features. */
export function deviceIds(gladys, companyId) {
  const ids = gladys.externalIds(DEVICE_TYPE, platformIdOf(companyId));
  return {
    device: ids.device,
    ...Object.fromEntries(FEATURE_KEYS.map((key) => [key, ids.feature(key)])),
  };
}

const feature = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/**
 * The discovery payload of the company.
 * @param {object} gladys
 * @param {object} company `{ id, name, currency }` of the snapshot (src/invoiceninja.js)
 * @param {string} language of the names
 */
export function buildDevice(gladys, company, language = 'fr') {
  const ids = deviceIds(gladys, company.id);
  const names = NAMES[language] ?? NAMES.fr;
  const unit = unitOf(company.currency);
  const money = (key) =>
    feature(names[key], ids[key], CATEGORIES.CURRENCY, TYPES.CURRENCY.DECIMAL, {
      min: 0,
      max: MAX_AMOUNT,
      ...(unit ? { unit } : {}),
    });
  const count = (key) =>
    feature(names[key], ids[key], CATEGORIES.COUNTER_SENSOR, TYPES.SENSOR.INTEGER, {
      min: 0,
      max: MAX_COUNT,
    });
  const name = company.name || 'Invoice Ninja';
  return {
    // The currency in the name when no unit says it.
    name: company.currency && !unit ? `${name} (${company.currency})` : name,
    external_id: ids.device,
    model: 'Invoice Ninja',
    should_poll: false,
    params: [],
    features: [
      count('unpaid_count'),
      money('unpaid_amount'),
      count('overdue_count'),
      money('overdue_amount'),
      money('paid_month'),
      count('quotes_pending'),
    ],
  };
}

/** The states of the company, by feature external id. */
export function statesOf(ids, snapshot) {
  const values = {
    unpaid_count: snapshot.unpaidCount,
    unpaid_amount: snapshot.unpaidAmount,
    overdue_count: snapshot.overdueCount,
    overdue_amount: snapshot.overdueAmount,
    paid_month: snapshot.paidMonth,
    quotes_pending: snapshot.pendingQuotes,
  };
  return FEATURE_KEYS.map((key) => ({ device_feature_external_id: ids[key], state: values[key] }));
}
