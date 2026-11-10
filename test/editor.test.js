const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { moveButton, reconnect, searchNodes } = require('../public/editor');
const { defaults, checkShape } = require('../project');
const { example } = require('../public/guide');
const { Session } = require('../public/runtime');

function project() { return { ...defaults(), ...example(randomUUID) }; }

test('button reordering keeps IDs and transitions; preview executes the reordered choice', () => {
  const p = project(), node = p.nodes.find(n => n.type === 'buttons');
  const first = node.data.buttons[0], second = node.data.buttons[1];
  const edges = structuredClone(p.edges);
  assert.equal(moveButton(node, first.id, -1), false);
  assert.equal(moveButton(node, first.id, 1), true);
  assert.deepEqual(node.data.buttons.map(b => b.id), [second.id, first.id]);
  assert.deepEqual(p.edges, edges);
  assert.equal(checkShape(p), null);
  const session = new Session(p, 'deadbeef');
  const menu = session.handle({ text: '/start' }).find(e => e.buttons?.length);
  const target = p.edges.find(e => e.source === node.id && e.output === second.id).target;
  const events = session.handle({ callback: menu.buttons[0].callback });
  assert(events.some(e => e.text === p.nodes.find(n => n.id === target).data.text));
});

test('reconnecting either end preserves edge identity; occupied and missing outputs cannot destroy links', () => {
  const p = project(), start = p.nodes.find(n => n.type === 'start');
  const texts = p.nodes.filter(n => n.type === 'text');
  const edge = p.edges.find(e => e.source === start.id), id = edge.id;
  assert(reconnect(p, id, { source: start.id, sourceHandle: 'next', target: texts[0].id }));
  assert.equal(edge.id, id); assert.equal(edge.target, texts[0].id);
  assert(reconnect(p, id, { source: texts[1].id, sourceHandle: 'next', target: texts[0].id }));
  assert.equal(edge.source, texts[1].id);
  const before = structuredClone(p.edges);
  const occupied = p.edges.find(e => e.id !== id);
  assert.equal(reconnect(p, id, { source: occupied.source, sourceHandle: occupied.output, target: texts[0].id }), false);
  assert.equal(reconnect(p, id, { source: start.id, sourceHandle: 'absent', target: texts[0].id }), false);
  assert.equal(reconnect(p, id, { source: start.id, sourceHandle: 'next', target: 'missing' }), false);
  assert.deepEqual(p.edges, before);
  assert.equal(checkShape(p), null);
});

test('block search matches type, command, text, labels and ID without modifying the project', () => {
  const p = project(), names = { start: 'Старт', buttons: 'Кнопки', text: 'Текст', command: 'Команда' };
  p.nodes.push({ id: 'unique-command', type: 'command', x: 0, y: 0, data: { command: '/catalog', description: 'Каталог' } });
  const before = structuredClone(p);
  assert.equal(searchNodes(p, ' /CATALOG ', names)[0].id, 'unique-command');
  assert.equal(searchNodes(p, 'unique-command', names)[0].id, 'unique-command');
  assert(searchNodes(p, 'кнопки', names).some(n => n.type === 'buttons'));
  const text = p.nodes.find(n => n.type === 'text');
  assert(searchNodes(p, text.data.text, names).some(n => n.id === text.id));
  const menu = p.nodes.find(n => n.type === 'buttons');
  assert(searchNodes(p, menu.data.buttons[0].label, names).some(n => n.id === menu.id));
  assert.deepEqual(searchNodes(p, 'no-such-block', names), []);
  assert.deepEqual(searchNodes(p, ' ', names), []);
  assert.deepEqual(p, before);
});
