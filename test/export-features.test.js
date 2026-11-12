const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults } = require('../backend/project');
const { generate } = require('../backend/exporter');
function sample() {
  const p = defaults(); p.name = 'Проверка экспорта'; p.behavior.subscriptionChat = '@example_channel';
  p.nodes = [
    { id: 'start', type: 'start', x: 0, y: 0, data: {} },
    { id: 'buttons', type: 'buttons', x: 150, y: 0, data: { text: 'Выберите', placement: 'keyboard', columns: 2, oneTime: true, buttons: [
      { id: 'yes', label: 'Да', action: 'transition' }, { id: 'no', label: 'Нет', action: 'transition' }
    ] } },
    { id: 'end', type: 'end', x: 300, y: 0, data: {} }
  ];
  p.edges = [
    { id: 'e1', source: 'start', output: 'next', target: 'buttons' },
    { id: 'e2', source: 'buttons', output: 'yes', target: 'end' },
    { id: 'e3', source: 'buttons', output: 'no', target: 'end' }
  ];
  return p;
}
test('all exporters include subscription checks and keyboard layout', async () => {
  for (const language of ['javascript', 'typescript', 'python', 'go']) {
    const result = await generate(sample(), language);
    assert.equal(result.valid, true, language + ': ' + JSON.stringify(result.errors));
    const source = result.files.filter(f => /^(bot\.(js|ts|py)|main\.go)$/.test(f.name)).map(f => f.content).join('\n');
    assert.match(source, /getChatMember/, language);
    assert.match(source, /one_time_keyboard|oneTime/, language);
  }
});
