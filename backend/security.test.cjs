const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createAuth} = require('./auth');
const {createServer} = require('./server');

test('public origin cannot silently fall back to anonymous local access',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bf-sec-'));
  try { assert.throws(()=>createAuth(dir,{origin:'https://example.com',clientId:'',clientSecret:''}),/Google/); }
  finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('anonymous API access, cross-site changes and non-public files are rejected',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bf-sec-'));
  const server=createServer(dir,{auth:{clientId:'fixture',clientSecret:'fixture',origin:'https://example.com',client:{}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  for(const route of ['/api/projects','/api/ai/status']) assert.equal((await fetch(base+route)).status,401);
  assert.equal((await fetch(base+'/api/projects',{method:'POST',headers:{'Sec-Fetch-Site':'cross-site','Content-Type':'application/json'},body:'{}'})).status,403);
  for(const route of ['/.env','/backend/auth.js','/constructor','/../.env']) assert.equal((await fetch(base+route)).status,404);
  const home=await fetch(base+'/');
  assert.equal(home.headers.get('x-frame-options'),'DENY');
  assert(home.headers.get('content-security-policy').includes("script-src 'self'"));
});
