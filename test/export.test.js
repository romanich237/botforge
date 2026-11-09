const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { unzipSync, strFromU8 } = require('fflate');
const { generate, archive } = require('../exporter');
const { defaults } = require('../project');
const { example } = require('../public/guide');
const { randomUUID } = require('node:crypto');
const { createServer } = require('../server');
function check(command, args, cwd) { const run = spawnSync(command, args, { cwd, encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr || run.stdout); return run.stdout; }
test('both exports are valid ZIPs with runnable engines, syntax and safe project data', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'botforge-export-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const p = { ...defaults(), ...example(randomUUID) }; p.nodes[2].data.text = '"; process.exit(42); #\n<script>bad()</script> ${unsafe}';
  // Braces are variables in the DSL; use a declared name even in adversarial text.
  p.variables = [{ name: 'unsafe', type: 'text', initial: 'literal value' }];
  for (const lang of ['python', 'javascript']) {
    const result = await generate(p, lang); assert.equal(result.valid, true);
    const unpacked = unzipSync(archive(result.files));
    assert.deepEqual(JSON.parse(strFromU8(unpacked['project.json'])), p);
    const target = path.join(dir, lang); await fs.mkdir(target);
    for (const [name, bytes] of Object.entries(unpacked)) { assert(!name.includes('/') && !name.includes('..')); await fs.writeFile(path.join(target, name), bytes); }
    if (lang === 'python') {
      check('python3', ['-m', 'py_compile', 'bot.py', 'runtime.py'], target);
      check('python3', ['-c', "import json\nfrom runtime import Session\np=json.load(open('project.json'))\ns=Session(p)\ne=s.handle({'text':'/start'})\nassert any(x.get('buttons') for x in e)\n"], target);
    } else { check('node', ['--check', 'bot.js'], target); check('node', ['--check', 'runtime.js'], target); check('node', ['-e', "const {Session}=require('./runtime'); const s=new Session(require('./project.json'));if(!s.handle({text:'/start'}).some(e=>e.buttons?.length))throw Error('No buttons')"], target); }
  }
  await assert.rejects(generate(p, 'ruby'), /Python/);
  const invalid = await generate({ ...p, nodes: [], edges: [] }, 'python'); assert.equal(invalid.valid, false); assert.deepEqual(invalid.files, []);
});
test('Telegram adapters send and update messages with valid buttons; failed edits fall back', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'botforge-deliver-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const p = { ...defaults(), ...example(randomUUID) }; p.behavior.history = 'update';
  for (const lang of ['javascript', 'python']) {
    const target = path.join(dir, lang); await fs.mkdir(target);
    for (const f of (await generate(p, lang)).files) await fs.writeFile(path.join(target, f.name), f.content);
    if (lang === 'javascript') {
      const script = `const {Session}=require('./runtime'); const {deliver}=require('./bot'); const s={engine:new Session(require('./project.json')),chatId:1,messages:{},lastMessage:null}; const calls=[];const call=async(m,d)=>{calls.push([m,d]);if(m==='editMessageText')throw Error('Cannot edit');return {message_id:calls.length}};(async()=>{const out=s.engine.handle({text:'/start'});await deliver(s,out,call);const c=out.find(e=>e.buttons?.length).buttons[0].callback;await deliver(s,s.engine.handle({callback:c}),call);console.log(JSON.stringify(calls))})();`;
      const calls = JSON.parse(check('node', ['-e', script], target).trim().split('\n').at(-1));
      assert(calls.some(([m]) => m === 'editMessageReplyMarkup')); assert(calls.some(([m]) => m === 'editMessageText')); assert.equal(calls.filter(([m]) => m === 'sendMessage').length, 2);
      assert(calls.find(([m]) => m === 'sendMessage')[1].reply_markup.inline_keyboard[0][0].callback_data.length <= 64);
    } else {
      const script = `import json\nfrom runtime import Session\nfrom bot import deliver\ns=dict(engine=Session(json.load(open('project.json'))),chatId=1,messages={},lastMessage=None)\ncalls=[]\ndef call(m,d):\n calls.append([m,d])\n if m=='editMessageText': raise RuntimeError('Cannot edit')\n return dict(message_id=len(calls))\nout=s['engine'].handle(dict(text='/start'))\ndeliver(s,out,call)\nc=next(e for e in out if e.get('buttons'))['buttons'][0]['callback']\ndeliver(s,s['engine'].handle(dict(callback=c)),call)\nassert any(m=='editMessageReplyMarkup' for m,d in calls)\nassert any(m=='editMessageText' for m,d in calls)\nassert sum(m=='sendMessage' for m,d in calls)==2\n`;
      check('python3', ['-c', script], target);
    }
  }
});
test('export HTTP endpoints validate unsaved drafts and stream ZIP', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'botforge-http-')); const server = createServer(dir); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise(r => server.close(r)); await fs.rm(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/projects';
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const p = await (await post(base, { name: 'Empty' })).json();
  assert.equal((await post(base + '/' + p.id + '/export', { project: p, language: 'python' })).status, 422);
  const draft = { ...p, ...example(randomUUID) };
  const response = await post(base + '/' + p.id + '/export/zip', { project: draft, language: 'javascript' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/zip');
  const files = unzipSync(new Uint8Array(await response.arrayBuffer())); assert(files['bot.js']);
  assert.equal((await (await fetch(base + '/' + p.id)).json()).nodes.length, 0);
});

test('repeated callbacks are ignored while an action is processing', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'botforge-lock-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const p = { ...defaults(), ...example(randomUUID) };
  for (const lang of ['javascript', 'python']) {
    const target = path.join(dir, lang); await fs.mkdir(target);
    for (const f of (await generate(p, lang)).files) await fs.writeFile(path.join(target, f.name), f.content);
    if (lang === 'javascript') check('node', ['-e', `const assert=require('node:assert/strict'); const {enqueue}=require('./bot');const s={engine:{behavior:{preventDoubleClick:true}}};let release;const gate=new Promise(r=>release=r);let count=0;enqueue(s,()=>gate);assert.equal(enqueue(s,()=>{count++},true),false);s.engine.behavior.preventDoubleClick=false;assert.equal(enqueue(s,()=>{count++},true),true);release();s.chain.then(()=>assert.equal(count,1));`], target);
    else check('python3', ['-c', `from bot import Dispatcher\nfrom concurrent.futures import ThreadPoolExecutor\nfrom threading import Event\nclass E: behavior={'preventDoubleClick':True}\nwith ThreadPoolExecutor(max_workers=1) as pool:\n gate=Event()\n d=Dispatcher(E(),pool)\n d.submit(lambda:gate.wait(2))\n assert d.submit(lambda:None,True) is False\n d.engine.behavior['preventDoubleClick']=False\n assert d.submit(lambda:None,True) is True\n gate.set()\n`], target);
  }
});

test('generated bots start polling and complete a button dialog against an offline Telegram fixture', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'botforge-polling-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const p = { ...defaults(), ...example(randomUUID) };
  for (const lang of ['javascript', 'python']) {
    const target = path.join(dir, lang); await fs.mkdir(target);
    for (const f of (await generate(p, lang)).files) await fs.writeFile(path.join(target, f.name), f.content);
    await fs.writeFile(path.join(target, '.env'), 'BOT_TOKEN=1:offline_fixture\n');
    let driver;
    if (lang === 'javascript') driver = `const calls=[];let stage=0,callback,done=false;global.fetch=async(url,opts)=>{const method=url.split('/').at(-1),body=JSON.parse(opts.body);calls.push({method,body});let result={};if(method==='getWebhookInfo')result={url:''};if(method==='getUpdates'){await new Promise(r=>setTimeout(r,10));if(done){console.log('RESULT:'+JSON.stringify(calls));process.exit(0)}result=stage===0?(stage=1,[{update_id:1,message:{chat:{id:1,type:'private'},message_id:1,text:'/start'}}]):callback&&stage===1?(stage=2,[{update_id:2,callback_query:{id:'callback',data:callback,message:{chat:{id:1,type:'private'},message_id:2}}}]):[];}if(method==='sendMessage'){callback ||= body.reply_markup.inline_keyboard?.[0]?.[0]?.callback_data;result={message_id:2};if(body.text.includes('Мы создаём'))done=true;}return {json:async()=>({ok:true,result})}};require('node:module').runMain();`;
    else driver = `import io,json,time,urllib.request,runpy\ncalls=[]\nstate={'stage':0,'callback':None,'done':False}\ndef fixture(req,timeout=None):\n method=req.full_url.split('/')[-1]\n body=json.loads(req.data)\n calls.append(dict(method=method,body=body))\n result={}\n if method=='getWebhookInfo': result={'url':''}\n if method=='getUpdates':\n  time.sleep(0.01)\n  if state['done']:\n   print('RESULT:'+json.dumps(calls,ensure_ascii=False))\n   raise KeyboardInterrupt()\n  result=[]\n  if state['stage']==0:\n   state['stage']=1\n   result=[{'update_id':1,'message':{'chat':{'id':1,'type':'private'},'message_id':1,'text':'/start'}}]\n  elif state['callback'] and state['stage']==1:\n   state['stage']=2\n   result=[{'update_id':2,'callback_query':{'id':'callback','data':state['callback'],'message':{'chat':{'id':1,'type':'private'},'message_id':2}}}]\n if method=='sendMessage':\n  buttons=body['reply_markup'].get('inline_keyboard')\n  if buttons: state['callback']=buttons[0][0]['callback_data']\n  result={'message_id':2}\n  if 'Мы создаём' in body['text']: state['done']=True\n return io.BytesIO(json.dumps({'ok':True,'result':result}).encode())\nurllib.request.urlopen=fixture\nrunpy.run_path('bot.py',run_name='__main__')\n`;
    const args = lang === 'javascript' ? ['-e', driver, path.join(target, 'bot.js')] : ['-c', driver];
    const run = spawnSync(lang === 'javascript' ? 'node' : 'python3', args, { cwd: target, encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stderr || String(run.error));
    const result = run.stdout.split('\n').find(line => line.startsWith('RESULT:')); assert(result, run.stdout);
    const calls = JSON.parse(result.slice(7));
    assert(calls.some(c => c.method === 'answerCallbackQuery'));
    assert(calls.some(c => c.method === 'sendMessage' && c.body.text === 'Мы создаём удобных ботов без программирования.'));
  }
});
