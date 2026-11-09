const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createAssistant } = require('../assistant');
const { arrange } = require('../public/layout');
const { defaults } = require('../project');
const { example } = require('../public/guide');
function project() { return { ...defaults(), ...example(randomUUID) }; }
function output(p) { return { summary: 'Готово', nodes: p.nodes, edges: p.edges, variables: p.variables }; }
test('layout handles branches, cycles and disconnected nodes without changing content', () => {
 const p = project(); p.edges.push({ id:'loop', source:p.nodes[2].id, output:'next', target:p.nodes[0].id });p.nodes.push({id:'disconnected',type:'end',x:20,y:20,data:{}});
 const before=JSON.stringify(p);const result=arrange(p);
 assert.equal(JSON.stringify(p),before);assert.deepEqual(result.edges,p.edges);assert.deepEqual(result.variables,p.variables);
 for(const node of result.nodes){assert(Number.isFinite(node.x)&&Number.isFinite(node.y));assert.deepEqual(node.data,p.nodes.find(n=>n.id===node.id).data);}
 for(let i=0;i<result.nodes.length;i++)for(let j=i+1;j<result.nodes.length;j++){const a=result.nodes[i],b=result.nodes[j];assert(a.x!==b.x||Math.abs(a.y-b.y)>=280);}
 assert.deepEqual(arrange(result),result);
});
test('AI builds a validated proposal without changing the project or revealing its key', async () => {
 const p=project(),before=JSON.stringify(p);let request;
 const ai=createAssistant({key:'test-private-key',cooldown:0,fetch:async(url,options)=>{request={url,options};return Response.json({choices:[{message:{content:JSON.stringify(output(p))}}]});}});
 const result=await ai.generate(p,'Создай меню');assert.equal(JSON.stringify(p),before);assert.equal(result.nodes.length,4);assert.equal(result.edges.length,3);
 assert.equal(request.options.headers.Authorization,'Bearer test-private-key');assert(!request.options.body.includes('test-private-key'));assert(!JSON.stringify(ai.status()).includes('test-private-key'));
 assert(request.url.endsWith('/chat/completions'));assert(result.nodes.some(n=>n.x>0));
});
test('invalid AI graphs, executable output and upstream errors are rejected without mutation', async () => {
 const p=project();
 for(const content of ['process.exit(0)',JSON.stringify({nodes:[],edges:[],variables:[]}),JSON.stringify({...output(p),edges:[{source:'missing',target:'missing',output:'next'}]})]){
  const ai=createAssistant({key:'test',cooldown:0,fetch:async()=>Response.json({choices:[{message:{content}}]})});await assert.rejects(ai.generate(p,'Меню'),e=>e.status===502);
 }
 const ai=createAssistant({key:'sensitive',cooldown:0,fetch:async()=>new Response('sensitive',{status:401})});await assert.rejects(ai.generate(p,'Меню'),e=>e.status===502&&!e.message.includes('sensitive'));
 await assert.rejects(createAssistant({key:''}).generate(p,'Меню'),e=>e.status===503);
});
test('concurrent AI requests and oversized descriptions are limited', async () => {
 const p=project();let release;const gate=new Promise(r=>release=r);
 const ai=createAssistant({key:'test',cooldown:0,fetch:async()=>{await gate;return Response.json({choices:[{message:{content:JSON.stringify(output(p))}}]});}});
 await assert.rejects(ai.generate(p,'x'.repeat(4001)),e=>e.status===400);
 const pending=ai.generate(p,'Меню');await assert.rejects(ai.generate(p,'Ещё меню'),e=>e.status===429);release();await pending;
});

test('AI accepts one JSON scenario surrounded by explanation and a markdown fence', async () => {
 const p=project();const content='Вот готовый сценарий:\n```json\n'+JSON.stringify(output(p))+'\n```\nПроверьте тексты перед запуском.';
 const ai=createAssistant({key:'test',cooldown:0,fetch:async()=>Response.json({choices:[{finish_reason:'stop',message:{content}}]})});
 const result=await ai.generate(p,'Меню');assert.equal(result.nodes.length,4);
});
test('AI distinguishes token truncation from invalid JSON', async () => {
 const p=project();const ai=createAssistant({key:'test',cooldown:0,fetch:async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{"nodes":['}}]})});
 await assert.rejects(ai.generate(p,'Меню'),e=>e.status===502&&/лимит|оборван/.test(e.message));
});

test('JSON extraction handles braces and escaped quotes inside messages and rejects ambiguity', async () => {
 const p=project();p.nodes.find(n=>n.type==='text').data.text='Текст с {переменная}, кавычками " и фигурной скобкой }';p.variables=[{name:'переменная',type:'text',initial:'пример'}];
 const body=JSON.stringify(output(p));
 const ai=createAssistant({key:'test',cooldown:0,fetch:async()=>Response.json({choices:[{message:{content:'Сценарий:\n```json\n'+body+'\n```'}}]})});
 const result=await ai.generate(p,'Меню');assert(result.nodes.some(n=>n.data.text?.includes('скобкой }')));
 const ambiguous=createAssistant({key:'test',cooldown:0,fetch:async()=>Response.json({choices:[{message:{content:body+'\n'+body}}]})});
 await assert.rejects(ambiguous.generate(p,'Меню'),e=>e.status===502&&e.message.includes('несколько'));
});

test('AI requests structured JSON with reduced reasoning and enough output budget', async () => {
 const p=project();let body;
 const ai=createAssistant({key:'test',cooldown:0,fetch:async(_,options)=>{body=JSON.parse(options.body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output(p))}}]});}});
 await ai.generate(p,'Магазин');assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(body.reasoning_effort,'low');assert.equal(body.max_tokens,12000);
});
