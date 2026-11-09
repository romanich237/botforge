const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { defaults } = require('../project');
const { example } = require('../public/guide');
const { Session } = require('../public/runtime');
const { generate } = require('../exporter');
let nextId = 0;
function fixture() {
 const p = { ...defaults(), ...example(() => 'id' + (++nextId)), variables: [{ name: 'age', type: 'number', initial: 0 }] };
 p.behavior.inputTimeout = true; p.behavior.timeoutSeconds = 100;
 p.nodes.push(...[
  { id: 'cmd', type: 'command', data: { command: '/age', description: 'Возраст' } },
  { id: 'ask', type: 'input', data: { text: 'Возраст?', variable: 'age', validation: 'number', error: 'Нужно число' } },
  { id: 'check', type: 'condition', data: { variable: 'age', operation: 'gt', value: '17' } },
  { id: 'yes', type: 'text', data: { text: 'Возраст: {age}' } },
  { id: 'no', type: 'text', data: { text: 'Младше 18' } }
 ].map(n => ({ ...n, x: 0, y: 0 })));
 for (const [source, output, target] of [['cmd','next','ask'],['ask','next','check'],['check','yes','yes'],['check','no','no']]) p.edges.push({id:source+output,source,output,target});
 return p;
}
async function writeFiles(dir, language, p) {
 const result = await generate(p, language); assert.equal(result.valid, true, JSON.stringify(result.errors));
 for (const f of result.files) await fs.writeFile(path.join(dir, f.name), f.content);
}
function run(command, args, cwd, input) {
 const result = spawnSync(command,args,{cwd,input,encoding:'utf8',timeout:60000}); assert.equal(result.status,0,result.stdout + result.stderr + String(result.error || '')); return result.stdout;
}
function trace(p, events) {const s = new Session(p,'deadbeef');return events.map((event,i) => ({events:event.tick ? s.tick(event.now) : s.handle(event,event.now ?? i*1000),values:{...s.values},waiting:s.waiting,current:s.current}));}

test('TypeScript archive compiles in strict mode and its built bot uses the shared engine', async t => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'botforge-ts-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const p=fixture();await writeFiles(dir,'typescript',p);await fs.symlink(path.resolve(__dirname,'../node_modules'),path.join(dir,'node_modules'),'dir');
 run(process.execPath,[path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc'),'-p','tsconfig.json'],dir);
 assert((await fs.readFile(path.join(dir,'dist/bot.js'),'utf8')).includes('function deliver'));
 const events=[{text:'/start'},{callback:'deadbeef-1:0'},{text:'/age'},{text:'wrong'},{text:'20'},{text:'/age'},{text:'15'},{text:'/start'}];
 const code=`const{Session}=require('./dist/runtime');const s=new Session(require('./project.json'),'deadbeef');const input=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(input.map((e,i)=>({events:s.handle(e,i*1000),values:{...s.values},waiting:s.waiting,current:s.current}))));`;
 assert.deepEqual(JSON.parse(run(process.execPath,['-e',code],dir,JSON.stringify(events))),trace(p,events));
 const missing=spawnSync(process.execPath,['dist/bot.js'],{cwd:dir,env:{...process.env,BOT_TOKEN:''},encoding:'utf8'});assert.equal(missing.status,1);assert(missing.stderr.includes('BOT_TOKEN'));
});

test('Go archive builds and agrees with the preview on commands, callbacks, input, branches and timer', async t => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'botforge-go-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const p=fixture();await writeFiles(dir,'go',p);
 const events=[{text:'/start'},{callback:'deadbeef-1:0'},{text:'/age'},{text:'wrong'},{text:'/help'},{text:'20'},{text:'/age'},{text:'15'},{text:'/age'},{tick:true,now:200000},{text:'/cancel',now:201000},{text:'/unknown',now:202000}];
 await fs.writeFile(path.join(dir,'fixture.json'),JSON.stringify({project:p,events,expected:trace(p,events)}));
 await fs.writeFile(path.join(dir,'runtime_test.go'),`package main
import("encoding/json";"os";"testing";"reflect";"net/http";"io";"strings";"time";"sync";"errors")
func TestParity(t *testing.T){
 var fixture struct{Project Project;Events []map[string]any;Expected any};b,_:=os.ReadFile("fixture.json");if err:=json.Unmarshal(b,&fixture);err!=nil{t.Fatal(err)}
 s:=NewSession(fixture.Project,"deadbeef");trace:=[]any{}
 for i,e:=range fixture.Events{now:=int64(i*1000);if n,ok:=e["now"].(float64);ok{now=int64(n)};var events []Event;if e["tick"]==true{events=s.Tick(now)}else{events=s.Handle(e,now)};values:=map[string]any{};for k,v:=range s.Values{values[k]=v};var waiting,current any;if s.Waiting!=""{waiting=s.Waiting};if s.Current!=""{current=s.Current};trace=append(trace,map[string]any{"events":events,"values":values,"waiting":waiting,"current":current})}
 raw,_:=json.Marshal(trace);var actual any;_ = json.Unmarshal(raw,&actual);if !reflect.DeepEqual(actual,fixture.Expected){t.Fatalf("actual=%s\\nexpected=%v",raw,fixture.Expected)}
}

type fixtureTransport func(*http.Request)(*http.Response,error)
func(f fixtureTransport)RoundTrip(r *http.Request)(*http.Response,error){return f(r)}
func TestTelegramDialog(t *testing.T){
 var p Project;b,_:=os.ReadFile("project.json");_ = json.Unmarshal(b,&p);var mu sync.Mutex;stage:=0;callback:="";done:=make(chan struct{});completed:=false;ack:=false
 client:=&http.Client{Transport:fixtureTransport(func(r *http.Request)(*http.Response,error){
  method:=r.URL.Path[strings.LastIndex(r.URL.Path,"/")+1:];if method=="getUpdates"{time.Sleep(5*time.Millisecond)};mu.Lock();defer mu.Unlock();var data map[string]any;_ = json.NewDecoder(r.Body).Decode(&data);var result any=map[string]any{}
  if method=="getWebhookInfo"{result=map[string]any{"url":""}}
  if method=="getUpdates"{result=[]any{};if stage==0{stage=1;result=[]any{map[string]any{"update_id":1,"message":map[string]any{"chat":map[string]any{"id":1,"type":"private"},"message_id":1,"text":"/start"}}}}else if stage==1&&callback!=""{stage=2;result=[]any{map[string]any{"update_id":2,"callback_query":map[string]any{"id":"cb","data":callback,"message":map[string]any{"chat":map[string]any{"id":1,"type":"private"},"message_id":2}}}}}}
  if method=="answerCallbackQuery"{ack=true}
  if method=="sendMessage"{if callback==""{m:=data["reply_markup"].(map[string]any);rows:=m["inline_keyboard"].([]any);callback=rows[0].([]any)[0].(map[string]any)["callback_data"].(string)};if data["text"]=="Мы создаём удобных ботов без программирования."&&!completed{completed=true;close(done)};result=map[string]any{"message_id":2}}
  raw,_:=json.Marshal(map[string]any{"ok":true,"result":result});return &http.Response{StatusCode:200,Body:io.NopCloser(strings.NewReader(string(raw))),Header:http.Header{}},nil
 })}
 go func(){_ = serve(&API{Token:"1:offline",Client:client},p)}()
 select{case <-done:mu.Lock();defer mu.Unlock();if !ack{t.Fatal("callback not acknowledged")};case <-time.After(5*time.Second):t.Fatal("dialog timed out")}
}
func TestHistoryFallback(t *testing.T){
 var p Project;b,_:=os.ReadFile("project.json");_ = json.Unmarshal(b,&p);p.Behavior["history"]="update";s:=&BotSession{Engine:NewSession(p,"deadbeef"),ChatID:1,Messages:map[string]any{},LastMessage:float64(1)};sent:=0
 err:=deliver(s,[]Event{s.Engine.message("Ответ",nil)},func(method string,data any)(map[string]any,error){if method=="editMessageText"{return nil,errors.New("Cannot edit")};if method=="sendMessage"{sent++};return map[string]any{"message_id":2},nil});if err!=nil||sent!=1{t.Fatal("no fallback",err)}
}

`);
 run('go',['test','-race','./...'],dir);run('go',['build','-o','botforge-bot','.'],dir);
 const missing=spawnSync(path.join(dir,'botforge-bot'),[],{cwd:dir,env:{...process.env,BOT_TOKEN:''},encoding:'utf8'});assert.equal(missing.status,1);assert(missing.stderr.includes('BOT_TOKEN'));
});
