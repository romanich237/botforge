const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8']
};

http.createServer(async (req, res) => {
  const entry = files[req.url.split('?')[0]];
  if (!entry) {
    res.writeHead(404);
    return res.end('Not found');
  }
  try {
    const content = await fs.readFile(path.join(__dirname, 'public', entry[0]));
    res.writeHead(200, {
      'Content-Type': entry[1],
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'"
    });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end('Unable to load page');
  }
}).listen(Number(process.env.PORT) || 3000, '127.0.0.1', () => {
  console.log('BotForge: http://localhost:' + (process.env.PORT || 3000));
});
