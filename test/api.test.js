const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { defaults, checkShape, validate } = require('../project');

test('API persists projects, rejects invalid data and stale writes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'botforge-'));
  let server = createServer(dir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  let base = 'http://127.0.0.1:' + server.address().port;
  async function request(url, method = 'GET', body, origin) {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  }
  assert.equal((await request('/api/projects', 'POST', { name: '' })).status, 400);
  assert.equal((await request('/api/projects', 'POST', { name: 'Bad' }, 'https://evil.example')).status, 403);
  const created = await request('/api/projects', 'POST', { name: 'Магазин' });
  assert.equal(created.status, 201);
  const p = created.data;
  p.nodes = [{ id: 's', type: 'start', x: 0, y: 0, data: {} }, { id: 't', type: 'text', x: 200, y: 10, data: { text: 'Привет, {имя}!' } }];
  p.edges = [{ id: 'e', source: 's', output: 'next', target: 't' }];
  p.variables = [{ name: 'имя', type: 'text', initial: 'мир' }];
  assert.equal((await request('/api/projects/' + p.id + '/validate', 'POST', p)).data.valid, true);
  const saved = await request('/api/projects/' + p.id, 'PUT', p);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.nodes.map(n => [n.x, n.y]), [[0, 0], [200, 10]]);
  assert.deepEqual(saved.data.edges, p.edges);
  assert.equal((await request('/api/projects/' + p.id, 'PUT', p)).status, 409);
  assert.equal((await request('/api/projects/' + p.id, 'PUT', { ...saved.data, edges: [{ id: 'bad', source: 's', output: 'next', target: 'absent' }] })).status, 400);
  const copy = await request('/api/projects/' + p.id + '/duplicate', 'POST', {});
  assert.equal(copy.status, 201); assert.notEqual(copy.data.id, p.id);
  assert.deepEqual(copy.data.nodes, p.nodes);
  await new Promise(resolve => server.close(resolve));
  server = createServer(dir); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  assert.deepEqual((await request('/api/projects/' + p.id)).data, saved.data);
  assert.equal((await request('/api/projects')).data.length, 2);
  assert.equal((await request('/api/projects/' + p.id, 'DELETE')).status, 200);
  assert.equal((await request('/api/projects/' + p.id)).status, 404);
  assert.equal((await request('/api/projects/../../server.js')).status, 404);
});

test('validation reports commands, variables, branches and unreachable blocks', () => {
  const p = { ...defaults(), name: 'Test', nodes: [
    { id: 's', type: 'start', x: 0, y: 0, data: {} },
    { id: 'c', type: 'command', x: 0, y: 0, data: { command: '/help' } },
    { id: 't', type: 'text', x: 0, y: 0, data: { text: '{missing}' } },
    { id: 'i', type: 'condition', x: 0, y: 0, data: { variable: 'number', operation: 'gt', value: 'abc' } }
  ] };
  assert.equal(checkShape(p), null);
  const result = validate(p);
  for (const code of ['COMMAND', 'VARIABLE', 'TRANSITION', 'CONDITION']) assert(result.errors.some(e => e.code === code));
  assert(result.warnings.some(e => e.nodeId === 't'));
  assert(checkShape({ ...p, nodes: [...p.nodes, p.nodes[0]] }));
  assert(checkShape({ ...p, edges: [{ id: 'e', source: 's', output: 'made-up', target: 't' }] }));
  assert(checkShape({ ...p, nodes: [{ id: 'b', type: 'buttons', x: 0, y: 0, data: { buttons: [null] } }] }));
});

test('HTTPS deployment origin and AI endpoints preserve unsaved drafts', async t => {
 const { example }=require('../public/guide');const { randomUUID }=require('node:crypto');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'botforge-https-'));
 const draft={...defaults(),...example(randomUUID)};
 const server=createServer(dir,{publicOrigin:'https://botforge.example',ai:{key:'test',cooldown:0,fetch:async()=>Response.json({choices:[{message:{content:JSON.stringify(draft)}}]})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 const post=(url,body,origin='https://botforge.example')=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
 const created=await post('/api/projects',{name:'Remote'});assert.equal(created.status,201);const p=await created.json();
 assert.equal((await post('/api/projects',{name:'Bad'},'https://evil.example')).status,403);
 const result=await post('/api/projects/'+p.id+'/ai',{project:p,prompt:'Создай меню'});assert.equal(result.status,200);assert.equal((await result.json()).nodes.length,4);
 assert.equal((await(await fetch(base+'/api/projects/'+p.id)).json()).nodes.length,0);
 const status=await(await fetch(base+'/api/ai/status')).json();assert.equal(status.configured,true);assert.equal(status.key,undefined);
});
