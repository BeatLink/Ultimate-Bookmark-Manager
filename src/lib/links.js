// Links as other programs hand them over: dropped from a page, pasted as text or read from open tabs.

const BLANK_PAGES = new Set(['about:blank', 'about:newtab', 'about:home']);

export function isValidUrl(text) {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

// Links dropped from a page, a tab or the address bar as { url, title }; Firefox's own format puts each title on the line after its URL.
export function parseDroppedLinks(mozUrl, uriList) {
  const pairs = [];
  if (mozUrl) {
    const lines = mozUrl.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 2) if (lines[i]) pairs.push({ url: lines[i], title: lines[i + 1] || lines[i] });
  } else {
    for (const line of (uriList ?? '').split(/\r?\n/)) if (line && !line.startsWith('#')) pairs.push({ url: line, title: line });
  }
  return pairs.filter((p) => isValidUrl(p.url));
}

// The web addresses in pasted text, one per word.
export function urlsInText(text) {
  return text.split(/\s+/).filter((t) => /^(https?|ftp|file):\/\/\S+$/i.test(t) && isValidUrl(t));
}

// The tabs worth bookmarking: not this add-on's own pages, blank pages, or an address already in the list.
export function bookmarkableTabs(tabs, ownPrefix) {
  const seen = new Set();
  return tabs.filter((t) => {
    if (!t.url || t.url.startsWith(ownPrefix) || BLANK_PAGES.has(t.url) || seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });
}
