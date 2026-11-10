const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const { checkShape } = require('./project');

const notFound = () => Object.assign(Error('Проект не найден'), { status: 404 });

function createStorage(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filename = path.join(dataDir, 'botforge.sqlite');
  const db = new Database(filename);
  try {
    fs.chmodSync(filename, 0o600);
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK (revision > 0),
        updated_at INTEGER NOT NULL,
        document TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS projects_updated ON projects(updated_at DESC);
    `);
    if (!db.pragma('table_info(projects)').some(c => c.name === 'owner_id')) db.exec("ALTER TABLE projects ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy'");
    const insert = db.prepare('INSERT INTO projects (id, revision, updated_at, document, owner_id) VALUES (?, ?, ?, ?, ?)');
    const insertProject = (project, owner = 'legacy') => insert.run(project.id, project.revision, project.updatedAt, JSON.stringify(project), owner);

    // One transaction and a persistent marker prevent partial imports and resurrection after deletion.
    db.transaction(() => {
      if (db.prepare("SELECT value FROM metadata WHERE key = 'json_import_v1'").get()) return;
      const exists = db.prepare('SELECT id FROM projects WHERE id = ?');
      for (const name of fs.readdirSync(dataDir).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).sort()) {
        let project;
        try { project = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')); }
        catch { throw Error('Не удалось прочитать JSON-проект ' + name + '. Исходный файл сохранён.'); }
        const issue = checkShape(project);
        if (issue || project.id !== name.slice(0, -5) || !Number.isSafeInteger(project.revision) || project.revision < 1 || !Number.isSafeInteger(project.updatedAt)) {
          throw Error('Не удалось перенести проект ' + name + ': ' + (issue || 'некорректные метаданные'));
        }
        if (!exists.get(project.id)) insertProject(project);
      }
      db.prepare("INSERT INTO metadata (key, value) VALUES ('json_import_v1', 'done')").run();
    }).immediate();

    const read = db.prepare('SELECT document FROM projects WHERE id = ? AND owner_id = ?');
    const list = db.prepare('SELECT document FROM projects WHERE owner_id = ? ORDER BY updated_at DESC, id');
    const update = db.prepare('UPDATE projects SET revision = ?, updated_at = ?, document = ? WHERE id = ? AND revision = ? AND owner_id = ?');
    const remove = db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?');
    return {
      list: (owner = 'legacy') => list.all(owner).map(row => JSON.parse(row.document)),
      get(id, owner = 'legacy') {
        const row = read.get(id, owner);
        if (!row) throw notFound();
        return JSON.parse(row.document);
      },
      create(project, owner = 'legacy') { insertProject(project, owner); return project; },
      update(id, body, owner = 'legacy') {
        if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw Object.assign(Error('Некорректная ревизия проекта'), { status: 400 });
        return db.transaction(() => {
          const project = { ...body, id, revision: body.revision + 1, updatedAt: Date.now() };
          const result = update.run(project.revision, project.updatedAt, JSON.stringify(project), id, body.revision, owner);
          if (!result.changes) {
            if (!read.get(id, owner)) throw notFound();
            throw Object.assign(Error('Проект изменён в другой вкладке. Скопируйте свои изменения перед перезагрузкой.'), { status: 409 });
          }
          return project;
        }).immediate();
      },
      delete(id, owner = 'legacy') { if (!remove.run(id, owner).changes) throw notFound(); },
      close: () => db.close()
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { createStorage };
