const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const { createStorage } = require('../storage');
const { defaults } = require('../project');
const { example } = require('../public/guide');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botforge-storage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function project() {
  return { ...defaults(), ...example(randomUUID), id: randomUUID(), revision: 3, updatedAt: Date.now() };
}

test('legacy JSON import preserves complete projects and never resurrects deleted projects', t => {
  const dir = directory(t), p = project();
  const legacy = path.join(dir, p.id + '.json');
  const json = JSON.stringify(p);
  fs.writeFileSync(legacy, json);
  let store = createStorage(dir);
  assert.deepEqual(store.get(p.id), p);
  assert.equal(fs.readFileSync(legacy, 'utf8'), json);
  const db = new Database(path.join(dir, 'botforge.sqlite'));
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  db.close();
  store.update(p.id, { ...p, name: 'Обновлённый проект' });
  store.close();
  store = createStorage(dir);
  assert.equal(store.get(p.id).name, 'Обновлённый проект');
  store.delete(p.id); store.close();
  store = createStorage(dir);
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.get(p.id), e => e.status === 404);
  store.close();
});

test('invalid legacy data rolls back all imports and can be repaired without losing originals', t => {
  const dir = directory(t), p = project();
  fs.writeFileSync(path.join(dir, p.id + '.json'), JSON.stringify(p));
  const invalid = path.join(dir, randomUUID() + '.json');
  fs.writeFileSync(invalid, '{"name":"broken"}');
  assert.throws(() => createStorage(dir), /перенести проект/);
  const db = new Database(path.join(dir, 'botforge.sqlite'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM metadata').get().n, 0);
  db.close();
  fs.unlinkSync(invalid);
  const store = createStorage(dir);
  assert.deepEqual(store.get(p.id), p);
  store.close();
});

test('separate SQLite connections reject stale writes and preserve independent projects', t => {
  const dir = directory(t), p = project();
  const first = createStorage(dir), second = createStorage(dir);
  try {
    first.create(p);
    const stale = second.get(p.id);
    const saved = first.update(p.id, { ...p, name: 'Первая запись' });
    assert.equal(saved.revision, p.revision + 1);
    assert.throws(() => second.update(p.id, { ...stale, name: 'Устаревшая запись' }), e => e.status === 409);
    assert.deepEqual(second.get(p.id), saved);
    const other = { ...project(), name: "' ; DROP TABLE projects; --" };
    second.create(other);
    assert.equal(first.list().length, 2);
    assert.deepEqual(first.get(other.id), other);
    assert.throws(() => first.update(p.id, { ...saved, revision: '4' }), e => e.status === 400);
    second.delete(p.id);
    assert.throws(() => first.update(p.id, saved), e => e.status === 404);
  } finally { second.close(); first.close(); }
});
