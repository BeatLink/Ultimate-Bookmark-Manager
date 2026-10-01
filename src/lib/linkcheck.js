// Checks bookmark URLs over the network and sorts the outcome into broken, redirected or fine.

import { readTitle } from './html-title.js';
import { unhelpfulName } from './folders.js';

export const CATEGORIES = {
  notFound: { label: 'Not found (404 / 410)', severity: 'broken' },
  serverError: { label: 'Server error (5xx)', severity: 'broken' },
  clientError: { label: 'Other client error (4xx)', severity: 'broken' },
  unreachable: { label: 'Unreachable (DNS, connection or TLS error)', severity: 'broken' },
  timeout: { label: 'Timed out', severity: 'broken' },
  denied: { label: 'Access denied (401 / 403) — may still work when logged in', severity: 'uncertain' },
  rateLimited: { label: 'Rate limited (429) — try again later', severity: 'uncertain' },
  login: { label: 'Redirects to a login page — may still work when logged in', severity: 'uncertain' },
};

// Sign-in services that sites hand visitors to; subdomains are included.
export const DEFAULT_LOGIN_HOSTS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'idmsa.apple.com',
  'login.yahoo.com',
  'auth0.com',
  'okta.com',
];

// URLs containing any of these are checked without cookies, because opening them while logged in can change your account.
export const DEFAULT_NO_COOKIE_WORDS = [
  'logout', 'log-out', 'logoff', 'signout', 'sign-out', 'unsubscribe', 'delete', 'remove', 'cancel', 'revoke',
  'confirm', 'verify', 'activate', 'approve', 'accept', 'reset', 'token', 'magic',
];

// Path parts that name a login page, such as /login or /users/sign_in.
const LOGIN_SEGMENT = /^(log-?in|log_in|sign-?in|sign_in|signon|auth|authorize|authenticate|sso|oauth2?|saml2?|cas|idp)(\.\w+)?$/i;

// Query parameters a login page uses to send you back afterwards.
const RETURN_PARAMS = new Set(['next', 'return', 'returnto', 'return_to', 'returnurl', 'return_url', 'returnpath', 'redirect', 'redirect_uri', 'redirect_url', 'redirectto', 'redirect_to', 'continue', 'dest', 'destination', 'service', 'goto', 'from', 'back']);

export function isCheckable(url) {
  return /^https?:\/\//i.test(url ?? '');
}

function hostMatches(host, domains) {
  return domains.some((entry) => {
    const d = entry.trim().toLowerCase().replace(/^\*\./, '');
    return d && (host === d || host.endsWith('.' + d));
  });
}

// True when the URL's host equals a skip-list entry or is a subdomain of one.
export function isSkipped(url, skipList) {
  try {
    return hostMatches(new URL(url).hostname.toLowerCase(), skipList);
  } catch {
    return false;
  }
}

// Host names that only exist on your own network, such as a router's admin page or a NAS.
const LOCAL_SUFFIXES = ['localhost', 'local', 'lan', 'home', 'internal', 'intranet', 'home.arpa'];

// The four numbers of an IPv4 address, or null when the host is not one.
function ipv4(host) {
  const parts = host.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p)) ? parts.map(Number) : null;
}

// True when the URL points at your own computer or network: loopback, private and link-local addresses, and local names.
export function isPrivateAddress(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  const ip = ipv4(host);
  if (ip) {
    const [a, b] = ip;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(':')) return host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:');
  return !host.includes('.') || LOCAL_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

// True when the URL's path or query contains one of the words, ignoring case.
export function hasRiskyWord(url, words) {
  let rest;
  try {
    const u = new URL(url);
    rest = (u.pathname + u.search).toLowerCase();
  } catch {
    return false;
  }
  return words.some((w) => w.trim() && rest.includes(w.trim().toLowerCase()));
}

// The fetch credentials mode for a URL: your cookies when asked for, unless the URL looks like it changes your account.
export function credentialsFor(url, { cookies = false, noCookieWords = DEFAULT_NO_COOKIE_WORDS } = {}) {
  return cookies && !hasRiskyWord(url, noCookieWords) ? 'include' : 'omit';
}

// True when a redirect from `from` ended on what looks like a login page.
export function isLoginRedirect(from, to, loginHosts = DEFAULT_LOGIN_HOSTS) {
  let a, b;
  try {
    a = new URL(from);
    b = new URL(to);
  } catch {
    return false;
  }
  if (hostMatches(b.hostname.toLowerCase(), loginHosts)) return true;
  if (b.pathname.split('/').some((part) => LOGIN_SEGMENT.test(part))) return true;
  // A login page names the page you came from so it can send you back, either in full or, on the same site, by its path.
  const host = a.hostname.toLowerCase();
  const path = a.origin === b.origin && a.pathname !== '/' ? a.pathname.toLowerCase() : null;
  for (const [key, value] of b.searchParams) {
    if (!RETURN_PARAMS.has(key.toLowerCase())) continue;
    const v = value.toLowerCase();
    if (v.includes(host) || (path && v.startsWith(path))) return true;
  }
  return false;
}

export function categorize(httpStatus) {
  if (httpStatus === 404 || httpStatus === 410) return 'notFound';
  if (httpStatus === 401 || httpStatus === 403) return 'denied';
  if (httpStatus === 429) return 'rateLimited';
  if (httpStatus >= 500) return 'serverError';
  if (httpStatus >= 400) return 'clientError';
  return null;
}

function sameUrl(a, b) {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

// One GET for the page; with `wantTitle`, the title is read from the first bytes of its HTML before the rest is dropped.
async function request(fetchImpl, url, timeout, outer, credentials, wantTitle) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeout);
  const cancel = () => ctrl.abort();
  outer?.addEventListener('abort', cancel);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      credentials,
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!wantTitle || res.status >= 400) {
      res.body?.cancel?.().catch(() => {});
      return { res };
    }
    // A page that stalls part-way through still has its status; it only goes without a title.
    const title = await readTitle(res).catch(() => '');
    return { res, title };
  } catch (error) {
    if (outer?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return { error: timedOut ? 'timeout' : error };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', cancel);
  }
}

// Checks one URL with a single GET, as many servers answer HEAD wrongly.
// With `cookies` on, the request carries your cookies so pages you are logged into load as they do for you.
// With `wantTitle` on, a usable page title comes back as `pageTitle`, except from a login page.
export async function checkUrl(url, {
  timeout = 15000,
  signal,
  fetchImpl = globalThis.fetch.bind(globalThis),
  cookies = false,
  noCookieWords = DEFAULT_NO_COOKIE_WORDS,
  detectLogin = false,
  loginHosts = DEFAULT_LOGIN_HOSTS,
  wantTitle = false,
} = {}) {
  const credentials = credentialsFor(url, { cookies, noCookieWords });
  const attempt = await request(fetchImpl, url, timeout, signal, credentials, wantTitle);
  if (attempt.error === 'timeout') return { url, status: 'broken', category: 'timeout' };
  if (attempt.error) {
    return { url, status: 'broken', category: 'unreachable', detail: String(attempt.error.message ?? attempt.error) };
  }
  const { res } = attempt;
  const category = categorize(res.status);
  if (category) {
    return { url, status: CATEGORIES[category].severity, category, httpStatus: res.status, detail: res.statusText };
  }
  const t = attempt.title;
  const pageTitle = t && !unhelpfulName(t, url) && !unhelpfulName(t, res.url || url) ? { pageTitle: t } : {};
  if (res.redirected && res.url && !sameUrl(res.url, url)) {
    if (detectLogin && isLoginRedirect(url, res.url, loginHosts)) {
      return { url, status: 'uncertain', category: 'login', httpStatus: res.status, detail: `→ ${res.url}`, finalUrl: res.url };
    }
    return { url, status: 'redirect', httpStatus: res.status, finalUrl: res.url, ...pageTitle };
  }
  return { url, status: 'ok', httpStatus: res.status, ...pageTitle };
}

// Checks many bookmarks with limited parallelism, reporting progress after each one; `titleFor(bookmark)` says whose page title to read too.
export async function checkAll(bookmarks, { concurrency = 6, signal, onProgress, titleFor, ...options } = {}) {
  const results = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < bookmarks.length) {
      if (signal?.aborted) return;
      const b = bookmarks[next++];
      let result;
      try {
        result = await checkUrl(b.url, { ...options, signal, wantTitle: !!titleFor?.(b) });
      } catch (err) {
        if (err.name === 'AbortError') return;
        result = { url: b.url, status: 'broken', category: 'unreachable', detail: String(err) };
      }
      results.push({ ...result, id: b.id, title: b.title, path: b.path });
      onProgress?.(++done, bookmarks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}
