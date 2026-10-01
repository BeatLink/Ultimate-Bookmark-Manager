// Reads and writes the HTML bookmarks file that Firefox and other browsers import and export.

import { nodeType } from './tree.js';

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unescape = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
  if (code[0] !== '#') return NAMED[code.toLowerCase()] ?? whole;
  const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
});

// The given folders and everything in them as a bookmarks HTML file.
export function toBookmarkHtml(folders) {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];
  const date = (ms) => (ms ? ` ADD_DATE="${Math.floor(ms / 1000)}"` : '');
  const walk = (node, depth) => {
    const pad = '    '.repeat(depth);
    const type = nodeType(node);
    if (type === 'separator') lines.push(`${pad}<HR>`);
    else if (type === 'bookmark') lines.push(`${pad}<DT><A HREF="${escape(node.url)}"${date(node.dateAdded)}>${escape(node.title ?? '')}</A>`);
    else {
      const toolbar = node.id === 'toolbar_____' ? ' PERSONAL_TOOLBAR_FOLDER="true"' : '';
      lines.push(`${pad}<DT><H3${date(node.dateAdded)}${toolbar}>${escape(node.title ?? '')}</H3>`, `${pad}<DL><p>`);
      for (const child of node.children ?? []) walk(child, depth + 1);
      lines.push(`${pad}</DL><p>`);
    }
  };
  for (const folder of folders) walk(folder, 1);
  lines.push('</DL>', '');
  return lines.join('\n');
}

// The folders, bookmarks and separators in a bookmarks HTML file, as snapshots ready to create.
export function parseBookmarkHtml(html) {
  const top = { children: [] };
  const stack = [top];
  // A folder heading opens the next list; anything before that list belongs to the folder's parent.
  let pending = null;
  const tags = /<(\/?)(dl|h3|a|hr)\b([^>]*)>/gi;
  // Only ASCII is lowered, so offsets into it stay offsets into the original.
  const lower = html.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const attr = (attrs, name) => {
    const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
    return m ? unescape(m[1] ?? m[2] ?? m[3]) : undefined;
  };
  const textUntil = (close, from) => {
    const end = lower.indexOf(close, from);
    const stop = end < 0 ? html.length : end;
    tags.lastIndex = stop;
    return unescape(html.slice(from, stop).replace(/<[^>]*>/g, '')).trim();
  };
  let m;
  while ((m = tags.exec(html))) {
    const [, closing, tag, attrs] = m;
    const name = tag.toLowerCase();
    const here = stack.at(-1);
    if (name === 'dl' && !closing) {
      // The outermost list is the file itself; later lists without a heading are kept as untitled folders.
      if (pending) stack.push(pending);
      else if (stack.length > 1 || top.opened) {
        const folder = { type: 'folder', title: '', children: [] };
        here.children.push(folder);
        stack.push(folder);
      } else top.opened = true;
      pending = null;
    } else if (name === 'dl' && closing) {
      if (stack.length > 1) stack.pop();
      pending = null;
    } else if (name === 'h3' && !closing) {
      pending = { type: 'folder', title: textUntil('</h3>', tags.lastIndex), children: [] };
      here.children.push(pending);
    } else if (name === 'a' && !closing) {
      const url = attr(attrs, 'href');
      const title = textUntil('</a>', tags.lastIndex);
      if (url) here.children.push({ type: 'bookmark', title, url });
    } else if (name === 'hr' && !closing) {
      here.children.push({ type: 'separator', title: '' });
    }
  }
  return top.children;
}

// Counts the bookmarks among parsed snapshots, for a summary after importing.
export function countBookmarks(snaps) {
  return snaps.reduce((n, s) => n + (s.type === 'bookmark' ? 1 : countBookmarks(s.children ?? [])), 0);
}
