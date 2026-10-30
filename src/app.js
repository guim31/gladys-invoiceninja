// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the monitor, so index.js stays a few lines and the tests drive
// the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CONFIG_ACTION, SCENE_ACTIONS, checkNow, readSummary } from './actions.js';
import { normalizeConfig } from './config.js';
import { Monitor } from './monitor.js';
import { Store } from './store.js';
import { STATUS, render } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'invoiceninja-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, fetch, timers, now, timings
 */
export function registerHandlers(gladys, options = {}) {
  const monitor = new Monitor({
    gladys,
    store: options.store ?? new Store(),
    fetch: options.fetch,
    timers: options.timers ?? true,
    now: options.now,
    timings: options.timings,
  });

  // Resolved once the monitor has started; every handler waits for it, so a
  // request arriving during the start is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      if (!monitor.config) {
        // The start failed (configuration unreadable): retried at the next connection.
        throw new Error(render(STATUS, 'initFailed').en);
      }
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): publish everything again.
        await monitor.resync(config);
        return;
      }
      await monitor.start(config);
      // Only now: a failed start is tried again at the next connection.
      started = true;
    } catch (err) {
      logger.error(`Initialization failed: ${err.message}`);
      await gladys.setConnectionStatus(false, render(STATUS, 'initFailed')).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  // A scan asked from the Discover tab: read now, and publish the device again.
  gladys.onScanRequest(
    whenReady(async () => {
      await monitor.runCycle();
      monitor.discovered = null;
      await monitor.publishDiscovered();
    }),
  );

  // The device is published with should_poll: false (refreshed by the
  // monitor's own timer); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady((device) => monitor.poll(device)));

  gladys.onDeviceCreated(whenReady((device) => monitor.onDeviceCreated(device)));
  // "Update" in the Discover tab: the SDK forgot the states of the device too;
  // a rename changes the name the widget shows.
  gladys.onDeviceUpdated(whenReady((device) => monitor.onDeviceCreated(device)));
  gladys.onDeviceDeleted(whenReady((device) => monitor.onDeviceDeleted(device)));

  gladys.onConfigUpdated(whenReady((newConfig) => monitor.reconfigure(normalizeConfig(newConfig))));

  gladys.onAction(
    CONFIG_ACTION,
    whenReady(() => checkNow(monitor)),
  );
  gladys.onSceneAction(
    SCENE_ACTIONS.SUMMARY,
    whenReady(() => readSummary(monitor)),
  );

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(monitor, request)),
    );
  }

  return {
    monitor,
    ready,
    stop: () => monitor.stop(),
  };
}
