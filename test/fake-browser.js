// In-memory stand-ins for browser.bookmarks and browser.storage.local.

export function fakeStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(obj) {
      Object.assign(data, structuredClone(obj));
    },
  };
}

export function fakeBookmarks(spec) {
  let counter = 0;
  const nodes = new Map();
  const add = (node, parentId) => {
    const id = node.id ?? `n${++counter}`;
    const type = node.type ?? (node.url ? 'bookmark' : node.children ? 'folder' : 'separator');
    const rec = { id, parentId, title: node.title ?? '', url: node.url, type, dateAdded: node.dateAdded ?? counter, childIds: [] };
    nodes.set(id, rec);
    for (const c of node.children ?? []) rec.childIds.push(add(c, id));
    return id;
  };
  add({ id: 'root________', children: spec }, undefined);

  const view = (id, deep) => {
    const n = nodes.get(id);
    const parent = nodes.get(n.parentId);
    const out = { id, parentId: n.parentId, index: parent ? parent.childIds.indexOf(id) : 0, title: n.title, type: n.type, dateAdded: n.dateAdded };
    if (n.url) out.url = n.url;
    if (n.type === 'folder') out.children = deep ? n.childIds.map((c) => view(c, true)) : undefined;
    return out;
  };
  const need = (id) => {
    if (!nodes.has(id)) throw new Error(`No node ${id}`);
    return nodes.get(id);
  };
  const detach = (id) => {
    const p = nodes.get(nodes.get(id).parentId);
    p.childIds.splice(p.childIds.indexOf(id), 1);
  };
  const drop = (id) => {
    for (const c of nodes.get(id).childIds) drop(c);
    nodes.delete(id);
  };

  return {
    async getTree() { return [view('root________', true)]; },
    async getSubTree(id) { need(id); return [view(id, true)]; },
    async get(id) { need(id); return [view(id, false)]; },
    async getChildren(id) { return need(id).childIds.map((c) => view(c, false)); },
    async create({ parentId, index, title, url, type }) {
      const id = `n${++counter}`;
      nodes.set(id, { id, parentId, title: title ?? '', url, type: type ?? (url ? 'bookmark' : 'folder'), dateAdded: counter, childIds: [] });
      const kids = need(parentId).childIds;
      kids.splice(index ?? kids.length, 0, id);
      return view(id, false);
    },
    async update(id, changes) { Object.assign(need(id), changes); return view(id, false); },
    async move(id, { parentId, index }) {
      need(id);
      detach(id);
      const kids = need(parentId).childIds;
      kids.splice(index ?? kids.length, 0, id);
      nodes.get(id).parentId = parentId;
      return view(id, false);
    },
    async remove(id) {
      if (need(id).childIds.length) throw new Error('Folder not empty');
      detach(id);
      drop(id);
    },
    async removeTree(id) { need(id); detach(id); drop(id); },
  };
}
