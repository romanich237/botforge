const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validate, checkShape, defaults } = require('./project');
const { generate, archive } = require('./exporter');

function createServer(dataDir = process.env.DATA_DIR || path.join(__dirname, 'data')) {
  const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/canvas.js': ['canvas.js', 'text/javascript; charset=utf-8'], '/canvas.css': ['canvas.css', 'text/css; charset=utf-8'], '/guide.js': ['guide.js', 'text/javascript; charset=utf-8'], '/runtime.js': ['runtime.js', 'text/javascript; charset=utf-8'], '/preview.js': ['preview.js', 'text/javascript; charset=utf-8'], '/languages.js': ['languages.js', 'text/javascript; charset=utf-8'] };
  // shortcut: single local server, use a transactional database before multiple instances.
  let queue = Promise.resolve();
  async function load(id) {
    try { return JSON.parse(await fs.readFile(path.join(dataDir, id + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('Проект не найден'), { status: 404 }); throw error; }
  }
  async function write(project) {
    await fs.mkdir(dataDir, { recursive: true });
    const target = path.join(dataDir, project.id + '.json');
    const temp = target + '.tmp';
    await fs.writeFile(temp, JSON.stringify(project), { mode: 0o600 });
    await fs.rename(temp, target);
  }
  return http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        const entry = files[url.pathname];
        if (!entry || req.method !== 'GET') return send(404, { message: 'Не найдено' });
        res.writeHead(200, { 'Content-Type': entry[1] });
        return res.end(await fs.readFile(path.join(__dirname, 'public', entry[0])));
      }
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return send(405, { message: 'Метод не поддерживается' });
      if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return send(403, { message: 'Недопустимый источник запроса' });
      let body;
      if (['POST', 'PUT'].includes(req.method)) {
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { message: 'Ожидается application/json' });
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) return send(413, { message: 'Проект превышает 1 МБ' }); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { message: 'Некорректный JSON' }); }
      }
      const match = url.pathname.match(/^\/api\/projects(?:\/([a-f0-9-]{36})(?:\/(duplicate|validate|export(?:\/zip)?))?)?$/);
      if (!match) return send(404, { message: 'Не найдено' });
      const [, id, action] = match;
      const run = async () => {
        if (!id && req.method === 'GET') {
          await fs.mkdir(dataDir, { recursive: true });
          const names = (await fs.readdir(dataDir)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n));
          const projects = await Promise.all(names.map(n => load(n.slice(0, -5))));
          return send(200, projects.sort((a, b) => b.updatedAt - a.updatedAt));
        }
        if (!id && req.method === 'POST') {
          const issue = checkShape({ ...defaults(), ...body });
          if (issue) return send(400, { message: issue });
          const project = { ...defaults(), ...body, id: randomUUID(), revision: 1, updatedAt: Date.now() };
          await write(project); return send(201, project);
        }
        if (!id) return send(405, { message: 'Метод не поддерживается' });
        const current = await load(id);
        if ((action === 'export' || action === 'export/zip') && req.method === 'POST') {
          const result = await generate(body?.project, body?.language);
          if (!result.valid) return send(422, result);
          if (action === 'export') return send(200, result);
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="botforge-' + body.language + '.zip"', 'Cache-Control': 'no-store' });
          return res.end(archive(result.files));
        }
        if (action === 'validate' && req.method === 'POST') {
          const issue = checkShape(body);
          return issue ? send(400, { message: issue }) : send(200, validate(body));
        }
        if (action === 'duplicate' && req.method === 'POST') {
          const copy = { ...current, id: randomUUID(), name: (current.name.slice(0, 70) + ' — копия'), revision: 1, updatedAt: Date.now() };
          await write(copy); return send(201, copy);
        }
        if (action) return send(405, { message: 'Метод не поддерживается' });
        if (req.method === 'GET') return send(200, current);
        if (req.method === 'PUT') {
          const issue = checkShape(body);
          if (issue) return send(400, { message: issue });
          if (body.revision !== current.revision) return send(409, { message: 'Проект изменён в другой вкладке. Скопируйте свои изменения перед перезагрузкой.' });
          const project = { ...body, id, revision: current.revision + 1, updatedAt: Date.now() };
          await write(project); return send(200, project);
        }
        if (req.method === 'DELETE') { await fs.unlink(path.join(dataDir, id + '.json')); return send(200, { deleted: true }); }
        return send(405, { message: 'Метод не поддерживается' });
      };
      const pending = queue.then(run);
      queue = pending.catch(() => {});
      await pending;
    } catch (error) {
      if (!res.headersSent) send(error.status || 500, { message: error.status ? error.message : 'Ошибка сервера. Данные не сохранены; повторите попытку.' });
      else res.end();
    }
  });
}
if (require.main === module) createServer().listen(Number(process.env.PORT) || 3000, '127.0.0.1', () => console.log('BotForge: http://localhost:' + (process.env.PORT || 3000)));
module.exports = { createServer };
