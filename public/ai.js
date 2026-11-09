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
  if (aiProjectId !== draft.id && !aiBusy) { aiResult = null; aiError = ''; aiPrompt = ''; }
  renderAssistant(); aiDialog.showModal();
  fetch('/api/ai/status').then(r => r.json()).then(info => {
    const status = document.querySelector('#ai-provider');
    if (status) status.textContent = info.configured ? 'Модель: ' + info.model + ' · ' + info.provider : 'ИИ не настроен на сервере. Раскладка схемы работает без ИИ.';
    const submit = document.querySelector('#ai-submit'); if (submit) submit.disabled = aiBusy || !info.configured;
  }).catch(() => { const status = document.querySelector('#ai-provider'); if (status) status.textContent = 'Не удалось проверить доступность ИИ.'; });
}
function renderAssistant() {
  aiDialog.replaceChildren();
  const top = element('div', 'dialog-heading'); const title = element('h2', '', '✦ ИИ-помощник'); title.id = 'ai-title'; const close = button('×', () => aiDialog.close(), 'icon-button'); close.setAttribute('aria-label', 'Закрыть ИИ-помощника'); top.append(title, close); aiDialog.append(top);
  aiDialog.append(element('p', 'muted', 'Опишите, что должен делать бот. ИИ создаст блоки и переходы, а раскладка выстроит их в схему.'));
  const provider = element('p', 'ai-provider', 'Проверяем доступность модели…'); provider.id = 'ai-provider'; aiDialog.append(provider);
  const label = element('label', 'field'); label.append(element('span', '', 'Какого бота создаём?')); const input = element('textarea'); input.rows = 5; input.maxLength = 4000; input.placeholder = 'Например: бот записи на консультацию. Узнай имя и email, предложи два направления и покажи подтверждение.'; input.value = aiPrompt; input.disabled = aiBusy; input.oninput = () => { aiPrompt = input.value; }; label.append(input); aiDialog.append(label);
  aiDialog.append(element('p', 'ai-privacy', 'После нажатия «Создать сценарий» описание и текущая схема будут отправлены в triklz27.ru. Не добавляйте в них пароли, токены и личные данные. Запрос использует баланс подключённого API.'));
  if (aiError) { const error = element('p', 'ai-error', aiError); error.setAttribute('role', 'alert'); aiDialog.append(error); }
  if (aiResult) {
    const proposal = element('section', 'ai-proposal'); proposal.append(element('h3', '', 'Предложенная схема'), element('p', '', aiResult.summary), element('p', 'muted', aiResult.nodes.length + ' блоков · ' + aiResult.edges.length + ' связей · ' + aiResult.variables.length + ' переменных'));
    const list = element('ol'); for (const n of aiResult.nodes) list.append(element('li', '', blockNames[n.type] + (n.data.text ? ' — ' + n.data.text.slice(0, 130) : n.data.command ? ' — ' + n.data.command : ''))); proposal.append(list);
    for (const warning of aiResult.warnings || []) proposal.append(element('p', 'muted', warning.message));
    proposal.append(element('p', 'ai-privacy', 'Применение заменит блоки, связи и переменные текущего черновика. Настройки проекта сохранятся. Изменение можно отменить; сохранение выполняется отдельно.'));
    const apply = button('Применить к схеме', () => {
      if (aiProjectId !== draft.id || aiBaseSignature !== scenarioSignature()) return notify('Схема изменилась после запроса. Создайте новое предложение, чтобы не потерять правки.');
      rememberAIChange(); Object.assign(draft, { nodes: aiResult.nodes, edges: aiResult.edges, variables: aiResult.variables }); aiResult = null; selectedNode = null; canvasViewport = null; editorTab = 'canvas'; aiDialog.close(); changed(); render(); notify('ИИ-сценарий применён. Проверьте диалог и сохраните проект.');
    }, 'primary'); proposal.append(apply); aiDialog.append(proposal);
  }
  const actions = element('div', 'dialog-actions'); const submit = button(aiBusy ? 'ИИ собирает сценарий…' : aiResult ? 'Создать другой вариант' : 'Создать сценарий', requestScenario, 'primary'); submit.id = 'ai-submit'; submit.disabled = aiBusy; actions.append(button('Закрыть', () => aiDialog.close()), submit); aiDialog.append(actions);
}
async function requestScenario() {
  if (aiBusy) return; if (!aiPrompt.trim()) return notify('Опишите сценарий бота.');
  aiBusy = true; aiError = ''; aiResult = null; aiProjectId = draft.id; aiBaseSignature = scenarioSignature(); const snapshot = structuredClone(draft); renderAssistant();
  try { const response = await fetch('/api/projects/' + snapshot.id + '/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: snapshot, prompt: aiPrompt }) }); const data = await response.json(); if (!response.ok) throw Error(data.message || 'Не удалось создать сценарий'); aiResult = data; }
  catch (error) { aiError = error.message; }
  finally { aiBusy = false; renderAssistant(); const provider = document.querySelector('#ai-provider'); if (provider) provider.textContent = 'ИИ предлагает схему; изменения применяются только по вашей команде.'; }
}
