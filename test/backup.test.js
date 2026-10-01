import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup, exportTree, BACKUP_FORMAT } from '../src/lib/backup.js';
import { setup } from './helpers.js';

test('a Firefox backup is read by folder role, leaving out saved searches', () => {
  const { folders, bookmarks, skipped } = parseBackup(JSON.stringify({
    guid: 'root________', children: [
      { guid: 'menu________', root: 'bookmarksMenuFolder', children: [
        { typeCode: 1, title: 'New', uri: 'https://new.test' },
        { typeCode: 1, title: 'Most visited', uri: 'place:sort=8' },
        { typeCode: 2, title: 'Dir', children: [{ typeCode: 3 }] },
      ] },
    ],
  }));
  assert.deepEqual(Object.keys(folders), ['menu________']);
  assert.deepEqual(folders.menu________.map((s) => [s.type, s.title]), [['bookmark', 'New'], ['folder', 'Dir']]);
  assert.equal(bookmarks, 1);
  assert.equal(skipped, 1);
});

test('our own backup format restores too, and other files are refused', async () => {
  const { bookmarks } = setup();
  const file = await exportTree(bookmarks);
  assert.equal(file.format, BACKUP_FORMAT);
  const parsed = parseBackup(JSON.stringify(file));
  assert.deepEqual(Object.keys(parsed.folders), ['menu________', 'unfiled_____']);
  assert.equal(parsed.bookmarks, 6);
  assert.throws(() => parseBackup('nope'), /not a JSON/);
  assert.throws(() => parseBackup('{"a":1}'), /not a bookmarks backup/);
});
