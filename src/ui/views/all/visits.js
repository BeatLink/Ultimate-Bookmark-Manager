// Each bookmarked URL's last visit and visit count from Firefox's history, read once permission is granted.

// Visit counts are read from history again when older than this.
const VISITS_MAX_AGE_MS = 60000;

export const visits = { map: null, at: 0, loading: null };

export const visitOf = (node) => (node.url && visits.map?.get(node.url)) || null;

export function loadVisits() {
  visits.loading ??= browser.history.search({ text: '', startTime: 0, maxResults: 1000000 })
    .then((items) => { visits.map = new Map(items.map((i) => [i.url, { last: i.lastVisitTime ?? 0, count: i.visitCount ?? 0 }])); })
    .catch(() => { visits.map = new Map(); })
    .finally(() => { visits.at = Date.now(); visits.loading = null; });
  return visits.loading;
}

// True when the counts are missing or old and nothing is reading them yet.
export const visitsStale = () => !visits.loading && (!visits.map || Date.now() - visits.at > VISITS_MAX_AGE_MS);
