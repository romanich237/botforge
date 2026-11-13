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

test('Google login limit separates real proxy clients but ignores spoofed headers from direct clients',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bf-ip-'));
  const auth=createAuth(dir,{origin:'https://example.com',clientId:'fixture',clientSecret:'fixture',client:{generateAuthUrl:()=> 'https://accounts.google.com/'}});
  const response=()=>({setHeader(){},writeHead(){},end(){}});
  const req=(remote,ip)=>({method:'GET',headers:{'x-real-ip':ip},socket:{remoteAddress:remote}});
  try {
    for(let i=0;i<20;i++) await auth.handle(req('127.0.0.1','192.0.2.1'),response(),new URL('https://example.com/auth/google'));
    await assert.rejects(auth.handle(req('127.0.0.1','192.0.2.1'),response(),new URL('https://example.com/auth/google')),e=>e.status===429);
    await auth.handle(req('127.0.0.1','192.0.2.2'),response(),new URL('https://example.com/auth/google'));
    for(let i=0;i<20;i++) await auth.handle(req('198.51.100.1','192.0.2.'+i),response(),new URL('https://example.com/auth/google'));
    await assert.rejects(auth.handle(req('198.51.100.1','192.0.2.100'),response(),new URL('https://example.com/auth/google')),e=>e.status===429);
  } finally {auth.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('storage quotas bound account growth without blocking edits or leaking other users projects',async()=>{
  const {createStorage}=require('./storage'),{defaults}=require('./project'),{randomUUID}=require('node:crypto');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bf-quota-')),storage=createStorage(dir);
  try {
    const project=()=>({...defaults(),id:randomUUID(),name:'Audit fixture',revision:1,updatedAt:Date.now()});
    const p=project();storage.create(p,'a');
    for(let i=1;i<200;i++) storage.create(project(),'a');
    assert.throws(()=>storage.create(project(),'a'),e=>e.status===413);
    assert.equal(storage.update(p.id,{...p,name:'Still editable'},'a').name,'Still editable');
    storage.create(project(),'b');
    assert.throws(()=>storage.get(p.id,'b'),e=>e.status===404);
    assert.throws(()=>storage.create({...project(),description:'x'.repeat(20*1024*1024)},'c'),e=>e.status===413);
    assert.equal(storage.list('c').length,0);
  }finally{storage.close();await fs.rm(dir,{recursive:true,force:true});}
});
