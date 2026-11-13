const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validate, checkShape, defaults } = require('./project');
const { generate, archive } = require('./exporter');
const { createAssistant } = require('./assistant');
const { createAuth } = require('./auth');
const { createStorage } = require('./storage');

function createServer(dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data'), options = {}) {
  const assistant = createAssistant(options.ai);
  const publicOrigin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;
  const files = { '/bootstrap.min.css': ['bootstrap.min.css', 'text/css; charset=utf-8'], '/graphite.css': ['graphite.css', 'text/css; charset=utf-8'], '/studio.css': ['studio.css', 'text/css; charset=utf-8'], '/icons.svg': ['icons.svg', 'image/svg+xml'], '/icons-LICENSE.txt': ['icons-LICENSE.txt', 'text/plain; charset=utf-8'], '/privacy': ['privacy.html', 'text/html; charset=utf-8'], '/tour.js': ['tour.js', 'text/javascript; charset=utf-8'], '/logo.webp': ['logo.webp', 'image/webp'],
    '/favicon.ico': ['favicon.ico', 'image/x-icon'],
    '/favicon-16x16.webp': ['favicon-16x16.webp', 'image/webp'],
    '/favicon-32x32.webp': ['favicon-32x32.webp', 'image/webp'],
    '/apple-touch-icon.webp': ['apple-touch-icon.webp', 'image/webp'],
    '/icon-192.webp': ['icon-192.webp', 'image/webp'],
    '/icon-512.webp': ['icon-512.webp', 'image/webp'],
    '/site.webmanifest': ['site.webmanifest', 'application/manifest+json'],
    '/editor.js': ['editor.js', 'text/javascript; charset=utf-8'], '/': ['index.html', 'text/html; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/responsive.js': ['responsive.js', 'text/javascript; charset=utf-8'], '/clipboard.js': ['clipboard.js', 'text/javascript; charset=utf-8'], '/history.js': ['history.js', 'text/javascript; charset=utf-8'], '/canvas.js': ['canvas.js', 'text/javascript; charset=utf-8'], '/canvas.css': ['canvas.css', 'text/css; charset=utf-8'], '/guide.js': ['guide.js', 'text/javascript; charset=utf-8'], '/runtime.js': ['runtime.js', 'text/javascript; charset=utf-8'], '/preview.js': ['preview.js', 'text/javascript; charset=utf-8'], '/languages.js': ['languages.js', 'text/javascript; charset=utf-8'], '/layout.js': ['layout.js', 'text/javascript; charset=utf-8'], '/ai.js': ['ai.js', 'text/javascript; charset=utf-8'] };
  const storage = createStorage(dataDir);
  const auth = createAuth(dataDir, { origin: publicOrigin, ...options.auth });
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (await auth.handle(req, res, url)) return;
      if (!url.pathname.startsWith('/api/')) {
        const entry = files[url.pathname];
        if (!entry || req.method !== 'GET') return send(404, { message: 'Не найдено' });
        res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-cache, must-revalidate' });
        return res.end(await fs.readFile(path.join(__dirname, '..', 'frontend', 'public', entry[0])));
      }
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return send(405, { message: 'Метод не поддерживается' });
      if (req.headers.origin && !auth.acceptsOrigin(req.headers.origin) && (publicOrigin || auth.enabled || req.headers.origin !== 'http://' + req.headers.host)) return send(403, { message: 'Недопустимый источник запроса' });
      const user = auth.user(req);
      if (!user) return send(401, { message: 'Войдите через Google, чтобы открыть проекты' });
      const owner = user.id;
      if (url.pathname === '/api/ai/status' && req.method === 'GET') return send(200, { ...assistant.status(), quota: auth.quota(owner) });
      let body;
      if (['POST', 'PUT'].includes(req.method)) {
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { message: 'Ожидается application/json' });
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) return send(413, { message: 'Проект превышает 1 МБ' }); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { message: 'Некорректный JSON' }); }
      }
      const match = url.pathname.match(/^\/api\/projects(?:\/([a-f0-9-]{36})(?:\/(ai|duplicate|validate|export(?:\/zip)?))?)?$/);
      if (!match) return send(404, { message: 'Не найдено' });
      const [, id, action] = match;
      if (id && action === 'ai' && req.method === 'POST') {
        storage.get(id, owner);
        if (!assistant.status().configured) return send(503, { message: 'ИИ пока не настроен' });
        const balance = auth.credits(owner);
        if (!balance.tokensRemaining) return send(402, { message: 'Кредиты ИИ закончились.' });
        auth.reserve(owner);
        const result = await assistant.generate(body?.project, body?.prompt, { mode: body?.mode, selectedNodeId: body?.selectedNodeId, maxTokens: balance.tokensRemaining });
        result.usage = { ...result.usage, ...auth.consumeTokens(owner, result.usage?.generatedTokens || 0) };
        return send(200, result);
      }
      const run = async () => {
        if (!id && req.method === 'GET') {
          return send(200, storage.list(owner));
        }
        if (!id && req.method === 'POST') {
          const issue = checkShape({ ...defaults(), ...body });
          if (issue) return send(400, { message: issue });
          const project = { ...defaults(), ...body, id: randomUUID(), revision: 1, updatedAt: Date.now() };
          storage.create(project, owner); return send(201, project);
        }
        if (!id) return send(405, { message: 'Метод не поддерживается' });
        const current = storage.get(id, owner);
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
          storage.create(copy, owner); return send(201, copy);
        }
        if (action) return send(405, { message: 'Метод не поддерживается' });
        if (req.method === 'GET') return send(200, current);
        if (req.method === 'PUT') {
          const issue = checkShape(body);
          if (issue) return send(400, { message: issue });
          return send(200, storage.update(id, body, owner));
        }
        if (req.method === 'DELETE') { storage.delete(id, owner); return send(200, { deleted: true }); }
        return send(405, { message: 'Метод не поддерживается' });
      };
      await run();
    } catch (error) {
      if (!res.headersSent) send(error.status || 500, { message: error.status ? error.message : 'Ошибка сервера. Данные не сохранены; повторите попытку.' });
      else res.end();
    }
  });
  server.on('close', () => { storage.close(); auth.close(); });
  return server;
}
function start() {
  return createServer().listen(Number(process.env.PORT) || 3000, '127.0.0.1', () => console.log('BotForge: http://localhost:' + (process.env.PORT || 3000)));
}

module.exports = { createServer, start };
