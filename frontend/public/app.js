const main = document.querySelector('#main');
const dialog = document.querySelector('#create-dialog');
const storageKey = 'botforge.projects.v1';
const titles = { projects: 'Мои проекты', builder: 'Конструктор', behavior: 'Поведение бота', variables: 'Переменные', testing: 'Тестирование', export: 'Экспорт кода', settings: 'Настройки', guide: 'Как пользоваться' };
const blockNames = { start: 'Старт', command: 'Команда', text: 'Текст', buttons: 'Кнопки', input: 'Ввод данных', condition: 'Условие', end: 'Завершение' };
let disposeCanvas = null, canvasViewport = null, editorTab = 'canvas';
const guideDialog = document.querySelector('#guide-dialog');
let guideStep = 0;
let blockSearch = '', focusNode = null, advancedBlocks = false;
let account = null, accountError = '';
let projects = [], selectedId = sessionStorage.getItem('botforge.selected'), draft = null, dirty = false, busy = false, selectedNode = null, loadError = '', loading = true;
function element(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('ui-icon'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '/icons.svg#' + name); svg.append(use); return svg;
}
function platformTag() {
  const tag = element('span', 'platform-tag', 'Telegram');
  tag.prepend(icon('telegram'));
  return tag;
}
function button(text, action, cls = '') { const marks = { '✦':'sparkles', '⤢':'layout-grid', '↶':'undo-2', '▷':'play', '↓':'download', '✓':'check', '↖':'mouse-pointer-2', '＋':'plus', '+':'plus', '?':'circle-help', '×':'x', '↻':'rotate-ccw', '↑':'arrow-up' }; const mark = marks[text[0]]; const b = element('button', cls, mark ? text.slice(1).trim() : text); if (mark) { b.prepend(icon(mark)); b.classList.add('with-icon'); if (!text.slice(1).trim()) b.setAttribute('aria-label', text === '×' ? 'Закрыть' : text === '↻' ? 'Перезапустить' : text); } b.type = 'button'; b.onclick = () => Promise.resolve().then(action).catch(e => notify(e.message)); return b; }
function notify(message) { const t = document.querySelector('#toast'); t.textContent = message; t.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { t.hidden = true; }, 6000); }
async function api(url, method = 'GET', body) { const r = await fetch('/api/projects' + url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const data = await r.json(); if (!r.ok) throw Error(data.message || 'Ошибка запроса'); return data; }
function status(text) { document.querySelector('.local-badge').textContent = text; }
function changed() { window.BotForgeTour?.update(); dirty = true; status('Есть изменения'); refreshChecklist(); if (document.querySelector('#chat-mount')) paintChat(); }
function leave() { if (busy) { notify('Дождитесь завершения сохранения'); return false; } return !dirty || confirm('Есть несохранённые изменения. Покинуть проект?'); }
async function reload() { loading = true; loadError = ''; render(); try { projects = await api(''); } catch (e) { loadError = e.message; } loading = false; render(); }
async function openProject(id) { if (!leave()) return; const project = await api('/' + id); draft = project; blockSearch = ''; focusNode = null; editorTab = 'canvas'; canvasViewport = null; selectedId = id; selectedNode = null; dirty = false; sessionStorage.setItem('botforge.selected', id); location.hash = 'builder'; render(); }
async function saveProject() {
  if (busy || !draft) return false;
  busy = true; status('Сохраняется…');
  const snapshot = JSON.stringify(draft);
  try { const saved = await api('/' + draft.id, 'PUT', draft); projects = projects.map(p => p.id === saved.id ? saved : p); if (JSON.stringify(draft) === snapshot) { draft = saved; dirty = false; render(); } else { draft.revision = saved.revision; } status(dirty ? 'Есть изменения' : 'Сохранено'); return !dirty; }
  catch (e) { status('Ошибка сохранения'); notify(e.message + ' Изменения остаются на экране. Нажмите «Сохранить» для повтора.'); return false; }
  finally { busy = false; refreshChecklist(); }
}
function field(parent, label, value, onChange, options) {
  const wrap = element('label', 'field'); wrap.append(element('span', '', label));
  const input = options ? element('select') : element(label.includes('сообщения') || label.includes('ошибки') ? 'textarea' : 'input');
  if (options) for (const [id, text] of options) { const o = element('option', '', text); o.value = id; input.append(o); }
  input.value = value ?? ''; input.oninput = () => { onChange(input.value); changed(); disposeCanvas?.refresh?.(); }; wrap.append(input); parent.append(wrap); return input;
}
function heading(title, description, target = main) { const h = element('div', 'page-heading'); const t = element('div'); t.append(element('h1', '', title), element('p', '', description)); h.append(t); target.append(h); return h; }
function renderProjects() {
  const h = heading('Проекты', 'Сценарии и исходный код ваших Telegram-ботов.');
  const projectActions = element('div', 'project-heading-actions'); h.append(projectActions);
  projectActions.append(button('✦ Создать с ИИ', async () => { if (!leave()) return; const p = await api('', 'POST', { name: 'Новый бот с ИИ' }); projects.unshift(p); dirty = false; await openProject(p.id); openAssistant(); }, 'ai-trigger'));
  projectActions.append(button('+ Создать бота', () => { document.querySelector('#create-form').reset(); dialog.showModal(); }, 'primary'));
  if (loading) return main.append(element('section', 'empty', 'Загружаем проекты…'));
  if (loadError) { const p = element('section', 'empty'); p.append(element('p', '', loadError), button('Повторить загрузку', reload)); return main.append(p); }
  const toolbar = element('div', 'toolbar'); const search = element('input'); search.type = 'search'; search.placeholder = 'Поиск по проектам…'; search.setAttribute('aria-label', 'Поиск по проектам'); toolbar.append(search, platformTag(), element('span', 'muted', projects.length + ' проектов')); main.append(toolbar);
  if (!sessionStorage.getItem('botforge.welcome.hidden')) { const welcome = element('section', 'welcome-banner'); const content = element('div'); content.append(element('span', 'eyebrow', 'ОБУЧЕНИЕ'), element('h2', '', 'Первый проект в BotForge'), element('p', '', 'Разберитесь с блоками, связями и предпросмотром на учебном примере.')); const actions = element('div', 'welcome-actions'); actions.append(button('Пройти обучение', openGuide, 'primary'), button('Открыть учебный пример', createExample), button('Скрыть', () => { sessionStorage.setItem('botforge.welcome.hidden', 'true'); render(); }, 'text-button')); welcome.append(content, actions); main.append(welcome); }
  const grid = element('div', 'project-grid row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3 d-flex gap-0'); main.append(grid);
  function update() {
    grid.replaceChildren();
    for (const project of projects.filter(p => p.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))) {
      const card = element('article', 'project-card'); const top = element('div', 'card-top'); const title = element('div'); title.append(element('h2', '', project.name), platformTag()); const projectIcon = element('div', 'project-icon'); projectIcon.append(icon('workflow')); top.append(projectIcon, title);
      const thumbnail = element('div', 'project-thumbnail'); thumbnail.setAttribute('aria-hidden', 'true');
      for (const node of project.nodes.slice(0, 3)) { const box = element('span', 'project-mini-node', blockNames[node.type]); thumbnail.append(box); }
      if (!project.nodes.length) thumbnail.append(element('span', 'project-thumbnail-empty', 'Пустой сценарий'));
      card.append(thumbnail, top, element('p', 'muted', project.nodes.length + ' блоков · ' + new Date(project.updatedAt).toLocaleString('ru-RU')));
      const actions = element('div', 'card-actions'); actions.append(button('Открыть', () => openProject(project.id), 'open'), button('Копия', async () => { await api('/' + project.id + '/duplicate', 'POST', {}); await reload(); }));
      const remove = button('×', async () => { if (confirm('Удалить проект «' + project.name + '»?')) { await api('/' + project.id, 'DELETE'); if (selectedId === project.id) { draft = null; selectedId = null; dirty = false; sessionStorage.removeItem('botforge.selected'); } await reload(); } }, 'icon-button'); remove.setAttribute('aria-label', 'Удалить ' + project.name); actions.append(remove); card.append(actions); const column = element('div', 'project-column'); column.append(card); grid.append(column);
    }
    if (!grid.children.length) grid.append(element('section', 'empty w-100', projects.length ? 'Ничего не найдено. Измените запрос.' : 'Создайте первого бота — начните с пустого проекта.'));
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
async function openGuide() { await window.BotForgeTour.start(); }
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
function renderGuide(target = main) {
  const h = heading('Как пользоваться BotForge', 'Короткий путь от пустого проекта до связанного сценария.', target); h.append(button('Пошаговое обучение', openGuide, 'primary'));
  const intro = element('section', 'guide-intro');
  const introIcon = element('div', 'welcome-icon'); introIcon.append(icon('workflow'));
  intro.append(introIcon, element('h2', '', 'Попробуйте на готовом примере'), element('p', '', 'Четыре блока, две кнопки и готовые связи. Пример создаётся отдельным проектом — ваши сценарии сохранятся.'), button('Создать учебный проект', createExample, 'primary')); target.append(intro);
  const list = element('div', 'guide-grid'); window.BotForgeGuide.steps.forEach((step, i) => { const card = element('article', 'guide-card'); card.append(element('span', 'guide-index', String(i + 1).padStart(2, '0')), element('h2', '', step.title), element('p', '', step.text)); list.append(card); }); target.append(list);
  const faq = element('section', 'faq'); faq.append(element('h2', '', 'Частые вопросы'));
  for (const [q, a] of [
    ['Как соединить блоки на телефоне?', 'Откройте вкладку «Схема», выберите блок и перейдите к его свойствам. В поле «Переход» выберите целевой блок. Для каждой кнопки доступен отдельный переход.'],
    ['Как переместить или удалить связь?', 'Потяните конец существующей линии к другому входу или свободному выходу. Отпускание на пустом поле сохраняет старую связь. Переход также можно изменить в свойствах блока. Для удаления откройте список «Связи» и нажмите ×.'],
    ['Когда сохраняются изменения?', 'Сохранение ручное: нажмите «Сохранить» и дождитесь статуса «Сохранено». Если произошла ошибка, изменения остаются на экране — повторите сохранение.'],
    ['Что уже работает, а что появится позже?', 'Работают схема, интерактивный чат и экспорт ZIP на Python, JavaScript, TypeScript и Go. Медиа, хостинг ботов и другие платформы запланированы на следующие этапы.'],
    ['Зачем нужны переменные?', 'Они хранят данные пользователя. Создайте переменную, например имя, в разделе «Переменные», выберите её в блоке ввода и используйте {имя} в сообщении.']
  ]) { const item = element('details'); item.append(element('summary', '', q), element('p', '', a)); faq.append(item); } target.append(faq);
}
function outputs(node) { if (node.type === 'end') return []; if (node.type === 'condition') return [['yes', 'Да'], ['no', 'Нет']]; if (node.type === 'buttons') return (node.data.buttons || []).filter(b => b.action === 'transition').map(b => [b.id, b.label]); return [['next', 'Далее']]; }
function addNode(type, position) {
  if (!Object.hasOwn(blockNames, type) || (type === 'start' && draft.nodes.some(n => n.type === 'start'))) return;
  const id = crypto.randomUUID(); draft.nodes.push({ id, type, x: position?.x ?? draft.nodes.length % 3 * 320, y: position?.y ?? Math.floor(draft.nodes.length / 3) * 240, data: { text: '', command: '', variable: '', validation: 'text', error: 'Проверьте введённое значение', operation: 'eq', value: '', placement: 'inline', buttons: [] } }); selectedNode = id; changed(); openWorkspace('builder', 'properties');
}
function connectBlocks(source, output, target) {
  if (!draft.nodes.some(n => n.id === target) || !draft.nodes.some(n => n.id === source && outputs(n).some(o => o[0] === output))) return;
  draft.edges = draft.edges.filter(e => !(e.source === source && e.output === output));
  draft.edges.push({ id: crypto.randomUUID(), source, output, target });
  changed(); render();
}
function focusBlock(id) {
  if (!draft.nodes.some(n => n.id === id)) return;
  selectedNode = id;
  focusNode = id;
  openWorkspace('builder', 'properties');
}
function renderBlockSearch() {
  const panel = element('section', 'block-search');
  panel.setAttribute('aria-label', 'Поиск блоков');
  const label = element('label', 'field');
  label.append(element('span', '', 'Найти блок'));
  const input = element('input'); input.type = 'search'; input.value = blockSearch;
  input.placeholder = 'Тип, текст, команда или ID…'; label.append(input);
  const results = element('div', 'block-search-results');
  const count = element('p', 'muted'); count.setAttribute('role', 'status');
  function update() {
    blockSearch = input.value; results.replaceChildren();
    const found = window.BotForgeEditor.searchNodes(draft, blockSearch, blockNames);
    count.textContent = blockSearch.trim() ? 'Найдено блоков: ' + found.length : '';
    for (const node of found) {
      const text = (node.data.text || node.data.command || node.id).slice(0, 90);
      results.append(button(blockNames[node.type] + ' · ' + text + ' →', () => focusBlock(node.id), 'block-search-result'));
    }
    results.hidden = !blockSearch.trim();
  }
  input.oninput = update;
  input.onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); results.querySelector('button')?.click(); }
    if (event.key === 'Escape') { input.value = ''; update(); }
  };
  update(); panel.append(label, count, results); main.append(panel);
}
function openWorkspace(page, tab = 'canvas') {
  editorTab = tab;
  if (aiDialog.open) closeAssistant();
  if (location.hash.slice(1) === page) render(); else location.hash = page;
}
function renderWorkspacePanel(page, target) {
  const top = element('div', 'panel-heading'); top.append(element('h2', '', titles[page]), button('×', () => openWorkspace('builder'), 'icon-button')); top.lastChild.setAttribute('aria-label', 'Закрыть панель'); target.append(top);
  if (page === 'behavior') renderBehavior(target);
  else if (page === 'variables') renderVariables(target);
  else if (page === 'export') renderExport(target);
  else if (page === 'guide') renderGuide(target);
  else if (page === 'settings') { heading('Настройки проекта', 'Название и описание', target); const panel = element('section', 'properties'); field(panel, 'Название', draft.name, v => { draft.name = v; }); field(panel, 'Описание', draft.description, v => { draft.description = v; }); target.append(panel); }
  target.querySelector('.page-heading h1')?.remove();
  if (['behavior','variables','settings'].includes(page)) target.append(button('Сохранить изменения', saveProject, 'primary'));
}
function renderBuilder(page = 'builder') {
  const h = heading('Сценарий бота', 'Telegram · Добавьте блоки, соедините и сохраните');
  const actions = element('div', 'editor-actions'); actions.append(button('✦ ИИ', openAssistant, 'ai-trigger'), button('⤢ Расставить', arrangeScenario), ...(aiUndo?.projectId === draft.id ? [button('↶ Отменить ИИ', undoAIChange)] : []), button('▷ Предпросмотр', () => { openWorkspace('testing', 'test'); }), button('↓ Полный ZIP', downloadProjectBundle), button('✓ Проверить', validateProject), button('Сохранить', saveProject, 'primary')); h.append(actions); for (const b of actions.children) { if (b.textContent === 'Сохранить') b.dataset.tour = 'save'; if (b.textContent.includes('Предпросмотр')) b.dataset.tour = 'preview'; }
  renderBlockSearch();
  const mobileTabs = element('div', 'editor-tabs'); mobileTabs.setAttribute('role', 'group'); mobileTabs.setAttribute('aria-label', 'Панели конструктора');
  for (const [id, text] of [['blocks', '+ Блоки'], ['canvas', '⌘ Схема'], ['properties', '⚙ Свойства'], ['test', '▷ Тест']]) { const b = button(text, () => { openWorkspace(id === 'test' ? 'testing' : 'builder', id); }, editorTab === id ? 'active' : ''); b.setAttribute('aria-pressed', String(editorTab === id)); mobileTabs.append(b); }
  main.append(mobileTabs);
  const builder = element('section', 'builder editor-shell tab-' + (!['builder','testing'].includes(page) ? 'properties' : page === 'testing' ? 'test' : editorTab));
  const library = element('aside', 'library'); library.append(element('div', 'panel-eyebrow', 'ИНСТРУМЕНТЫ'), element('h2', '', 'Блоки сценария'), element('p', 'muted', 'Перетащите на схему или нажмите'));
  const icons = { start: 'play', command: 'braces', text: 'text', buttons: 'list', input: 'text-cursor-input', condition: 'git-branch', end: 'square' };
  const levels = element('div', 'library-levels');
  for (const [value, label] of [[false, 'Основные'], [true, 'Расширенные']]) { const b = button(label, () => { advancedBlocks = value; render(); }, advancedBlocks === value ? 'active' : ''); b.setAttribute('aria-pressed', String(advancedBlocks === value)); levels.append(b); } library.append(levels);
  for (const [type, name] of Object.entries(blockNames).filter(([type]) => advancedBlocks ? ['command', 'input', 'condition', 'end'].includes(type) : ['start', 'text', 'buttons'].includes(type))) {
    const b = button('', () => addNode(type), 'library-block'); b.dataset.blockType = type;
    const copy = element('span', 'library-copy'); copy.append(element('strong', '', name), element('small', '', {start:'Начало разговора',text:'Ответ вашего бота',buttons:'Выбор пользователя',command:'Отдельная команда',input:'Сохранить ответ',condition:'Разделить по условию',end:'Закончить разговор'}[type]));
    const symbol = element('span', 'block-symbol symbol-' + type); symbol.append(icon(icons[type])); const grip = element('span', 'add-symbol'); grip.append(icon('grip-vertical')); b.append(symbol, copy, grip); b.disabled = type === 'start' && draft.nodes.some(n => n.type === 'start'); b.draggable = !b.disabled;
    b.ondragstart = event => { event.dataTransfer.setData('application/botforge-block', type); event.dataTransfer.effectAllowed = 'copy'; }; b.title = blockTips[type]; b.setAttribute('aria-label', 'Добавить блок «' + name + '»'); library.append(b);
  }
  const layers = element('details', 'board-layers'); layers.open = true; layers.append(element('summary', '', 'Блоки на доске · ' + draft.nodes.length));
  for (const node of draft.nodes) { const row = button((node.data.text || node.data.command || blockNames[node.type]).slice(0, 34), () => { selectedNode = node.id; focusNode = node.id; openWorkspace('builder', 'properties'); }, node.id === selectedNode ? 'active' : ''); row.prepend(icon(icons[node.type])); row.classList.add('with-icon'); row.title = blockNames[node.type]; layers.append(row); }
  library.append(layers);
  const closeLibrary = button('× К схеме', () => openWorkspace('builder'), 'mobile-panel-close'); closeLibrary.setAttribute('aria-label', 'Закрыть библиотеку блоков'); library.prepend(closeLibrary);
  const search = document.querySelector('.block-search'); if (search) library.append(search);
  const hint = element('div', 'library-hint'); hint.append(element('strong', '', 'Соединяйте идеи'), element('p', '', 'Потяните от точки справа к входу другого блока. Каждая кнопка — отдельная ветка.')); library.append(hint);
  const center = element('div', 'editor-center'); const toolbar = element('div', 'canvas-bar'); toolbar.append(element('span', '', '◉ Сценарий'), element('span', 'muted', draft.nodes.length + ' блоков · ' + draft.edges.length + ' связей')); center.append(toolbar);
  if (aiAppliedSummary?.projectId === draft.id) { const note = element('aside','ai-build-note'); note.setAttribute('role','status'); note.append(element('strong','','✦ ИИ подготовил сценарий'),element('p','',aiAppliedSummary.text),element('p','tour-success',aiAppliedSummary.status || ''),button('Понятно',()=>{aiAppliedSummary=null;render();},'text-button')); center.append(note); }
  const dock = element('div', 'board-dock'); dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-label', 'Инструменты доски');
  dock.append(button('↖ Выбрать', () => { selectedNode = null; openWorkspace('builder'); }), button('＋ Текст', () => addNode('text')), button('⤢ Расставить', arrangeScenario), button('✦ ИИ', openAssistant, 'ai-trigger'), button('▷ Чат', () => { openWorkspace('testing', 'test'); })); center.append(dock);
  const canvas = element('div', 'flow-canvas'); canvas.setAttribute('aria-label', 'Схема сценария'); center.append(canvas);
  if (!draft.nodes.length) { const empty = element('div', 'canvas-welcome'); empty.append(element('div', 'welcome-icon', '⌘'), element('h2', '', 'Соберите свой первый сценарий'), element('p', '', 'Начните со старта — это вход в диалог по команде /start.'), button('+ Добавить старт', () => addNode('start'), 'primary'), button('Посмотреть обучение', openGuide, 'text-button')); center.append(empty); }
  const footer = element('div', 'canvas-footer'); footer.append(element('span', '', 'Перетаскивайте блоки · Прокрутка — перемещение · ⌘ / Ctrl + прокрутка — масштаб')); center.append(footer);
  builder.append(library, center);
  const inspector = element('aside', 'inspector'); inspector.setAttribute('aria-label', 'Панель ' + titles[page]); const panelMode = !['builder','testing'].includes(page); const testing = page === 'testing'; const tabs = element('div', 'inspector-tabs'); for (const [id, label] of [['properties','Свойства'],['test','Проверить чат']]) { const b = button(label, () => { openWorkspace(id === 'test' ? 'testing' : 'builder', id); }, (testing ? id === 'test' : id === 'properties') ? 'active' : ''); if (id === 'test') b.dataset.tour = 'preview'; tabs.append(b); } if (!panelMode) inspector.append(tabs);
  if (panelMode) renderWorkspacePanel(page, inspector); else {
  const picker = element('label', 'field block-picker'); picker.append(element('span', '', 'Выберите блок')); const select = element('select'); const placeholder = element('option', '', 'Выберите блок на схеме или в списке'); placeholder.value = ''; select.append(placeholder);
  for (const n of draft.nodes) { const option = element('option', '', blockNames[n.type] + ' · ' + (n.data.text || n.data.command || n.id.slice(0, 6)).slice(0, 40)); option.value = n.id; select.append(option); }
  select.value = selectedNode || ''; select.onchange = () => { selectedNode = select.value || null; render(); }; picker.append(select); if (!testing) inspector.append(picker);
  if (testing) renderChat(inspector);
  const node = draft.nodes.find(n => n.id === selectedNode);
  if (testing) {}
  else if (node) renderProperties(node, inspector);
  else {
    inspector.append(element('h2', '', 'Свойства блока'), element('p', 'muted', 'Выберите блок на схеме.'));
  }
  const connections = element('details', 'connections-list'); connections.append(element('summary', '', 'Связи · ' + draft.edges.length));
  for (const edge of draft.edges) { const source = draft.nodes.find(n => n.id === edge.source), target = draft.nodes.find(n => n.id === edge.target); if (!source || !target) continue; const row = element('div', 'connection-row'); row.append(element('span', '', blockNames[source.type] + ' → ' + blockNames[target.type]), button('×', () => { draft.edges = draft.edges.filter(e => e.id !== edge.id); changed(); render(); }, 'remove-edge')); row.lastChild.setAttribute('aria-label', 'Удалить связь ' + blockNames[source.type] + ' → ' + blockNames[target.type]); connections.append(row); }
  if (!testing) inspector.append(connections);
  }
  const closeInspector = button('× К схеме', () => openWorkspace('builder'), 'mobile-panel-close'); closeInspector.setAttribute('aria-label', 'Закрыть боковую панель'); inspector.prepend(closeInspector);
  builder.append(inspector); main.append(builder); if (testing) paintChat();
  const progress = element('section', 'quick-start'); progress.id = 'quick-start'; main.append(progress); refreshChecklist();
  if (window.matchMedia('(max-width: 650px)').matches && (page !== 'builder' || editorTab !== 'canvas')) return;
  disposeCanvas = window.BotForgeCanvas.mount(canvas, draft, blockNames, outputs, {
    drop: (type, position) => addNode(type, position),
    selected: selectedNode,
    focus: focusNode,
    reconnect: (edge, connection) => {
      if (!window.BotForgeEditor.reconnect(draft, edge.id, connection)) return notify('Этот выход уже занят или соединение недопустимо. Связь сохранена.');
      changed(); render();
    },
    current: () => previewState?.engine.project.id === draft.id && !previewStale() ? previewState.engine.current : null,
    select: id => { if (selectedNode !== id) { selectedNode = id; if (id) openWorkspace('builder', 'properties'); else render(); } },
    connect: c => connectBlocks(c.source, c.sourceHandle, c.target),
    move: changes => { for (const c of changes) if (c.type === 'position' && c.position) { const n = draft.nodes.find(n => n.id === c.id); if (n && (n.x !== c.position.x || n.y !== c.position.y)) { n.x = c.position.x; n.y = c.position.y; changed(); } } },
    edges: changes => { const removed = new Set(changes.filter(c => c.type === 'remove').map(c => c.id)); if (removed.size) { draft.edges = draft.edges.filter(e => !removed.has(e.id)); changed(); } },
    viewport: v => { canvasViewport = v; }
  }, canvasViewport);
  focusNode = null;
  window.BotForgeTour?.update();
}
function renderProperties(n, target = main) {
  const panel = element('section', 'properties'); panel.append(element('h2', '', 'Свойства · ' + blockNames[n.type]), element('p', 'property-tip', blockTips[n.type])); const d = n.data;
  if (['text', 'buttons', 'input'].includes(n.type)) { const input = field(panel, 'Текст сообщения', d.text, v => { d.text = v; }); input.dataset.tour = 'message'; }
  if (n.type === 'command') { field(panel, 'Команда', d.command, v => { d.command = v; }); field(panel, 'Описание для /help', d.description, v => { d.description = v; }); }
  if (['input', 'condition'].includes(n.type)) field(panel, 'Переменная', d.variable, v => { d.variable = v; }, [['', 'Выберите переменную'], ...draft.variables.map(v => [v.name, v.name])]);
  if (n.type === 'input') { field(panel, 'Проверка ввода', d.validation, v => { d.validation = v; }, [['text', 'Текст'], ['number', 'Число'], ['email', 'Email'], ['choice', 'Вариант из списка']]); field(panel, 'Варианты через запятую', d.choices, v => { d.choices = v; }); field(panel, 'Текст ошибки', d.error, v => { d.error = v; }); }
  if (n.type === 'condition') { field(panel, 'Операция', d.operation, v => { d.operation = v; }, [['eq', 'Равно'], ['ne', 'Не равно'], ['contains', 'Содержит'], ['gt', 'Больше'], ['lt', 'Меньше']]); field(panel, 'Значение', d.value, v => { d.value = v; }); }
  if (n.type === 'buttons') {
    field(panel, 'Расположение', d.placement, v => { d.placement = v; }, [['inline', 'Под сообщением'], ['keyboard', 'Нижняя клавиатура']]);
    for (const [index, b] of d.buttons.entries()) {
      const row = element('div', 'button-row'); field(row, 'Подпись', b.label, v => { b.label = v; }); field(row, 'Действие', b.action, v => { b.action = v; draft.edges = draft.edges.filter(e => !(e.source === n.id && e.output === b.id)); changed(); render(); }, [['transition', 'Переход'], ['url', 'Ссылка']]);
      const order = element('div', 'button-order');
      for (const [offset, text] of [[-1, '↑ Выше'], [1, '↓ Ниже']]) {
        const move = button(text, () => {
          if (window.BotForgeEditor.moveButton(n, b.id, offset)) { changed(); render(); }
        });
        move.disabled = offset === -1 ? index === 0 : index === d.buttons.length - 1;
        move.setAttribute('aria-label', 'Переместить кнопку «' + b.label + '» ' + (offset === -1 ? 'выше' : 'ниже'));
        order.append(move);
      }
      row.append(order);
      if (b.action === 'url') field(row, 'URL', b.url, v => { b.url = v; }); row.append(button('Удалить кнопку', () => { d.buttons = d.buttons.filter(x => x.id !== b.id); draft.edges = draft.edges.filter(e => !(e.source === n.id && e.output === b.id)); changed(); render(); })); panel.append(row);
    }
    panel.append(button('+ Добавить кнопку', () => { d.buttons.push({ id: crypto.randomUUID(), label: 'Кнопка', action: 'transition' }); changed(); render(); }));
  }
  for (const [output, label] of outputs(n)) field(panel, 'Переход · ' + label, draft.edges.find(e => e.source === n.id && e.output === output)?.target || '', target => { draft.edges = draft.edges.filter(e => !(e.source === n.id && e.output === output)); if (target) draft.edges.push({ id: crypto.randomUUID(), source: n.id, output, target }); }, [['', 'Конец / не настроено'], ...draft.nodes.map(t => [t.id, blockNames[t.type] + ' · ' + (t.data.text || t.data.command || t.id.slice(0, 6)).slice(0, 40)])]);
  const actions = element('div', 'dialog-actions'); actions.append(button('Обновить схему', render), button('Дублировать', () => { const copy = structuredClone(n); copy.id = crypto.randomUUID(); copy.x += 30; copy.y += 30; if (copy.type === 'start') return notify('В проекте разрешён один старт'); if (copy.data.buttons) copy.data.buttons.forEach(b => { b.id = crypto.randomUUID(); }); draft.nodes.push(copy); selectedNode = copy.id; changed(); render(); }), button('Удалить блок', () => { if (!confirm('Удалить блок и его связи?')) return; draft.nodes = draft.nodes.filter(t => t.id !== n.id); draft.edges = draft.edges.filter(e => e.source !== n.id && e.target !== n.id); selectedNode = null; changed(); render(); })); panel.append(actions); target.append(panel);
}
async function validateProject() { const result = await api('/' + draft.id + '/validate', 'POST', draft); document.querySelector('#validation')?.remove(); const panel = element('section', 'properties'); panel.id = 'validation'; panel.setAttribute('role', 'status'); panel.append(element('h2', '', result.valid ? 'Проверка пройдена' : 'Исправьте ошибки: ' + result.errors.length)); for (const issue of [...result.errors, ...result.warnings]) panel.append(button(issue.message, () => { if (issue.nodeId) { selectedNode = issue.nodeId; location.hash = 'builder'; render(); } })); main.append(panel); panel.scrollIntoView({ block: 'nearest' }); }
function renderVariables(target = main) {
  heading('Переменные', 'Начальные значения и данные, которые собирает бот.', target);
  for (const v of draft.variables) {
    const row = element('section', 'properties variable-row'); field(row, 'Имя', v.name, value => { v.name = value; }); field(row, 'Тип', v.type, value => { v.type = value; v.initial = value === 'number' ? 0 : ''; render(); }, [['text', 'Текст'], ['number', 'Число']]); field(row, 'Начальное значение', v.initial, value => { v.initial = v.type === 'number' ? (value.trim() ? Number(value) : null) : value; });
    row.append(button('Удалить', () => { const used = draft.nodes.filter(n => n.data.variable === v.name || JSON.stringify(n.data).includes('{' + v.name + '}')); if (confirm('Удалить переменную?' + (used.length ? ' Используется: ' + used.map(n => blockNames[n.type] + ' ' + n.id.slice(0, 6)).join(', ') : ''))) { draft.variables = draft.variables.filter(x => x !== v); changed(); render(); } })); target.append(row);
  }
  target.append(button('+ Переменная', () => { draft.variables.push({ name: 'переменная_' + (draft.variables.length + 1), type: 'text', initial: '' }); changed(); render(); }));
}
function renderBehavior(target = main) {
  heading('Поведение бота', 'Эти настройки действуют в предпросмотре и скачанном боте.', target);
  const panel = element('section', 'properties');
  for (const [key, label] of Object.entries({ unknownCommand: 'Автоответ на неизвестную команду', unknownText: 'Автоответ на непонятный текст', help: 'Автоматический /help', cancel: '/cancel возвращает к стартовому сценарию', disableOldButtons: 'Отключать старые кнопки', repeatQuestion: 'Повторять вопрос при неверном вводе', preventDoubleClick: 'Защита от повторных нажатий', ignoreCase: 'Игнорировать регистр команд', deleteUser: 'Удалять сообщение пользователя после обработки (зависит от прав Telegram)', typing: 'Показывать «Печатает…»', inputTimeout: 'Ограничить время ожидания ввода', rateLimit: 'Ограничить частоту сообщений' })) {
    const wrap = element('label', 'check-row'); const input = element('input'); input.type = 'checkbox'; input.checked = draft.behavior[key] === true; input.onchange = () => { draft.behavior[key] = input.checked; if (key === 'inputTimeout') { draft.behavior.timeoutSeconds ??= 60; draft.behavior.timeoutText ??= 'Время ожидания истекло.'; } if (key === 'rateLimit') { draft.behavior.rateCount ??= 5; draft.behavior.rateSeconds ??= 10; } changed(); render(); }; wrap.append(input, document.createTextNode(label)); panel.append(wrap);
  }
  field(panel, 'История сообщений', draft.behavior.history || 'keep', v => { draft.behavior.history = v; }, [['keep', 'Оставлять сообщения'], ['delete', 'Удалять предыдущее сообщение бота'], ['update', 'Обновлять предыдущее сообщение бота']]);
  if (draft.behavior.inputTimeout) { field(panel, 'Время ожидания, секунд', draft.behavior.timeoutSeconds ?? 60, v => { draft.behavior.timeoutSeconds = Number(v); }); field(panel, 'Сообщение по истечении времени', draft.behavior.timeoutText || 'Время ожидания истекло.', v => { draft.behavior.timeoutText = v; }); }
  if (draft.behavior.rateLimit) { field(panel, 'Количество сообщений', draft.behavior.rateCount ?? 5, v => { draft.behavior.rateCount = Number(v); }); field(panel, 'Интервал, секунд', draft.behavior.rateSeconds ?? 10, v => { draft.behavior.rateSeconds = Number(v); }); }
  field(panel, 'Ответ на неизвестную команду', draft.behavior.unknownCommandText, v => { draft.behavior.unknownCommandText = v; }); field(panel, 'Ответ на непонятный текст', draft.behavior.unknownTextMessage, v => { draft.behavior.unknownTextMessage = v; }); target.append(panel);
}
function renderWelcome() {
  document.title = 'BotForge · Визуальный редактор Telegram-ботов';
  const header = element('header', 'welcome-header'); const brand = element('a', 'welcome-brand'); brand.href = '/'; const logo = element('img'); logo.src = '/logo.png'; logo.alt = ''; brand.append(logo, document.createTextNode('BotForge'));
  const links = element('div', 'welcome-header-links'); links.append(button('Возможности', () => document.querySelector('.welcome-steps').scrollIntoView({ block: 'start' }), 'welcome-help')); const signin = element('a', 'button welcome-signin', 'Войти'); signin.href = '/auth/google'; links.append(signin); header.append(brand, links); main.append(header);
  const hero = element('section', 'welcome-hero'); const copy = element('div', 'welcome-copy'); copy.append(element('span', 'welcome-tag', 'BOTFORGE STUDIO'), element('h1', '', 'Конструктор Telegram-ботов'), element('p', 'welcome-lead', 'Сообщения, команды и условия на одной схеме. Соберите сценарий, проверьте диалог и экспортируйте проект на нужном языке.'));
  const access = element('div', 'welcome-access'); const login = element('a', 'button welcome-google', 'Войти через Google'); login.href = '/auth/google'; login.append(icon('arrow-up')); access.append(login, element('p', 'welcome-login-note', 'Ваши проекты доступны в личном пространстве.')); copy.append(access); hero.append(copy);
  const preview = element('section', 'welcome-preview'); preview.setAttribute('aria-label', 'Пример интерфейса редактора'); const bar = element('div', 'welcome-preview-bar'); const file = element('span'); file.append(icon('workflow'),document.createTextNode('Запись на консультацию')); bar.append(file,element('span', 'welcome-preview-badge', 'ПРИМЕР ПРОЕКТА')); preview.append(bar);
  const studio=element('div','welcome-studio'); const library=element('aside','welcome-library'); library.append(element('strong','','Блоки'));
  for (const [name,label] of [['play','Старт'],['message-square','Сообщение'],['list','Кнопки'],['text-cursor-input','Ввод данных'],['git-branch','Условие']]) { const row=element('div'); row.append(icon(name),document.createTextNode(label)); library.append(row); }
  studio.append(library); const board=element('div','welcome-board'); const flow=element('div','welcome-flow');
  for (const [name,title,text] of [['play','Старт','/start'],['message-square','Приветствие','Выберите услугу'],['text-cursor-input','Контакт','Как с вами связаться?'],['list','Услуги','Консультация · Поддержка']]) { const node=element('div','welcome-flow-node'); const heading=element('div','welcome-node-title'); heading.append(icon(name),element('strong','',title)); node.append(heading,element('p','',text),element('span','welcome-node-output','Далее')); flow.append(node); }
  board.append(element('span','welcome-board-label','Сценарий / Основная ветка'),flow); const zoom=element('span','welcome-zoom','100%'); board.append(zoom); studio.append(board);
  const properties=element('aside','welcome-properties'); properties.append(element('strong','','Свойства блока'),element('span','', 'СООБЩЕНИЕ'),element('p','welcome-property-value','Выберите услугу'),element('span','','СЛЕДУЮЩИЙ БЛОК'),element('p','welcome-property-value','Услуги')); studio.append(properties); preview.append(studio);
  const formats=element('div','welcome-preview-footer'); formats.append(element('span','','Экспорт исходного кода'),element('span','','Python / JavaScript / TypeScript / Go')); preview.append(formats); hero.append(preview); main.append(hero);
  const steps=element('section','welcome-steps'); steps.setAttribute('aria-label','Возможности редактора'); for(const [number,title,text] of [['01','Сценарий на доске','Соединяйте блоки и настраивайте переходы между сообщениями.'],['02','Проверка до запуска','Пройдите сценарий в чате: сообщения, кнопки и ввод данных.'],['03','Исходный код','Скачайте ZIP с проектом и инструкцией. Токен бота добавляется при запуске.']]) { const item=element('article'); item.append(element('span','welcome-step-number',number),element('h2','',title),element('p','',text)); steps.append(item); } main.append(steps);
  const bottom=element('footer','welcome-bottom'); bottom.append(element('span','','BotForge — конструктор Telegram-ботов')); const privacy=element('a','','Конфиденциальность'); privacy.href='/privacy'; bottom.append(privacy,element('span','','Вход через Google использует имя и email.')); main.append(bottom);
}
function render() {
  const page = Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : 'projects'; if (disposeCanvas) { disposeCanvas(); disposeCanvas = null; } document.body.classList.toggle('is-projects', page === 'projects'); document.body.classList.toggle('is-welcome', !!(account?.enabled && !account.user)); document.body.classList.toggle('is-editor', page !== 'projects' && !!draft); if (page !== 'builder' && aiDialog.open) closeAssistant(); main.classList.toggle('editor-page', page !== 'projects' && !!draft); main.replaceChildren(); document.title = 'BotForge · ' + titles[page]; document.querySelector('#breadcrumb').textContent = draft && page !== 'projects' ? draft.name : 'Рабочее пространство';
  document.querySelectorAll('[data-page]').forEach(a => { a.classList.toggle('active', a.dataset.page === page); if (a.dataset.page === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  status(dirty ? 'Есть изменения' : 'Серверное хранение');
  if (accountError) { heading('Не удалось проверить доступ', accountError); main.append(button('Повторить', () => location.reload(), 'primary')); return; }
  if (account?.enabled && !account.user) return renderWelcome();
  if (page === 'projects') return renderProjects();
  if (page === 'guide' && !draft) return renderGuide();
  if (!draft) { heading(titles[page], 'Откройте проект, чтобы продолжить.'); main.append(button('К проектам', () => { location.hash = 'projects'; })); return; }
  return renderBuilder(page);
}
const mobileMenu = document.querySelector('#mobile-menu');
mobileMenu.append(document.querySelector('nav').cloneNode(true));
document.querySelector('#open-mobile-menu').onclick = () => mobileMenu.showModal();
document.querySelector('#close-mobile-menu').onclick = () => mobileMenu.close();
mobileMenu.addEventListener('click', event => { if (event.target.closest('a')) mobileMenu.close(); if (event.target === mobileMenu) { const box = mobileMenu.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) mobileMenu.close(); } });
window.matchMedia('(max-width: 650px)').addEventListener('change', () => mobileMenu.close());
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
(async () => { try { const r = await fetch('/auth/status'); if (!r.ok) throw Error('Не удалось проверить вход'); account = await r.json(); const b = button(account.enabled ? (account.user ? account.user.name + ' · Выйти' : 'Войти с Google') : 'Google · скоро', async () => { if (!account.enabled) return notify('Google-вход подготовлен. Осталось добавить данные приложения Google Cloud на сервер.'); if (account.user) { if (!leave()) return; const r = await fetch('/auth/logout', {method:'POST'}); if (!r.ok) throw Error('Не удалось выйти'); location.reload(); } else location.href = '/auth/google'; }, 'account-button'); document.querySelector('.topbar').append(b); } catch(e) { accountError = e.message; loading = false; render(); return; } if (account.enabled && !account.user) { loading = false; render(); return; } await reload(); if (selectedId && projects.some(p => p.id === selectedId)) { try { draft = await api('/' + selectedId); render(); } catch (e) { notify(e.message); } } })();
