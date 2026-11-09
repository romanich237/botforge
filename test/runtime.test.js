const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { Session } = require('../public/runtime');
const { defaults, validate } = require('../project');
const { example } = require('../public/guide');
function project() {
  const p = { ...defaults(), name: 'Test', variables: [{ name: 'age', type: 'number', initial: 0 }, { name: 'имя', type: 'text', initial: 'мир' }] };
  p.nodes = [
    { id: 's', type: 'start', data: {} },
    { id: 'menu', type: 'buttons', data: { text: 'Привет, {имя}', buttons: [{ id: 'ask', label: 'Возраст', action: 'transition' }, { id: 'link', label: 'Сайт', action: 'url', url: 'https://example.com' }], placement: 'inline' } },
    { id: 'input', type: 'input', data: { text: 'Возраст?', variable: 'age', validation: 'number', error: 'Нужно число' } },
    { id: 'condition', type: 'condition', data: { variable: 'age', operation: 'gt', value: '17' } },
    { id: 'yes', type: 'text', data: { text: 'Взрослый: {age}' } },
    { id: 'no', type: 'text', data: { text: 'Младше 18' } },
    { id: 'c', type: 'command', data: { command: '/age', description: 'Возраст' } },
    { id: 'end', type: 'end', data: {} }
  ].map(n => ({ ...n, x: 0, y: 0 }));
  p.edges = [['s', 'next', 'menu'], ['menu', 'ask', 'input'], ['input', 'next', 'condition'], ['condition', 'yes', 'yes'], ['condition', 'no', 'no'], ['yes', 'next', 'end'], ['c', 'next', 'input']].map(([source, output, target], i) => ({ id: String(i), source, output, target }));
  return p;
}
function simulate(p, events) {
  const session = new Session(p, 'deadbeef');
  return events.map((e, i) => ({ events: e.tick ? session.tick(e.now) : session.handle(e, e.now ?? i * 1000), values: { ...session.values }, waiting: session.waiting, current: session.current }));
}
function python(p, events) {
  const script = `import sys,json\nsys.path.insert(0,'templates')\nfrom runtime import Session\nx=json.load(sys.stdin)\ns=Session(x['project'],'deadbeef')\nresult=[]\nfor i,e in enumerate(x['events']):\n out=s.tick(e['now']) if e.get('tick') else s.handle(e,e.get('now',i*1000))\n result.append(dict(events=out,values=dict(s.values),waiting=s.waiting,current=s.current))\nprint(json.dumps(result,ensure_ascii=False))`;
  const run = spawnSync('python3', ['-c', script], { input: JSON.stringify({ project: p, events }), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); return JSON.parse(run.stdout);
}
test('Python and JavaScript agree on commands, buttons, input, conditions and reset', () => {
  const p = project(); assert.equal(validate(p).valid, true);
  const events = [{ text: '/start' }, { callback: 'deadbeef-1:0' }, { text: '/unknown' }, { text: 'abc' }, { text: '/help' }, { text: '20' }, { text: '/age' }, { text: '15' }, { text: '???' }, { text: '/start' }, { callback: 'deadbeef-1:0' }, { text: '/age' }, { text: '/cancel' }];
  const result = simulate(p, events);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), python(p, events));
  assert.equal(result[2].waiting, 'input');
  assert.equal(result[5].values.age, 20);
  assert(result[5].events.some(e => e.text === 'Взрослый: 20'));
  assert(result[7].events.some(e => e.text === 'Младше 18'));
  assert.equal(result[9].values.age, 0);
  assert(result[10].events.some(e => e.type === 'notice'));
  assert.equal(result[12].waiting, null);
});
test('input timeout, throttling, keyboard and case rules agree across runtimes', () => {
  const p = project(); p.behavior = { ...p.behavior, inputTimeout: true, timeoutSeconds: 2, ignoreCase: true };
  const events = [{ text: '/AGE' }, { text: 'NaN' }, { tick: true, now: 2500 }, { text: '20', now: 3000 }];
  const result = simulate(p, events); assert.deepEqual(JSON.parse(JSON.stringify(result)), python(p, events)); assert.equal(result[2].waiting, null);
  p.behavior.rateLimit = true; p.behavior.rateCount = 1; p.behavior.rateSeconds = 10;
  const limited = [{ text: '/start', now: 0 }, { text: '/help', now: 1 }, { text: '/help', now: 2 }, { text: '/help', now: 11000 }];
  assert.deepEqual(JSON.parse(JSON.stringify(simulate(p, limited))), python(p, limited));
  assert.equal(simulate(p, limited)[2].events.length, 0);
  p.behavior.rateLimit = false; p.nodes.find(n => n.id === 'menu').data.placement = 'keyboard';
  const keyboard = [{ text: '/start' }, { text: 'Возраст' }, { text: '18' }];
  assert.deepEqual(JSON.parse(JSON.stringify(simulate(p, keyboard))), python(p, keyboard));
});
test('automatic cycles stop after 100 transitions', () => {
  const p = project(); p.edges.find(e => e.source === 's').target = 's';
  const events = [{ text: '/start' }];
  const result = simulate(p, events); assert.equal(result[0].events.at(-1).type, 'error');
  assert.deepEqual(result, python(p, events));
});
test('text, email and choice validation keep the question active on failure', () => {
  for (const [kind, bad, good] of [['text', '', 'Аня'], ['email', 'wrong', 'a@example.com'], ['choice', 'C', 'A']]) {
    const p = project(); p.variables[0] = { name: 'age', type: 'text', initial: '' }; const d = p.nodes.find(n => n.id === 'input').data; d.validation = kind; d.choices = 'A, B'; p.edges.find(e => e.source === 'input').target = 'end';
    const events = [{ text: '/age' }, { text: bad }, { text: good }];
    const result = simulate(p, events); assert.equal(result[1].waiting, 'input'); assert.equal(result[2].values.age, good);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), python(p, events));
  }
});
module.exports = { project };

test('empty preview explains missing start', () => {
  const p = { ...defaults(), name: 'Empty' }; const events = [{ text: '/start' }];
  const result = simulate(p, events); assert.equal(result[0].events[0].type, 'error'); assert.deepEqual(result, python(p, events));
});
