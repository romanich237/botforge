const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistory } = require('../frontend/public/history');
const { defaults, checkShape, validate } = require('../backend/project');
const { Session } = require('../frontend/public/runtime');

function project() {
  const p = defaults(); p.id = 'test-project'; p.name = 'Проверка';
  p.nodes = [
    { id: 'start', type: 'start', x: 0, y: 0, data: {} },
    { id: 'cmd', type: 'command', x: 100, y: 0, data: { command: '/test', triggerText: 'привет', triggerMode: 'exact' } },
    { id: 'text', type: 'text', x: 200, y: 0, data: { text: 'Ответ', note: 'Пояснение редактора' } }
  ];
  p.edges = [{ id: 'a', source: 'start', output: 'next', target: 'text' }, { id: 'b', source: 'cmd', output: 'next', target: 'text' }];
  return p;
}
test('undo/redo restores graph and invalidates redo after a new edit', () => {
  const p = project(), history = createHistory(); history.reset(p);
  p.nodes[2].data.text = 'Изменено'; history.record(p);
  assert.equal(history.undo(p), true); assert.equal(p.nodes[2].data.text, 'Ответ');
  assert.equal(history.redo(p), true); assert.equal(p.nodes[2].data.text, 'Изменено');
  history.undo(p); p.nodes[2].data.text = 'Другая правка'; history.record(p);
  assert.equal(history.canRedo(), false);
});
test('history never restores a different project', () => {
  const p = project(), history = createHistory(); history.reset(p); p.description = 'a'; history.record(p);
  assert.equal(history.undo({ ...p, id: 'other' }), false);
});
test('trigger and editor notes are valid and trigger runs', () => {
  const p = project(); assert.equal(checkShape(p), null); assert.equal(validate(p).valid, true);
  const events = new Session(p).handle({ text: 'привет' });
  assert.ok(events.some(e => e.type === 'message' && e.text === 'Ответ'));
});
test('duplicate triggers and invalid keyboard settings are rejected', () => {
  const p = project(); p.nodes.push({ id: 'cmd2', type: 'command', x: 300, y: 0, data: { command: '/second', triggerText: 'привет' } });
  p.edges.push({ id: 'c', source: 'cmd2', output: 'next', target: 'text' });
  assert.ok(validate(p).errors.some(e => e.code === 'TRIGGER'));
  p.nodes.push({ id: 'buttons', type: 'buttons', x: 400, y: 0, data: { text: 'Выбор', columns: 5, buttons: [] } });
  assert.match(checkShape(p), /клавиатуры/);
});
test('subscription configuration requires a channel identifier', () => {
  const p = project(); p.behavior.subscriptionChat = 'https://example.com';
  assert.match(checkShape(p), /Канал/);
  p.behavior.subscriptionChat = '@example_channel'; assert.equal(checkShape(p), null);
});
