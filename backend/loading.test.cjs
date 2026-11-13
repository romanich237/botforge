const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createServer}=require('./server');
test('static assets revalidate unchanged content and HEAD never sends a body',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bf-cache-'));
  const server=createServer(dir,{auth:{clientId:'',clientSecret:'',origin:'http://localhost'}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+server.address().port+'/graphite.css';
  const first=await fetch(url),tag=first.headers.get('etag');assert(tag);assert.equal(first.status,200);assert((await first.text()).length>100);
  for(const etag of [tag,'W/'+tag]){const r=await fetch(url,{headers:{'If-None-Match':etag}});assert.equal(r.status,304);assert.equal(await r.text(),'');}
  const changed=await fetch(url,{headers:{'If-None-Match':'"old-version"'}});assert.equal(changed.status,200);
  const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('etag'),tag);assert.equal(await head.text(),'');
});
test('startup restores the selected project from one list request without overwriting an open draft',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../frontend/public/app.js'),'utf8');
  const reload=source.slice(source.indexOf('async function reload()'),source.indexOf('async function openProject('));
  const project={id:'selected',name:'Saved project',nodes:[]};let calls=0,resets=0;
  const ctx=vm.createContext({loading:false,loadError:'',projects:[],selectedId:project.id,draft:null,structuredClone,render(){},editHistory:{reset(){resets++}},api:async url=>{assert.equal(url,'');calls++;return[project]}});
  vm.runInContext(reload,ctx);await ctx.reload();assert.equal(calls,1);assert.equal(ctx.draft.name,project.name);assert.notEqual(ctx.draft,project);assert.equal(resets,1);assert.equal(ctx.loading,false);
  ctx.draft.name='Unsaved work';await ctx.reload();assert.equal(ctx.draft.name,'Unsaved work');assert.equal(resets,1);
});
