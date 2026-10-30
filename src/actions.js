// -----------------------------------------------------------------------------
// The scene action `read_summary` and the configuration action `check_now`.
// They read Invoice Ninja again when the last cycle is older than one
// interval, and answer with a sentence a scene can send by message or read
// aloud.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { PHRASES, STATUS, formatAmount, render } from './texts.js';

const logger = createLogger({ name: 'invoiceninja-actions' });

export const SCENE_ACTIONS = { SUMMARY: 'read_summary' };
export const CONFIG_ACTION = 'check_now';

/** The snapshot, or the reason there is none, thrown in the language of the configuration. */
async function snapshotOf(monitor) {
  const snapshot = await monitor.fresh();
  if (!snapshot || monitor.problem) {
    const problem = monitor.problem ?? 'unreachable';
    // The last values are better than nothing when the server is away, not when it refuses the token.
    if (!snapshot || !['unreachable', 'serverError', 'rateLimited'].includes(problem)) {
      throw new Error(STATUS[monitor.config.language][problem]);
    }
  }
  return snapshot;
}

/**
 * Scene action: unpaid and overdue invoices, money received this month and
 * pending quotes. Outputs `text` and the numbers.
 */
export async function readSummary(monitor) {
  const snapshot = await snapshotOf(monitor);
  const language = monitor.config.language;
  const currency = monitor.currency();
  const amount = (value) => formatAmount(value, currency, language);
  return {
    text: PHRASES[language].summary({
      unpaid: snapshot.unpaidCount,
      unpaidAmount: amount(snapshot.unpaidAmount),
      overdue: snapshot.overdueCount,
      overdueAmount: amount(snapshot.overdueAmount),
      paid: amount(snapshot.paidMonth),
      quotes: snapshot.pendingQuotes,
    }),
    unpaid_count: snapshot.unpaidCount,
    unpaid_amount: snapshot.unpaidAmount,
    overdue_count: snapshot.overdueCount,
    overdue_amount: snapshot.overdueAmount,
    paid_month: snapshot.paidMonth,
    quotes_pending: snapshot.pendingQuotes,
  };
}

/** Configuration action: a reading now, and what it found, in every language. */
export async function checkNow(monitor) {
  const snapshot = await monitor.fresh(true);
  if (monitor.problem || !snapshot) {
    const problem = monitor.problem ?? 'unreachable';
    logger.info(`Connection test: failed (${problem})`);
    return render(STATUS, problem);
  }
  logger.info('Connection test: Invoice Ninja answers');
  return render(STATUS, 'summary', {
    unpaid: snapshot.unpaidCount,
    overdue: snapshot.overdueCount,
    quotes: snapshot.pendingQuotes,
  });
}
