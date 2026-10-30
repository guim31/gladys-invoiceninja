// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Select values are strings in the manifest (stored by Gladys as typed); the
// normalized config holds numbers.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Minutes between two readings. Invoices do not move by the second, and the
// hosted service (invoicing.co) throttles its API: a few requests per reading
// every 15 minutes is far below any limit.
export const REFRESH_INTERVALS = ['5', '10', '15', '30', '60'];

export const DEFAULT_CONFIG = {
  url: '',
  api_token: '',
  refresh_interval: '15',
  language: 'fr',
};

/** The hosted service: the transport pill says "cloud" for it, "local" otherwise. */
export const HOSTED_HOSTS = ['invoicing.co', 'app.invoicing.co'];

/**
 * The address of Invoice Ninja, from what the user typed: scheme added when
 * missing, trailing slashes and a pasted `/api/v1` removed, credentials refused
 * (they would end up in logs). `null` when it cannot be a URL.
 */
export function parseUrl(text) {
  let value = String(text ?? '').trim();
  if (value === '') {
    return null;
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** Whether an address is the hosted service. */
export const isHosted = (url) => {
  try {
    return HOSTED_HOSTS.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
};

const pick = (value, allowed, fallback) =>
  allowed.includes(String(value)) ? Number(value) : Number(fallback);

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typedUrl = String(source.url ?? '').trim();
  return {
    url: parseUrl(typedUrl),
    // A URL typed but not understood, told apart from no URL at all.
    invalidUrl: typedUrl !== '' && parseUrl(typedUrl) === null,
    token: String(source.api_token ?? '').trim(),
    refreshMinutes: pick(
      source.refresh_interval,
      REFRESH_INTERVALS,
      DEFAULT_CONFIG.refresh_interval,
    ),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
