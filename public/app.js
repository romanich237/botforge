const main = document.querySelector('#main');
const dialog = document.querySelector('#create-dialog');
const storageKey = 'botforge.projects.v1';
const titles = { projects: 'Мои проекты', builder: 'Конструктор', behavior: 'Поведение бота', variables: 'Переменные', testing: 'Тестирование', export: 'Экспорт кода', settings: 'Настройки', guide: 'Как пользоваться' };
const blockNames = { start: 'Старт', command: 'Команда', text: 'Текст', buttons: 'Кнопки', input: 'Ввод данных', condition: 'Условие', end: 'Завершение' };
let disposeCanvas = null, canvasViewport = null, editorTab = 'canvas';
const guideDialog = document.querySelector('#guide-dialog');
let guideStep = 0;
let projects = [], selectedId = sessionStorage.getItem('botforge.selected'), draft = null, dirty = false, busy = false, selectedNode = null, loadError = '', loading = true;
function element(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function button(text, action, cls = '') { const b = element('button', cls, text); b.type = 'button'; b.onclick = () => Promise.resolve().then(action).catch(e => notify(e.message)); return b; }
function notify(message) { const t = document.querySelector('#toast'); t.textContent = message; t.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { t.hidden = true; }, 6000); }
async function api(url, method = 'GET', body) { const r = await fetch('/api/projects' + url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const data = await r.json(); if (!r.ok) throw Error(data.message || 'Ошибка запроса'); return data; }
function status(text) { document.querySelector('.local-badge').textContent = text; }
function changed() { dirty = true; status('Есть изменения'); refreshChecklist(); }
function leave() { if (busy) { notify('Дождитесь завершения сохранения'); return false; } return !dirty || confirm('Есть несохранённые изменения. Покинуть проект?'); }
async function reload() { loading = true; loadError = ''; render(); try { projects = await api(''); } catch (e) { loadError = e.message; } loading = false; render(); }
async function openProject(id) { if (!leave()) return; const project = await api('/' + id); draft = project; editorTab = 'canvas'; canvasViewport = null; selectedId = id; selectedNode = null; dirty = false; sessionStorage.setItem('botforge.selected', id); location.hash = 'builder'; render(); }
async function saveProject() {
  if (busy || !draft) return;
  busy = true; status('Сохраняется…');
  const snapshot = JSON.stringify(draft);
  try { const saved = await api('/' + draft.id, 'PUT', draft); projects = projects.map(p => p.id === saved.id ? saved : p); if (JSON.stringify(draft) === snapshot) { draft = saved; dirty = false; render(); } else { draft.revision = saved.revision; } status(dirty ? 'Есть изменения' : 'Сохранено'); }
  catch (e) { status('Ошибка сохранения'); notify(e.message + ' Изменения остаются на экране. Нажмите «Сохранить» для повтора.'); }
  finally { busy = false; refreshChecklist(); }
}
function field(parent, label, value, onChange, options) {
  const wrap = element('label', 'field'); wrap.append(element('span', '', label));
  const input = options ? element('select') : element(label.includes('сообщения') || label.includes('ошибки') ? 'textarea' : 'input');
  if (options) for (const [id, text] of options) { const o = element('option', '', text); o.value = id; input.append(o); }
  input.value = value ?? ''; input.oninput = () => { onChange(input.value); changed(); disposeCanvas?.refresh?.(); }; wrap.append(input); parent.append(wrap); return input;
}
function heading(title, description) { const h = element('div', 'page-heading'); const t = element('div'); t.append(element('h1', '', title), element('p', '', description)); h.append(t); main.append(h); return h; }
function renderProjects() {
  const h = heading('Мои проекты', 'От первой идеи до своего Telegram-бота.');
  h.append(button('+ Создать бота', () => { document.querySelector('#create-form').reset(); dialog.showModal(); }, 'primary'));
  if (loading) return main.append(element('section', 'empty', 'Загружаем проекты…'));
  if (loadError) { const p = element('section', 'empty'); p.append(element('p', '', loadError), button('Повторить загрузку', reload)); return main.append(p); }
  const toolbar = element('div', 'toolbar'); const search = element('input'); search.type = 'search'; search.placeholder = 'Поиск по проектам…'; search.setAttribute('aria-label', 'Поиск по проектам'); toolbar.append(search, element('span', 'platform-tag', '↗ Telegram'), element('span', 'muted', projects.length + ' проектов')); main.append(toolbar);
  if (!sessionStorage.getItem('botforge.welcome.hidden')) { const welcome = element('section', 'welcome-banner'); const content = element('div'); content.append(element('span', 'eyebrow', 'НАЧНИТЕ ЗА 5 МИНУТ'), element('h2', '', 'Ваш первый бот начинается здесь'), element('p', '', 'Добавьте сообщение, соедините блоки и сохраните сценарий. Мы покажем каждый шаг.')); const actions = element('div', 'welcome-actions'); actions.append(button('Пройти обучение', openGuide, 'primary'), button('Открыть учебный пример', createExample), button('Скрыть', () => { sessionStorage.setItem('botforge.welcome.hidden', 'true'); render(); }, 'text-button')); welcome.append(content, actions); main.append(welcome); }
  const grid = element('div', 'project-grid'); main.append(grid);
  function update() {
    grid.replaceChildren();
    for (const project of projects.filter(p => p.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))) {
      const card = element('article', 'project-card'); const top = element('div', 'card-top'); const title = element('div'); title.append(element('h2', '', project.name), element('span', 'platform-tag', '↗ Telegram')); top.append(element('div', 'project-icon', '▣'), title);
      card.append(top, element('p', 'muted', project.nodes.length + ' блоков · ' + new Date(project.updatedAt).toLocaleString('ru-RU')));
      const actions = element('div', 'card-actions'); actions.append(button('Открыть →', () => openProject(project.id), 'open'), button('Копия', async () => { await api('/' + project.id + '/duplicate', 'POST', {}); await reload(); }));
      const remove = button('×', async () => { if (confirm('Удалить проект «' + project.name + '»?')) { await api('/' + project.id, 'DELETE'); if (selectedId === project.id) { draft = null; selectedId = null; dirty = false; sessionStorage.removeItem('botforge.selected'); } await reload(); } }, 'icon-button'); remove.setAttribute('aria-label', 'Удалить ' + project.name); actions.append(remove); card.append(actions); grid.append(card);
    }
    if (!grid.children.length) grid.append(element('section', 'empty', projects.length ? 'Ничего не найдено. Измените запрос.' : 'Создайте первого бота — начните с пустого проекта.'));
  }
  search.oninput = update; update();
  if (localStorage.getItem(storageKey)) main.append(button('Перенести старые проекты из браузера', async () => {
    const old = JSON.parse(localStorage.getItem(storageKey)); if (!Array.isArray(old)) throw Error('Некорректные локальные данные');
    while (old.length) { await api('', 'POST', { name: old[0].name }); old.shift(); localStorage.setItem(storageKey, JSON.stringify(old)); }
    if (!old.length) localStorage.removeItem(storageKey); await reload(); notify('Проекты перенесены');
  }));
}
const blockTips = {
  start: 'Начало диалога по команде /start. Соедините с первым сообщением.',
  command: 'Запускает ветку по команде, например /catalog. /start, /help и /cancel зарезервированы.',
  text: 'Сообщение бота. Используйте {имя}, чтобы подставить значение переменной.',
  buttons: 'Сообщение с вариантами ответа. Каждая кнопка ведёт к своему блоку или открывает ссылку.',
  input: 'Вопрос пользователю. Ответ сохраняется в выбранную переменную после проверки.',
  condition: 'Проверяет переменную и направляет диалог в ветку «Да» или «Нет».',
  end: 'Завершает текущую ветку. Переход к следующему блоку не нужен.'
};
async function createExample() {
  if (!leave()) return;
  const p = await api('', 'POST', window.BotForgeGuide.example(() => crypto.randomUUID()));
  projects.unshift(p); dirty = false; guideDialog.close(); await openProject(p.id); notify('Учебный проект создан отдельно. Выберите блок и попробуйте изменить текст.');
}
function refreshChecklist() {
  const panel = document.querySelector('#quick-start'); if (!panel || !draft) return;
  panel.replaceChildren(); panel.append(element('strong', '', 'Первые шаги'));
  for (const step of window.BotForgeGuide.checklist(draft, dirty)) panel.append(element('span', step.done ? 'step-done' : '', (step.done ? '✓ ' : '○ ') + step.label));
  panel.append(button('? Обучение', openGuide, 'text-button'));
}
function openGuide() { guideStep = 0; renderGuideStep(); if (!guideDialog.open) guideDialog.showModal(); }
function renderGuideStep() {
  guideDialog.replaceChildren(); const steps = window.BotForgeGuide.steps, step = steps[guideStep];
  const header = element('div', 'dialog-heading'); const close = button('×', () => guideDialog.close(), 'icon-button'); close.setAttribute('aria-label', 'Закрыть обучение'); header.append(element('span', 'eyebrow', 'ЗНАКОМСТВО С BOTFORGE'), close);
  const dots = element('div', 'guide-dots'); steps.forEach((_, i) => { dots.append(element('span', i <= guideStep ? 'filled' : '')); });
  const content = element('div', 'guide-content'); content.setAttribute('aria-live', 'polite'); const title = element('h2', '', step.title); title.id = 'guide-title'; content.append(element('div', 'guide-number', String(guideStep + 1).padStart(2, '0')), title, element('p', '', step.text));
  const actions = element('div', 'dialog-actions'); const back = button('Назад', () => { guideStep--; renderGuideStep(); }); back.disabled = guideStep === 0;
  actions.append(back, button(guideStep === steps.length - 1 ? 'Готово, начнём' : 'Далее →', () => { if (guideStep === steps.length - 1) guideDialog.close(); else { guideStep++; renderGuideStep(); } }, 'primary'));
  guideDialog.append(header, dots, content, element('p', 'muted', 'Шаг ' + (guideStep + 1) + ' из ' + steps.length), actions);
  if (guideDialog.open) actions.lastChild.focus();
}
function renderGuide() {
  const h = heading('Как пользоваться BotForge', 'Короткий путь от пустого проекта до связанного сценария.'); h.append(button('Пошаговое обучение', openGuide, 'primary'));
  const intro = element('section', 'guide-intro'); intro.append(element('div', 'welcome-icon', '↗'), element('h2', '', 'Попробуйте на готовом примере'), element('p', '', 'Четыре блока, две кнопки и готовые связи. Пример создаётся отдельным проектом — ваши сценарии сохранятся.'), button('Создать учебный проект', createExample, 'primary')); main.append(intro);
  const list = element('div', 'guide-grid'); window.BotForgeGuide.steps.forEach((step, i) => { const card = element('article', 'guide-card'); card.append(element('span', 'guide-index', String(i + 1).padStart(2, '0')), element('h2', '', step.title), element('p', '', step.text)); list.append(card); }); main.append(list);
  const faq = element('section', 'faq'); faq.append(element('h2', '', 'Частые вопросы'));
  for (const [q, a] of [
    ['Как соединить блоки на телефоне?', 'Откройте вкладку «Схема», выберите блок и перейдите к его свойствам. В поле «Переход» выберите целевой блок. Для каждой кнопки доступен отдельный переход.'],
    ['Как переместить или удалить связь?', 'Перетаскивайте блок за заголовок. Чтобы заменить переход, соедините тот же выход с другим блоком. Чтобы удалить связь, откройте список «Связи» в свойствах и нажмите × рядом с нужной парой.'],
    ['Когда сохраняются изменения?', 'Сохранение ручное: нажмите «Сохранить» и дождитесь статуса «Сохранено». Если произошла ошибка, изменения остаются на экране — повторите сохранение.'],
    ['Что уже работает, а что появится позже?', 'Работают проекты, схема, свойства блоков, переменные и серверная проверка. Настройки поведения сохраняются. Интерактивный чат, генерация Python/JavaScript и ZIP пока в разработке.'],
    ['Зачем нужны переменные?', 'Они хранят данные пользователя. Создайте переменную, например имя, в разделе «Переменные», выберите её в блоке ввода и используйте {имя} в сообщении.']
  ]) { const item = element('details'); item.append(element('summary', '', q), element('p', '', a)); faq.append(item); } main.append(faq);
}
function outputs(node) { if (node.type === 'end') return []; if (node.type === 'condition') return [['yes', 'Да'], ['no', 'Нет']]; if (node.type === 'buttons') return (node.data.buttons || []).filter(b => b.action === 'transition').map(b => [b.id, b.label]); return [['next', 'Далее']]; }
function addNode(type) {
  const id = crypto.randomUUID(); draft.nodes.push({ id, type, x: draft.nodes.length % 3 * 320, y: Math.floor(draft.nodes.length / 3) * 240, data: { text: '', command: '', variable: '', validation: 'text', error: 'Проверьте введённое значение', operation: 'eq', value: '', placement: 'inline', buttons: [] } }); selectedNode = id; editorTab = 'properties'; changed(); render();
}
function connectBlocks(source, output, target) {
  if (!draft.nodes.some(n => n.id === target) || !draft.nodes.some(n => n.id === source && outputs(n).some(o => o[0] === output))) return;
  draft.edges = draft.edges.filter(e => !(e.source === source && e.output === output));
  draft.edges.push({ id: crypto.randomUUID(), source, output, target });
  changed(); render();
}
function renderBuilder() {
  const h = heading('Сценарий бота', 'Telegram · Добавьте блоки, соедините и сохраните');
  const actions = element('div', 'editor-actions'); actions.append(button('✓ Проверить', validateProject), button('Сохранить', saveProject, 'primary')); h.append(actions);
  const mobileTabs = element('div', 'editor-tabs'); mobileTabs.setAttribute('role', 'group'); mobileTabs.setAttribute('aria-label', 'Панели конструктора');
  for (const [id, text] of [['blocks', '+ Блоки'], ['canvas', '⌘ Схема'], ['properties', '⚙ Свойства']]) { const b = button(text, () => { editorTab = id; render(); }, editorTab === id ? 'active' : ''); b.setAttribute('aria-pressed', String(editorTab === id)); mobileTabs.append(b); }
  main.append(mobileTabs);
  const builder = element('section', 'builder editor-shell tab-' + editorTab);
  const library = element('aside', 'library'); library.append(element('div', 'panel-eyebrow', 'ИНСТРУМЕНТЫ'), element('h2', '', 'Блоки сценария'), element('p', 'muted', 'Нажмите, чтобы добавить'));
  const icons = { start: '▶', command: '/', text: 'T', buttons: '▦', input: '↵', condition: '◇', end: '■' };
  for (const [type, name] of Object.entries(blockNames)) { const b = button('', () => addNode(type), 'library-block'); b.append(element('span', 'block-symbol symbol-' + type, icons[type]), element('span', '', name), element('span', 'add-symbol', '+')); b.disabled = type === 'start' && draft.nodes.some(n => n.type === 'start'); b.title = blockTips[type]; b.setAttribute('aria-label', 'Добавить блок «' + name + '»'); library.append(b); }
  const hint = element('div', 'library-hint'); hint.append(element('strong', '', 'Соединяйте идеи'), element('p', '', 'Потяните от точки справа к входу другого блока. Каждая кнопка — отдельная ветка.')); library.append(hint);
  const center = element('div', 'editor-center'); const toolbar = element('div', 'canvas-bar'); toolbar.append(element('span', '', '◉ Сценарий'), element('span', 'muted', draft.nodes.length + ' блоков · ' + draft.edges.length + ' связей')); center.append(toolbar);
  const canvas = element('div', 'flow-canvas'); canvas.setAttribute('aria-label', 'Схема сценария'); center.append(canvas);
  if (!draft.nodes.length) { const empty = element('div', 'canvas-welcome'); empty.append(element('div', 'welcome-icon', '⌘'), element('h2', '', 'Соберите свой первый сценарий'), element('p', '', 'Начните со старта — это вход в диалог по команде /start.'), button('+ Добавить старт', () => addNode('start'), 'primary'), button('Посмотреть обучение', openGuide, 'text-button')); center.append(empty); }
  const footer = element('div', 'canvas-footer'); footer.append(element('span', '', 'Перетаскивайте блоки · Прокрутка — перемещение · ⌘ / Ctrl + прокрутка — масштаб')); center.append(footer);
  builder.append(library, center);
  const inspector = element('aside', 'inspector'); inspector.append(element('div', 'panel-eyebrow', 'ИНСПЕКТОР'));
  const picker = element('label', 'field block-picker'); picker.append(element('span', '', 'Выберите блок')); const select = element('select'); const placeholder = element('option', '', 'Выберите блок на схеме или в списке'); placeholder.value = ''; select.append(placeholder);
  for (const n of draft.nodes) { const option = element('option', '', blockNames[n.type] + ' · ' + (n.data.text || n.data.command || n.id.slice(0, 6)).slice(0, 40)); option.value = n.id; select.append(option); }
  select.value = selectedNode || ''; select.onchange = () => { selectedNode = select.value || null; render(); }; picker.append(select); inspector.append(picker);
  const node = draft.nodes.find(n => n.id === selectedNode);
  if (node) renderProperties(node, inspector);
  else { inspector.append(element('h2', '', 'Свойства блока'), element('div', 'inspector-empty', '↖'), element('h3', '', 'Выберите блок на схеме'), element('p', 'muted', 'Здесь появятся текст сообщения, кнопки и настройки переходов.'), element('div', 'inspector-tip', 'Совет: линии можно выделить и удалить кнопкой ниже.')); }
  const connections = element('details', 'connections-list'); connections.append(element('summary', '', 'Связи · ' + draft.edges.length));
  for (const edge of draft.edges) { const source = draft.nodes.find(n => n.id === edge.source), target = draft.nodes.find(n => n.id === edge.target); if (!source || !target) continue; const row = element('div', 'connection-row'); row.append(element('span', '', blockNames[source.type] + ' → ' + blockNames[target.type]), button('×', () => { draft.edges = draft.edges.filter(e => e.id !== edge.id); changed(); render(); }, 'remove-edge')); row.lastChild.setAttribute('aria-label', 'Удалить связь ' + blockNames[source.type] + ' → ' + blockNames[target.type]); connections.append(row); }
  inspector.append(connections); builder.append(inspector); main.append(builder);
  const progress = element('section', 'quick-start'); progress.id = 'quick-start'; main.append(progress); refreshChecklist();
  if (window.matchMedia('(max-width: 650px)').matches && editorTab !== 'canvas') return;
  disposeCanvas = window.BotForgeCanvas.mount(canvas, draft, blockNames, outputs, {
    selected: selectedNode,
    select: id => { if (selectedNode !== id) { selectedNode = id; if (id) editorTab = 'properties'; render(); } },
    connect: c => connectBlocks(c.source, c.sourceHandle, c.target),
    move: changes => { for (const c of changes) if (c.type === 'position' && c.position) { const n = draft.nodes.find(n => n.id === c.id); if (n && (n.x !== c.position.x || n.y !== c.position.y)) { n.x = c.position.x; n.y = c.position.y; changed(); } } },
    edges: changes => { const removed = new Set(changes.filter(c => c.type === 'remove').map(c => c.id)); if (removed.size) { draft.edges = draft.edges.filter(e => !removed.has(e.id)); changed(); } },
    viewport: v => { canvasViewport = v; }
  }, canvasViewport);
}
function renderProperties(n, target = main) {
  const panel = element('section', 'properties'); panel.append(element('h2', '', 'Свойства · ' + blockNames[n.type]), element('p', 'property-tip', blockTips[n.type])); const d = n.data;
  if (['text', 'buttons', 'input'].includes(n.type)) field(panel, 'Текст сообщения', d.text, v => { d.text = v; });
  if (n.type === 'command') { field(panel, 'Команда', d.command, v => { d.command = v; }); field(panel, 'Описание для /help', d.description, v => { d.description = v; }); }
  if (['input', 'condition'].includes(n.type)) field(panel, 'Переменная', d.variable, v => { d.variable = v; }, [['', 'Выберите переменную'], ...draft.variables.map(v => [v.name, v.name])]);
  if (n.type === 'input') { field(panel, 'Проверка ввода', d.validation, v => { d.validation = v; }, [['text', 'Текст'], ['number', 'Число'], ['email', 'Email'], ['choice', 'Вариант из списка']]); field(panel, 'Варианты через запятую', d.choices, v => { d.choices = v; }); field(panel, 'Текст ошибки', d.error, v => { d.error = v; }); }
  if (n.type === 'condition') { field(panel, 'Операция', d.operation, v => { d.operation = v; }, [['eq', 'Равно'], ['ne', 'Не равно'], ['contains', 'Содержит'], ['gt', 'Больше'], ['lt', 'Меньше']]); field(panel, 'Значение', d.value, v => { d.value = v; }); }
  if (n.type === 'buttons') {
    field(panel, 'Расположение', d.placement, v => { d.placement = v; }, [['inline', 'Под сообщением'], ['keyboard', 'Нижняя клавиатура']]);
    for (const b of d.buttons) {
      const row = element('div', 'button-row'); field(row, 'Подпись', b.label, v => { b.label = v; }); field(row, 'Действие', b.action, v => { b.action = v; draft.edges = draft.edges.filter(e => !(e.source === n.id && e.output === b.id)); changed(); render(); }, [['transition', 'Переход'], ['url', 'Ссылка']]);
      if (b.action === 'url') field(row, 'URL', b.url, v => { b.url = v; }); row.append(button('Удалить кнопку', () => { d.buttons = d.buttons.filter(x => x.id !== b.id); draft.edges = draft.edges.filter(e => !(e.source === n.id && e.output === b.id)); changed(); render(); })); panel.append(row);
    }
    panel.append(button('+ Добавить кнопку', () => { d.buttons.push({ id: crypto.randomUUID(), label: 'Кнопка', action: 'transition' }); changed(); render(); }));
  }
  for (const [output, label] of outputs(n)) field(panel, 'Переход · ' + label, draft.edges.find(e => e.source === n.id && e.output === output)?.target || '', target => { draft.edges = draft.edges.filter(e => !(e.source === n.id && e.output === output)); if (target) draft.edges.push({ id: crypto.randomUUID(), source: n.id, output, target }); }, [['', 'Конец / не настроено'], ...draft.nodes.map(t => [t.id, blockNames[t.type] + ' · ' + (t.data.text || t.data.command || t.id.slice(0, 6)).slice(0, 40)])]);
  const actions = element('div', 'dialog-actions'); actions.append(button('Обновить схему', render), button('Дублировать', () => { const copy = structuredClone(n); copy.id = crypto.randomUUID(); copy.x += 30; copy.y += 30; if (copy.type === 'start') return notify('В проекте разрешён один старт'); if (copy.data.buttons) copy.data.buttons.forEach(b => { b.id = crypto.randomUUID(); }); draft.nodes.push(copy); selectedNode = copy.id; changed(); render(); }), button('Удалить блок', () => { if (!confirm('Удалить блок и его связи?')) return; draft.nodes = draft.nodes.filter(t => t.id !== n.id); draft.edges = draft.edges.filter(e => e.source !== n.id && e.target !== n.id); selectedNode = null; changed(); render(); })); panel.append(actions); target.append(panel);
}
async function validateProject() { const result = await api('/' + draft.id + '/validate', 'POST', draft); document.querySelector('#validation')?.remove(); const panel = element('section', 'properties'); panel.id = 'validation'; panel.setAttribute('role', 'status'); panel.append(element('h2', '', result.valid ? 'Проверка пройдена' : 'Исправьте ошибки: ' + result.errors.length)); for (const issue of [...result.errors, ...result.warnings]) panel.append(button(issue.message, () => { if (issue.nodeId) { selectedNode = issue.nodeId; location.hash = 'builder'; render(); } })); main.append(panel); panel.scrollIntoView({ block: 'nearest' }); }
function renderVariables() {
  heading('Переменные', 'Начальные значения и данные, которые собирает бот.');
  for (const v of draft.variables) {
    const row = element('section', 'properties variable-row'); field(row, 'Имя', v.name, value => { v.name = value; }); field(row, 'Тип', v.type, value => { v.type = value; v.initial = value === 'number' ? 0 : ''; render(); }, [['text', 'Текст'], ['number', 'Число']]); field(row, 'Начальное значение', v.initial, value => { v.initial = v.type === 'number' ? (value.trim() ? Number(value) : null) : value; });
    row.append(button('Удалить', () => { const used = draft.nodes.filter(n => n.data.variable === v.name || JSON.stringify(n.data).includes('{' + v.name + '}')); if (confirm('Удалить переменную?' + (used.length ? ' Используется: ' + used.map(n => blockNames[n.type] + ' ' + n.id.slice(0, 6)).join(', ') : ''))) { draft.variables = draft.variables.filter(x => x !== v); changed(); render(); } })); main.append(row);
  }
  main.append(button('+ Переменная', () => { draft.variables.push({ name: 'переменная_' + (draft.variables.length + 1), type: 'text', initial: '' }); changed(); render(); }));
}
function renderBehavior() {
  heading('Поведение бота', 'Настройки сохраняются в проекте. Исполнение и экспорт ещё в разработке.');
  const panel = element('section', 'properties');
  for (const [key, label] of Object.entries({ unknownCommand: 'Автоответ на неизвестную команду', unknownText: 'Автоответ на непонятный текст', help: 'Автоматический /help', cancel: '/cancel возвращает к стартовому сценарию', disableOldButtons: 'Отключать старые кнопки', repeatQuestion: 'Повторять вопрос при неверном вводе', preventDoubleClick: 'Защита от повторных нажатий', ignoreCase: 'Игнорировать регистр команд' })) {
    const wrap = element('label', 'check-row'); const input = element('input'); input.type = 'checkbox'; input.checked = draft.behavior[key] === true; input.onchange = () => { draft.behavior[key] = input.checked; changed(); }; wrap.append(input, document.createTextNode(label)); panel.append(wrap);
  }
  field(panel, 'Ответ на неизвестную команду', draft.behavior.unknownCommandText, v => { draft.behavior.unknownCommandText = v; }); field(panel, 'Ответ на непонятный текст', draft.behavior.unknownTextMessage, v => { draft.behavior.unknownTextMessage = v; }); main.append(panel);
}
function render() {
  const page = Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : 'projects'; if (disposeCanvas) { disposeCanvas(); disposeCanvas = null; } main.classList.toggle('editor-page', page === 'builder' && !!draft); main.replaceChildren(); document.title = 'BotForge · ' + titles[page]; document.querySelector('#breadcrumb').textContent = draft && page !== 'projects' ? draft.name : 'Рабочее пространство';
  document.querySelectorAll('[data-page]').forEach(a => { a.classList.toggle('active', a.dataset.page === page); if (a.dataset.page === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  status(dirty ? 'Есть изменения' : 'Серверное хранение');
  if (page === 'projects') return renderProjects();
  if (page === 'guide') return renderGuide();
  if (!draft) { heading(titles[page], 'Откройте проект, чтобы продолжить.'); main.append(button('К проектам', () => { location.hash = 'projects'; })); return; }
  if (page === 'builder') return renderBuilder();
  if (page === 'variables') renderVariables();
  else if (page === 'behavior') renderBehavior();
  else if (page === 'settings') { heading('Настройки проекта', 'Название и описание'); const panel = element('section', 'properties'); field(panel, 'Название', draft.name, v => { draft.name = v; }); field(panel, 'Описание', draft.description, v => { draft.description = v; }); main.append(panel); }
  else { heading(titles[page], page === 'export' ? 'Серверная проверка доступна. Генерация Python / JavaScript и ZIP пока не реализована.' : 'Интерактивное выполнение сценария пока не реализовано.'); main.append(button('Проверить проект', validateProject)); }
  main.append(button('Сохранить', saveProject, 'primary'));
}
document.querySelector('#open-guide').onclick = openGuide;
document.querySelector('#close-dialog').onclick = document.querySelector('#cancel-dialog').onclick = () => dialog.close();
document.querySelector('#create-form').onsubmit = async event => {
  event.preventDefault(); const name = document.querySelector('#bot-name').value.trim(); if (!name) return;
  const submit = event.submitter; submit.disabled = true;
  try { const p = await api('', 'POST', { name }); projects.unshift(p); dialog.close(); render(); notify('Проект создан на сервере'); } catch (e) { notify(e.message); } finally { submit.disabled = false; }
};
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('hashchange', render);
window.matchMedia('(max-width: 650px)').addEventListener('change', () => { canvasViewport = null; render(); });
(async () => { await reload(); if (selectedId && projects.some(p => p.id === selectedId)) { try { draft = await api('/' + selectedId); render(); } catch (e) { notify(e.message); } } })();
