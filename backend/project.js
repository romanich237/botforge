const types = ['start', 'command', 'text', 'buttons', 'input', 'condition', 'end'];
function defaults() {
  return { version: 1, name: '', description: '', platform: 'telegram', nodes: [], edges: [], variables: [], behavior: { unknownCommand: true, unknownText: true, help: true, cancel: true, disableOldButtons: true, repeatQuestion: true, preventDoubleClick: true, ignoreCase: false, history: 'keep', deleteUser: false, typing: false, inputTimeout: false, timeoutSeconds: 60, timeoutText: 'Время ожидания истекло.', rateLimit: false, rateCount: 5, rateSeconds: 10, subscriptionChat: '', subscriptionMessage: 'Подпишитесь на канал и повторите попытку.', unknownCommandText: 'Неизвестная команда. Введите /help', unknownTextMessage: 'Не понимаю. Введите /help' } };
}
function checkShape(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'Ожидается объект проекта';
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) return 'Название: от 1 до 80 символов';
  if (p.version !== 1 || p.platform !== 'telegram') return 'Поддерживается формат 1 и платформа Telegram';
  if (!Array.isArray(p.nodes) || !Array.isArray(p.edges) || !Array.isArray(p.variables) || p.nodes.length > 500 || p.edges.length > 2000 || p.variables.length > 200) return 'Некорректные списки или превышен лимит элементов';
  if (!p.behavior || typeof p.behavior !== 'object' || Array.isArray(p.behavior)) return 'Некорректные настройки поведения';
  for (const [key, value] of Object.entries(defaults().behavior)) if (p.behavior[key] !== undefined && typeof p.behavior[key] !== typeof value) return 'Некорректная настройка поведения: ' + key;
  if (p.behavior.history !== undefined && !['keep', 'delete', 'update'].includes(p.behavior.history)) return 'Некорректный режим истории';
  if (p.behavior.subscriptionChat && !/^@[A-Za-z0-9_]{5,32}$|^-100[0-9]{5,20}$/.test(p.behavior.subscriptionChat)) return 'Канал для проверки подписки: @username или числовой ID -100...';
  if (p.behavior.subscriptionMessage?.length > 1000) return 'Сообщение о подписке слишком длинное';
  const ids = new Set();
  for (const n of p.nodes) {
    if (!n || typeof n.id !== 'string' || !n.id || ids.has(n.id) || !types.includes(n.type) || !n.data || typeof n.data !== 'object' || Array.isArray(n.data) || !Number.isFinite(n.x) || !Number.isFinite(n.y)) return 'Некорректный блок или повтор ID';
    if (n.type === 'buttons' && (!Array.isArray(n.data.buttons) || n.data.buttons.some(b => !b || typeof b.id !== 'string' || typeof b.label !== 'string' || !['url', 'transition'].includes(b.action)) || new Set(n.data.buttons.map(b => b.id)).size !== n.data.buttons.length)) return 'Некорректный список кнопок';
    if (n.data.note?.length > 2000) return 'Заметка не должна превышать 2000 символов';
    if (n.type === 'command' && n.data.triggerText?.length > 200) return 'Триггер слишком длинный';
    if (n.type === 'input' && n.data.choices !== undefined && typeof n.data.choices !== 'string') return 'Некорректные варианты ввода';
    for (const key of ['text', 'command', 'description', 'error', 'variable', 'value', 'operation', 'validation', 'placement', 'note', 'triggerText', 'triggerMode']) if (n.data[key] !== undefined && typeof n.data[key] !== 'string') return 'Некорректное поле блока: ' + key;
    ids.add(n.id);
  }
  const outputs = new Set(); const edgeIds = new Set();
  for (const e of p.edges) {
    if (!e || typeof e.id !== 'string' || edgeIds.has(e.id) || !ids.has(e.source) || !ids.has(e.target) || typeof e.output !== 'string' || outputs.has(e.source + ':' + e.output)) return 'Некорректная связь или несколько переходов с одного выхода';
    const source = p.nodes.find(n => n.id === e.source);
    const allowed = source.type === 'end' ? [] : source.type === 'condition' ? ['yes', 'no'] : source.type === 'buttons' ? source.data.buttons.filter(b => b.action === 'transition').map(b => b.id) : ['next'];
    if (!allowed.includes(e.output)) return 'Несуществующий выход блока';
    outputs.add(e.source + ':' + e.output); edgeIds.add(e.id);
  }
  for (const v of p.variables) if (!v || typeof v.name !== 'string' || !['text', 'number'].includes(v.type) || (v.type === 'number' ? !Number.isFinite(v.initial) : typeof v.initial !== 'string')) return 'Некорректная переменная';
  return null;
}
function validate(p) {
  const errors = [], warnings = [];
  const add = (code, message, nodeId, field) => errors.push({ code, message, nodeId, field });
  if (p.behavior.inputTimeout && (!Number.isFinite(p.behavior.timeoutSeconds) || p.behavior.timeoutSeconds <= 0)) add('TIMEOUT', 'Время ожидания должно быть положительным числом');
  if (p.behavior.rateLimit && (!Number.isInteger(p.behavior.rateCount) || p.behavior.rateCount <= 0 || !Number.isInteger(p.behavior.rateSeconds) || p.behavior.rateSeconds <= 0)) add('RATE_LIMIT', 'Лимит и интервал должны быть положительными целыми числами');
  const starts = p.nodes.filter(n => n.type === 'start');
  if (starts.length !== 1) add('START', 'Нужен ровно один блок «Старт»');
  const variables = new Set();
  for (const v of p.variables) {
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(v.name) || variables.has(v.name)) add('VARIABLE', 'Неверное или повторяющееся имя переменной: ' + v.name);
    variables.add(v.name);
  }
  const commands = new Set();
  for (const n of p.nodes) {
    const d = n.data;
    const required = n.type === 'command' ? ['command'] : ['text', 'buttons', 'input'].includes(n.type) ? ['text'] : [];
    for (const field of required) if (typeof d[field] !== 'string' || !d[field].trim()) add('REQUIRED', 'Заполните поле ' + field, n.id, field);
    if (n.type === 'command' && typeof d.command === 'string') {
      const command = p.behavior.ignoreCase ? d.command.toLowerCase() : d.command;
      if (!/^\/[a-zA-Z0-9_]{1,32}$/.test(command) || ['/start', '/help', '/cancel'].includes(command.toLowerCase()) || commands.has(command)) add('COMMAND', 'Неверная, системная или повторяющаяся команда', n.id, 'command');
      commands.add(command);
      if (d.triggerText?.trim() && !['exact', 'contains'].includes(d.triggerMode || 'exact')) add('TRIGGER', 'Выберите режим текстового триггера', n.id, 'triggerMode');
    }
    if (n.type === 'input' || n.type === 'condition') if (!variables.has(d.variable)) add('VARIABLE', 'Выберите существующую переменную', n.id, 'variable');
    if (n.type === 'input' && !['text', 'number', 'email', 'choice'].includes(d.validation)) add('INPUT', 'Выберите проверку ввода', n.id, 'validation');
    if (n.type === 'input' && d.validation === 'choice' && !d.choices?.trim()) add('INPUT', 'Укажите варианты', n.id, 'choices');
    if (n.type === 'condition') {
      if (!['eq', 'ne', 'contains', 'gt', 'lt'].includes(d.operation) || typeof d.value !== 'string' || !d.value.trim()) add('CONDITION', 'Заполните условие', n.id, 'value');
      if (['gt', 'lt'].includes(d.operation) && (p.variables.find(v => v.name === d.variable)?.type !== 'number' || !Number.isFinite(Number(d.value)))) add('CONDITION', 'Числовое сравнение требует число и числовую переменную', n.id, 'value');
    }
    if (n.type === 'buttons') {
      if (d.placement && !['inline', 'keyboard'].includes(d.placement)) add('BUTTONS', 'Неверное расположение кнопок', n.id, 'placement');
      if (!Array.isArray(d.buttons) || !d.buttons.length) add('BUTTONS', 'Добавьте кнопки', n.id, 'buttons');
      else { if (d.placement === 'keyboard' && new Set(d.buttons.map(b => b.label)).size !== d.buttons.length) add('BUTTON', 'Подписи кнопок клавиатуры должны отличаться', n.id, 'buttons');
      for (const b of d.buttons) {
        if (!b || typeof b.id !== 'string' || typeof b.label !== 'string' || !b.label.trim()) { add('BUTTON', 'Заполните кнопку', n.id, 'buttons'); continue; }
        if (b.label.length > 128) add('BUTTON', 'Подпись кнопки: максимум 128 символов', n.id, 'buttons');
        if (b.action === 'url') { try { if (d.placement === 'keyboard' || !['http:', 'https:'].includes(new URL(b.url).protocol)) throw Error(); } catch { add('URL', 'Ссылка должна быть HTTP(S) и находиться под сообщением', n.id, 'buttons'); } }
        else if (b.action !== 'transition') add('BUTTON', 'Неизвестное действие кнопки', n.id, 'buttons');
      }}
    }
    for (const value of [d.text, d.error]) if (typeof value === 'string') for (const match of value.matchAll(/\{([^{}]+)\}/g)) if (!variables.has(match[1])) add('VARIABLE', 'Неизвестная переменная: ' + match[1], n.id, 'text');
    const outputs = n.type === 'condition' ? ['yes', 'no'] : n.type === 'buttons' ? (Array.isArray(d.buttons) ? d.buttons.filter(b => b?.action === 'transition').map(b => b.id) : []) : ['start', 'command', 'input'].includes(n.type) ? ['next'] : [];
    for (const output of outputs) if (!p.edges.some(e => e.source === n.id && e.output === output)) add('TRANSITION', 'Настройте переход: ' + output, n.id, 'transition');
  }
  const triggers = new Set();
  for (const n of p.nodes.filter(n => n.type === 'command' && n.data.triggerText?.trim())) {
    const key = (p.behavior.ignoreCase ? n.data.triggerText.toLowerCase() : n.data.triggerText).trim() + ':' + (n.data.triggerMode || 'exact');
    if (triggers.has(key)) add('TRIGGER', 'Повторяющийся текстовый триггер', n.id, 'triggerText');
    triggers.add(key);
  }
  const seen = new Set(); const todo = p.nodes.filter(n => ['start', 'command'].includes(n.type)).map(n => n.id);
  while (todo.length) { const id = todo.pop(); if (seen.has(id)) continue; seen.add(id); todo.push(...p.edges.filter(e => e.source === id).map(e => e.target)); }
  for (const n of p.nodes) if (!seen.has(n.id)) warnings.push({ code: 'UNREACHABLE', message: 'Блок недостижим', nodeId: n.id });
  return { valid: errors.length === 0, errors, warnings };
}
module.exports = { defaults, checkShape, validate };
