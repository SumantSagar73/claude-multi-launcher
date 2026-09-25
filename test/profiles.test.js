'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProfileStore, cleanEmail } = require('../src/profiles');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cml-'));

test('cleanEmail accepts blank and real addresses, rejects junk', () => {
  assert.equal(cleanEmail(''), '');
  assert.equal(cleanEmail(undefined), '');
  assert.equal(cleanEmail('  me@example.com '), 'me@example.com');
  assert.throws(() => cleanEmail('not an email'));
  assert.throws(() => cleanEmail('a@b'));
});

test('accounts keep their email; Default stores it in settings', () => {
  const dir = tmp();
  const store = new ProfileStore(dir, path.join(dir, 'claude'));
  const p = store.add({ name: 'Work', color: '#e8a23a', email: 'work@example.com' });
  store.update('default', { name: 'Home', color: '#81b29a', email: 'home@example.com' });

  const again = new ProfileStore(dir, path.join(dir, 'claude'));
  assert.equal(again.get(p.id).email, 'work@example.com');
  assert.equal(again.get('default').email, 'home@example.com');
  assert.equal(again.get('default').name, 'Home');
});

test('a double-click on Save cannot create two accounts with the same name', () => {
  const dir = tmp();
  const store = new ProfileStore(dir, path.join(dir, 'claude'));
  store.add({ name: 'Personal', color: '#e8a23a' });
  assert.throws(() => store.add({ name: ' personal ', color: '#e8a23a' }), /already exists/);
  assert.throws(() => store.add({ name: 'Default', color: '#e8a23a' }), /already exists/);
  assert.equal(store.all().filter((p) => p.name.toLowerCase() === 'personal').length, 1);

  // renaming an account to its own name is fine
  const p = store.list[0];
  store.update(p.id, { name: 'Personal', color: '#81b29a', email: '' });
});

test('importAccounts skips names that already exist, case-insensitively', () => {
  const dir = tmp();
  const store = new ProfileStore(dir, path.join(dir, 'claude'));
  store.add({ name: 'Work', color: '#e8a23a' });

  const result = store.importAccounts([
    { name: 'Work', color: '#81b29a', email: 'dup@example.com' }, // collides with existing
    { name: 'default', color: '#81b29a' }, // collides with the reserved Default name
    { name: 'Personal', color: '#6fa8dc', email: 'me@example.com' },
    { name: '' }, // invalid, ignored
  ]);

  assert.deepEqual(result.added, ['Personal']);
  assert.deepEqual(result.skipped.sort(), ['Work', 'default'].sort());
  const again = new ProfileStore(dir, path.join(dir, 'claude'));
  assert.equal(again.all().filter((p) => p.name === 'Work').length, 1);
  assert.equal(again.get(again.list.find((p) => p.name === 'Personal').id).email, 'me@example.com');
});

test('remove only deletes data inside the launcher profiles folder', () => {
  const dir = tmp();
  const store = new ProfileStore(dir, path.join(dir, 'claude'));
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'x');
  store.list.push({ id: 'evil', name: 'Evil', color: '#000000', dataDir: outside });
  store.remove('evil', { deleteData: true });
  assert.ok(fs.existsSync(path.join(outside, 'keep.txt')), 'a folder outside profiles/ must never be deleted');

  const p = store.add({ name: 'Mine', color: '#e8a23a' });
  fs.mkdirSync(p.dataDir, { recursive: true });
  store.remove(p.id, { deleteData: true });
  assert.ok(!fs.existsSync(p.dataDir));
});
