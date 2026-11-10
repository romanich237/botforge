let aiMode = 'create', aiProvider = null, aiBefore = null, aiFocusId = null;
let aiResult = null, aiBusy = false, aiPrompt = '', aiError = '', aiBaseSignature = '', aiProjectId = null, aiUndo = null;
const aiDialog = document.querySelector('#ai-dialog');
function graphSnapshot() { return structuredClone({ nodes: draft.nodes, edges: draft.edges, variables: draft.variables }); }
function rememberAIChange() { aiUndo = { projectId: draft.id, before: graphSnapshot() }; }
function arrangeScenario() {
  if (!draft.nodes.length) return notify('Добавьте блоки или создайте сценарий с ИИ.');
  rememberAIChange(); draft.nodes = window.BotForgeLayout.arrange(draft).nodes; canvasViewport = null; changed(); render(); notify('Блоки расставлены. Связи и содержимое сохранены.');
}
function undoAIChange() {
  if (!aiUndo || aiUndo.projectId !== draft.id) return;
  if (!confirm('Вернуть схему до последнего ИИ-изменения или раскладки? Последующие изменения блоков тоже будут отменены.')) return;
  Object.assign(draft, aiUndo.before); aiUndo = null; selectedNode = null; canvasViewport = null; changed(); render();
}
function openAssistant() {
  if (aiBusy && aiProjectId !== draft.id) return notify('Дождитесь ответа ИИ для предыдущего проекта.');
  if (aiProjectId !== draft.id) { aiProjectId = draft.id; aiResult = null; aiError = ''; aiPrompt = ''; aiMode = draft.nodes.length ? 'edit' : 'create'; }
  renderAssistant(); aiDialog.showModal();
  fetch('/api/ai/status').then(r => { if (!r.ok) throw Error(); return r.json(); }).then(info => { aiProvider = info; refreshAIStatus(); }).catch(() => { aiProvider = { configured: false, failed: true }; refreshAIStatus(); });
}
function refreshAIStatus() {
  const provider = document.querySelector('#ai-provider');
  if (provider) provider.textContent = aiBusy ? 'ИИ готовит изменения. Это может занять до 3 минут; текущая схема пока не меняется.' : !aiProvider ? 'Проверяем доступность модели…' : aiProvider.failed ? 'Не удалось проверить ИИ. Закройте и откройте помощника для повтора.' : aiProvider.configured ? 'Модель: ' + aiProvider.model + ' · ' + aiProvider.provider : 'ИИ не настроен на сервере. Раскладка доступна без ИИ.';
  const submit = document.querySelector('#ai-submit'); if (submit) submit.disabled = aiBusy || !aiProvider?.configured;
}
function renderAIChanges(parent) {
  const changed = aiResult.changes;
  const labels = { nodes: 'Блоки', edges: 'Связи', variables: 'Переменные' };
  if (changed) {
    const counts = element('div', 'ai-change-counts');
    for (const [key, label] of Object.entries(labels)) counts.append(element('p', '', label + ': +' + changed[key].added.length + ' новых · ' + changed[key].updated.length + ' изменено · −' + changed[key].removed.length + ' удалено'));
    parent.append(counts);
  }
  const list = element('ul', 'ai-change-list');
  const oldNodes = aiBefore?.nodes || [];
  const entries = changed ? [...changed.nodes.added.map(id => ['added', aiResult.nodes.find(n => n.id === id)]), ...changed.nodes.updated.map(id => ['updated', aiResult.nodes.find(n => n.id === id)]), ...changed.nodes.removed.map(id => ['removed', oldNodes.find(n => n.id === id)])] : aiResult.nodes.map(n => ['added', n]);
  for (const [kind, node] of entries) if (node) { const item = element('li', 'change-' + kind); item.append(element('strong', '', ({ added: '+ Добавить', updated: 'Изменить', removed: '− Удалить' })[kind] + ' · ' + blockNames[node.type]), element('p', '', (node.data.text || node.data.command || node.id).slice(0, 180))); list.append(item); }
  if (list.children.length) parent.append(list);
}
function renderAssistant() {
  aiDialog.replaceChildren();
  const top = element('div', 'dialog-heading'); const title = element('h2', '', '✦ ИИ-помощник'); title.id = 'ai-title'; const close = button('×', () => aiDialog.close(), 'icon-button'); close.setAttribute('aria-label', 'Закрыть ИИ-помощника'); top.append(title, close); aiDialog.append(top);
  aiDialog.append(element('p', 'muted', 'Попросите добавить ветку, изменить ответ или собрать нового бота. Перед применением вы увидите список правок.'));
  const modes = element('div', 'ai-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Режим ИИ');
  for (const [mode, title] of [['edit', 'Изменить текущий'], ['create', 'Создать заново']]) { const b = button(title, () => { aiMode = mode; aiResult = null; aiError = ''; renderAssistant(); }, aiMode === mode ? 'active' : ''); b.setAttribute('aria-pressed', String(aiMode === mode)); b.disabled = aiBusy || (mode === 'edit' && !draft.nodes.length); modes.append(b); } aiDialog.append(modes);
  const selected = aiMode === 'edit' ? draft.nodes.find(n => n.id === ((aiBusy || aiResult) ? aiFocusId : selectedNode)) : null;
  const context = element('p', 'ai-context', aiMode === 'edit' ? 'Сохраним существующие блоки, связи и расположение. Удаление будет явно показано в предложении.' : draft.nodes.length ? 'Новый сценарий заменит текущую схему после вашего подтверждения.' : 'Создадим первый связанный сценарий в этом проекте.'); aiDialog.append(context);
  if (selected) aiDialog.append(element('p', 'ai-selected', 'Выбран блок: ' + blockNames[selected.type] + ' · ' + (selected.data.text || selected.data.command || selected.id).slice(0, 90)));
  const provider = element('p', 'ai-provider', 'Проверяем доступность модели…'); provider.id = 'ai-provider'; aiDialog.append(provider);
  const label = element('label', 'field'); label.append(element('span', '', aiMode === 'edit' ? 'Что изменить?' : 'Какого бота создаём?')); const input = element('textarea'); input.rows = 5; input.maxLength = 4000; input.placeholder = aiMode === 'edit' ? 'Например: добавь сбор email перед подтверждением, остальные ветки не меняй.' : 'Например: бот записи на консультацию. Узнай имя и email, предложи два направления и покажи подтверждение.'; input.value = aiPrompt; input.disabled = aiBusy; input.oninput = () => { aiPrompt = input.value; }; label.append(input); aiDialog.append(label);
  aiDialog.append(element('p', 'ai-privacy', 'После отправки запроса описание и текущая схема будут отправлены в triklz27.ru. Не добавляйте в них пароли, токены и личные данные. Запрос использует баланс подключённого API.'));
  if (!aiBusy && !aiResult) { const examples = element('div', 'ai-examples'); for (const prompt of aiMode === 'edit' ? ['Добавь команду /helpme с краткой инструкцией, сохрани остальные ветки.', 'Добавь сбор имени перед приветствием и обращайся к пользователю по имени.'] : ['Бот записи: имя, email, выбор услуги и подтверждение.', 'Приветствие и две кнопки: О нас и Контакты.']) examples.append(button(prompt, () => { aiPrompt = prompt; input.value = prompt; input.focus(); }, 'text-button')); aiDialog.append(examples); }
  if (aiError) { const error = element('p', 'ai-error', aiError); error.setAttribute('role', 'alert'); aiDialog.append(error); }
  if (aiResult) {
    const proposal = element('section', 'ai-proposal'); proposal.append(element('h3', '', aiResult.mode === 'edit' ? 'Предлагаемые изменения' : 'Новый сценарий'), element('p', '', aiResult.summary), element('p', 'muted', aiResult.nodes.length + ' блоков · ' + aiResult.edges.length + ' связей · ' + aiResult.variables.length + ' переменных'));
    renderAIChanges(proposal);
    for (const warning of aiResult.warnings || []) proposal.append(element('p', 'muted', warning.message));
    proposal.append(element('p', 'ai-privacy', aiResult.mode === 'edit' ? 'Будут применены только показанные изменения. Координаты существующих блоков и настройки сохранятся. Можно отменить; сохранение отдельно.' : 'Применение заменит блоки, связи и переменные текущего черновика. Можно отменить; сохранение отдельно.'));
    const apply = button(aiResult.mode === 'edit' ? 'Применить изменения' : 'Заменить сценарий', () => {
      if (aiProjectId !== draft.id || aiBaseSignature !== scenarioSignature()) return notify('Схема изменилась после запроса. Создайте новое предложение, чтобы не потерять правки.');
      rememberAIChange(); const target = aiResult.changes?.nodes.added[0] || aiResult.changes?.nodes.updated[0] || null; Object.assign(draft, { nodes: aiResult.nodes, edges: aiResult.edges, variables: aiResult.variables }); aiResult = null; selectedNode = target; focusNode = target; if (aiMode === 'create') canvasViewport = null; editorTab = 'canvas'; aiDialog.close(); changed(); render(); notify('ИИ-сценарий применён. Проверьте диалог и сохраните проект.');
    }, 'primary'); const stale = aiBaseSignature !== scenarioSignature(); const hasChanges = !aiResult.changes || Object.values(aiResult.changes).some(c => c.added.length || c.updated.length || c.removed.length); apply.disabled = stale || !hasChanges; if (!hasChanges) proposal.append(element('p', 'muted', 'Сценарий уже соответствует запросу — изменений нет.')); if (stale) proposal.append(element('p', 'ai-error', 'Черновик уже изменился. Подготовьте новое предложение.')); proposal.append(apply); aiDialog.append(proposal);
  }
  const actions = element('div', 'dialog-actions'); const submit = button(aiBusy ? 'ИИ готовит предложение…' : aiResult ? 'Подготовить другой вариант' : aiMode === 'edit' ? 'Предложить изменения' : 'Создать сценарий', requestScenario, 'primary'); submit.id = 'ai-submit'; submit.disabled = aiBusy; actions.append(button('Закрыть', () => aiDialog.close()), submit); aiDialog.append(actions); refreshAIStatus();
}
async function requestScenario() {
  if (aiBusy) return; if (!aiPrompt.trim()) return notify('Опишите сценарий бота.');
  aiBusy = true; aiError = ''; aiResult = null; aiProjectId = draft.id; aiBaseSignature = scenarioSignature(); const snapshot = structuredClone(draft); aiBefore = snapshot; const mode = aiMode; const focus = mode === 'edit' ? selectedNode : null; aiFocusId = focus; renderAssistant();
  try { const response = await fetch('/api/projects/' + snapshot.id + '/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: snapshot, prompt: aiPrompt, mode, selectedNodeId: focus }) }); const data = await response.json(); if (!response.ok) throw Error(data.message || 'Не удалось создать сценарий'); aiResult = { ...data, mode: data.mode || mode }; }
  catch (error) { aiError = error.message; }
  finally { aiBusy = false; renderAssistant(); }
}
