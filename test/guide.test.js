const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { defaults, checkShape, validate } = require('../project');
const { checklist, example, steps } = require('../public/guide');
test('tutorial example has valid connected branches and independent IDs', () => {
  const project = { ...defaults(), ...example(randomUUID) };
  assert.equal(checkShape(project), null);
  assert.deepEqual(validate(project), { valid: true, errors: [], warnings: [] });
  assert.equal(project.nodes.length, 4);
  assert.equal(project.edges.length, 3);
  assert(checklist(project, false).every(s => s.done));
  assert.equal(checklist(project, true).at(-1).done, false);
  assert(checklist(defaults(), false).every(s => !s.done));
  const second = example(randomUUID);
  assert(!second.nodes.some(n => project.nodes.some(p => p.id === n.id)));
  assert.equal(steps.length, 5);
});
