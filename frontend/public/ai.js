let aiAppliedSummary = null;
let aiAutoApply = false, aiDownloadProject = false;
let aiMode = 'create', aiProvider = null, aiBefore = null, aiFocusId = null;
let aiResult = null, aiBusy = false, aiPrompt = '', aiError = '', aiBaseSignature = '', aiProjectId = null, aiUndo = null;
const aiDialog = document.querySelector('#ai-dialog');
function closeAssistant() { aiDialog.close(); document.body.classList.remove('assistant-open'); }
aiDialog.onclose = () => document.body.classList.remove('assistant-open');
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
  renderAssistant(); aiDialog.showModal(); document.body.classList.add('assistant-open');
  fetch('/api/ai/status').then(r => { if (!r.ok) throw Error(); return r.json(); }).then(info => { aiProvider = info; refreshAIStatus(); }).catch(() => { aiProvider = { configured: false, failed: true }; refreshAIStatus(); });
}
function refreshAIStatus() {
  const provider = document.querySelector('#ai-provider');
  if (provider) provider.textContent = aiBusy ? 'ИИ обрабатывает запрос. Это может занять до 3 минут; текущая схема пока не меняется.' : !aiProvider ? 'Проверяем доступность модели…' : aiProvider.failed ? 'Не удалось проверить ИИ. Закройте и откройте помощника для повтора.' : aiProvider.configured ? 'Модель: ' + aiProvider.model + ' · ' + aiProvider.provider + (aiProvider.quota ? ' · Баланс: ' + Number(aiProvider.quota.credits).toFixed(1).replace('.0', '') + ' кредитов (' + aiProvider.quota.tokensRemaining.toLocaleString('ru-RU') + ' токенов) · Запросов сегодня: ' + aiProvider.quota.remaining + '/' + aiProvider.quota.limit : '') : 'ИИ не настроен на сервере. Раскладка доступна без ИИ.';
  const notice = document.querySelector('.ai-provider-notice'); if (notice) notice.textContent = 'Описание и схема отправляются подключённому ИИ-провайдеру (' + (aiProvider?.provider || 'проверяем адрес') + '). Не указывайте пароли и личные данные. Запрос расходует дневной лимит и баланс API; при ошибке схемы возможна одна попытка исправления.';
  const submit = document.querySelector('#ai-submit'); if (submit) submit.disabled = aiBusy || !aiProvider?.configured || aiProvider?.quota?.remaining === 0 || aiProvider?.quota?.tokensRemaining === 0;
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
function applyAIResult() {
      if (aiProjectId !== draft.id || aiBaseSignature !== scenarioSignature()) { notify('Схема изменилась после запроса. Создайте новое предложение, чтобы не потерять правки.'); return false; }
      aiAppliedSummary = { projectId: draft.id, text: aiResult.summary };
      if (!hasAIChanges(aiResult)) { aiResult = null; render(); return true; }
      rememberAIChange(); const creating = aiResult.mode === 'create' || !!aiResult.movedNodeIds?.length; const target = creating ? null : (aiResult.changes?.nodes.added[0] || aiResult.changes?.nodes.updated[0] || null); Object.assign(draft, { nodes: aiResult.nodes, edges: aiResult.edges, variables: aiResult.variables }); aiResult = null; selectedNode = target; focusNode = target; if (creating) canvasViewport = null; aiMode = 'edit'; editorTab = 'canvas'; changed(); render(); main.classList.add('ai-reveal'); setTimeout(() => main.classList.remove('ai-reveal'), 1500); notify('ИИ-сценарий применён.'); return true;

}
function hasAIChanges(result) { return !!result.movedNodeIds?.length || !result.changes || Object.values(result.changes).some(c => c.added.length || c.updated.length || c.removed.length); }
async function applyAndSaveAI(download = aiDownloadProject) {
  if (!applyAIResult()) return;
  const projectId = draft.id;
  if (dirty && !await saveProject()) return;
  if (aiAppliedSummary?.projectId === projectId) aiAppliedSummary.status = 'Изменения сохранены на сервере.';
  if (download) { const ready = await downloadProjectBundle(); if (ready && aiAppliedSummary?.projectId === projectId) aiAppliedSummary.status = 'Сохранено. Полный ZIP подготовлен для скачивания.'; } else notify('ИИ-сценарий сохранён. Проверьте его в чате справа.');
  render();
}
function renderAssistant() {
  aiDialog.replaceChildren();
  const top = element('div', 'dialog-heading'); const title = element('h2', '', '✦ ИИ-помощник'); title.id = 'ai-title'; const close = button('×', () => closeAssistant(), 'icon-button'); close.setAttribute('aria-label', 'Закрыть ИИ-помощника'); top.append(title, close); aiDialog.append(top);
  if (aiAppliedSummary?.projectId === draft.id) { const done = element('section', 'ai-answer'); done.setAttribute('role', 'status'); done.append(element('strong', '', '✓ Готово'), element('p', '', aiAppliedSummary.text), element('p', 'tour-success', aiAppliedSummary.status || '')); aiDialog.append(done); }
  aiDialog.append(element('p', 'muted', 'Опишите задачу — помощник соберёт блоки и связи прямо на доске.'));
  const modes = element('div', 'ai-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Режим ИИ');
  for (const [mode, title] of [['edit', 'Изменить текущий'], ['create', 'Создать заново'], ['question', 'Спросить']]) { const b = button(title, () => { aiMode = mode; aiResult = null; aiError = ''; renderAssistant(); }, aiMode === mode ? 'active' : ''); b.setAttribute('aria-pressed', String(aiMode === mode)); b.disabled = aiBusy || (mode === 'edit' && !draft.nodes.length); modes.append(b); } aiDialog.append(modes);
  const selected = aiMode !== 'create' ? draft.nodes.find(n => n.id === ((aiBusy || aiResult) ? aiFocusId : selectedNode)) : null;
  const context = element('p', 'ai-context', aiMode === 'question' ? 'Объясним сценарий и подскажем, как его улучшить. Схема не изменится.' : aiMode === 'edit' ? 'ИИ может добавлять, изменять, удалять и соединять блоки; по запросу переставит схему. Доступна отмена последнего действия. Отключите применение сразу, чтобы сначала увидеть предложение.' : draft.nodes.length ? 'Новый сценарий заменит текущую схему после вашего подтверждения.' : 'Сразу соберём и расставим блоки на пустом полотне. Затем сможете проверить чат и отменить результат.'); aiDialog.append(context);
  if (selected) aiDialog.append(element('p', 'ai-selected', 'Выбран блок: ' + blockNames[selected.type] + ' · ' + (selected.data.text || selected.data.command || selected.id).slice(0, 90)));
  if (aiBusy) { const working = element('div', 'ai-working'); working.setAttribute('role', 'status'); working.append(element('span', 'ai-orbit'), element('span', '', aiMode === 'question' ? 'Читаем сценарий и готовим ответ…' : 'Собираем сценарий и проверяем связи… Готовые блоки появятся после проверки.')); aiDialog.append(working); }
  if (aiMode !== 'question') { const options = element('div', 'ai-run-options'); for (const [label, value, change] of [['Применять и сохранять правки сразу', aiAutoApply, value => { aiAutoApply = value; }], ['После сохранения скачать полный проект ZIP', aiDownloadProject, value => { aiDownloadProject = value; }]]) { const row = element('label'); const input = element('input'); input.type = 'checkbox'; input.checked = value; input.disabled = aiBusy; input.onchange = () => change(input.checked); row.append(input, element('span', '', label)); options.append(row); } aiDialog.append(options); }
  const provider = element('p', 'ai-provider', 'Проверяем доступность модели…'); provider.id = 'ai-provider'; aiDialog.append(provider);
  const label = element('label', 'field'); label.append(element('span', '', aiMode === 'question' ? 'Что хотите узнать?' : aiMode === 'edit' ? 'Что изменить?' : 'Какого бота создаём?')); const input = element('textarea'); input.rows = 5; input.setAttribute('aria-label', 'Запрос к ИИ'); input.maxLength = 4000; input.placeholder = aiMode === 'question' ? 'Например: как добавить проверку email или почему эта ветка не запускается?' : aiMode === 'edit' ? 'Например: добавь сбор email перед подтверждением, остальные ветки не меняй.' : 'Например: бот записи на консультацию. Узнай имя и email, предложи два направления и покажи подтверждение.'; input.value = aiPrompt; input.disabled = aiBusy; input.oninput = () => { aiPrompt = input.value; }; label.append(input); aiDialog.append(label);
  aiDialog.append(element('p', 'ai-privacy ai-provider-notice', 'Описание и схема отправляются подключённому ИИ-провайдеру (' + (aiProvider?.provider || 'адрес загружается') + '). Не указывайте пароли и личные данные. Запрос расходует дневной лимит и баланс API; при ошибке схемы возможна одна попытка исправления.'));
  if (!aiBusy && !aiResult) { const examples = element('div', 'ai-examples'); for (const prompt of aiMode === 'question' ? ['Как добавить проверку email?', 'Объясни, как работает текущий сценарий.'] : aiMode === 'edit' ? ['Добавь команду /helpme с краткой инструкцией, сохрани остальные ветки.', 'Добавь сбор имени перед приветствием и обращайся к пользователю по имени.'] : ['Бот записи: имя, email, выбор услуги и подтверждение.', 'Приветствие и две кнопки: О нас и Контакты.']) examples.append(button(prompt, () => { aiPrompt = prompt; input.value = prompt; input.focus(); }, 'text-button')); aiDialog.append(examples); }
  if (aiError) { const error = element('p', 'ai-error', aiError); error.setAttribute('role', 'alert'); aiDialog.append(error); }
  if (aiResult?.mode === 'question') { const answer = element('section', 'ai-answer'); answer.append(element('h3', '', 'Ответ помощника'), element('p', '', aiResult.answer)); aiDialog.append(answer); }
  else if (aiResult) {
    const proposal = element('section', 'ai-proposal'); proposal.append(element('h3', '', aiResult.mode === 'edit' ? 'Предлагаемые изменения' : 'Новый сценарий'), element('p', '', aiResult.summary), element('p', 'muted', aiResult.nodes.length + ' блоков · ' + aiResult.edges.length + ' связей · ' + aiResult.variables.length + ' переменных'));
    renderAIChanges(proposal); if (aiResult.movedNodeIds?.length) proposal.append(element('p', 'muted', 'Изменится расположение блоков: ' + aiResult.movedNodeIds.length));
    for (const warning of aiResult.warnings || []) proposal.append(element('p', 'muted', warning.message));
    proposal.append(element('p', 'ai-privacy', aiResult.mode === 'edit' ? 'Будут применены и сохранены показанные изменения. Расположение меняется по запросу. Доступна отмена последнего действия.' : 'Применение заменит и сохранит текущую схему. Доступна отмена последнего действия.'));
    const apply = button(aiResult.mode === 'edit' ? 'Применить изменения' : 'Заменить сценарий', () => {
      return applyAndSaveAI();
    }, 'primary'); const stale = aiBaseSignature !== scenarioSignature(); const hasChanges = hasAIChanges(aiResult); apply.disabled = stale || !hasChanges; if (!hasChanges) { proposal.append(element('p', 'muted', 'Сценарий уже соответствует запросу — изменений нет.')); const download = button('Скачать текущий полный ZIP', () => applyAndSaveAI(true)); download.disabled = stale; proposal.append(download); } if (stale) proposal.append(element('p', 'ai-error', 'Черновик уже изменился. Подготовьте новое предложение.')); proposal.append(apply); aiDialog.append(proposal);
  }
  const actions = element('div', 'dialog-actions'); const submit = button(aiBusy ? 'ИИ готовит предложение…' : aiResult ? 'Подготовить другой вариант' : aiMode === 'question' ? 'Задать вопрос' : aiMode === 'edit' ? 'Выполнить запрос' : draft.nodes.length ? 'Создать сценарий' : 'Создать и расставить', requestScenario, 'primary'); submit.id = 'ai-submit'; submit.disabled = aiBusy; actions.append(button('Закрыть', () => closeAssistant()), submit); aiDialog.append(actions);
  const settings = element('details', 'ai-settings'); settings.append(element('summary', '', 'Настройки ИИ и режим работы'));
  for (const node of [...aiDialog.children]) if (node.matches('.ai-modes,.ai-context,.ai-selected,.ai-run-options,.ai-provider-notice')) settings.append(node);
  aiDialog.insertBefore(settings, actions); refreshAIStatus();
}
async function requestScenario() {
  if (aiBusy) return; if (!aiPrompt.trim()) return notify('Опишите сценарий бота.');
  aiBusy = true; aiError = ''; aiResult = null; aiProjectId = draft.id; aiBaseSignature = scenarioSignature(); const autoApply = aiAutoApply, download = aiDownloadProject; const snapshot = structuredClone(draft); aiBefore = snapshot; const mode = aiMode; const focus = mode !== 'create' ? selectedNode : null; aiFocusId = focus; renderAssistant();
  try { const response = await fetch('/api/projects/' + snapshot.id + '/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: snapshot, prompt: aiPrompt, mode, selectedNodeId: focus }) }); const data = await response.json(); if (!response.ok) throw Error(data.message || 'Не удалось создать сценарий'); aiResult = { ...data, mode: data.mode || mode }; if (mode !== 'question' && autoApply && (mode === 'edit' || !snapshot.nodes.length) && aiProjectId === draft.id && aiBaseSignature === scenarioSignature()) await applyAndSaveAI(download); }
  catch (error) { aiError = error.message; }
  finally { aiBusy = false; try { const r = await fetch('/api/ai/status'); if (r.ok) aiProvider = await r.json(); } catch {} renderAssistant(); }
}
