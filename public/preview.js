let previewState = null;
let previewBusy = false;
let exportResult = null;
let exportLanguage = 'python';
let exportBusy = false;
function scenarioSignature() { return JSON.stringify({ id: draft.id, nodes: draft.nodes, edges: draft.edges, variables: draft.variables, behavior: draft.behavior }); }
function resetPreview() { previewState = { engine: new window.BotForgeRuntime.Session(draft), signature: scenarioSignature(), history: [], keyboard: null }; previewBusy = false; }
function previewStale() { return previewState && previewState.signature !== scenarioSignature(); }
function applyPreviewEvents(events) {
  const state = previewState;
  for (const event of events) {
    if (event.type === 'disable') {
      for (const message of state.history) if (event.tokens.includes(message.token)) message.disabled = true;
      if (event.tokens.includes(state.keyboard?.token)) state.keyboard = null;
    } else if (event.type === 'message') {
      const last = state.history.findLast(m => m.role === 'bot');
      const message = { ...event, role: 'bot' };
      const mode = state.engine.behavior.history;
      if (last && mode === 'delete') state.history.splice(state.history.indexOf(last), 1);
      if (last && mode === 'update' && event.placement !== 'keyboard' && last.placement !== 'keyboard') Object.assign(last, message, { disabled: false });
      else {
        if (last && mode === 'update') state.history.push({ role: 'notice', text: 'Обновление сообщения с нижней клавиатурой недоступно — отправлено новое.' });
        state.history.push(message);
      }
      state.keyboard = event.placement === 'keyboard' && event.buttons.length ? event : null;
    } else state.history.push({ role: event.type, text: event.text, nodeId: event.nodeId });
  }
}
async function sendPreview(event, label) {
  if (previewBusy || previewStale()) return;
  previewBusy = true;
  const state = previewState;
  if (label && !state.engine.behavior.deleteUser) state.history.push({ role: 'user', text: label });
  paintChat();
  try {
    if (state.engine.behavior.typing) await new Promise(resolve => setTimeout(resolve, 300));
    if (state !== previewState) return;
    applyPreviewEvents(state.engine.handle(event));
  } catch (error) { state.history.push({ role: 'error', text: 'Ошибка сценария: ' + error.message, nodeId: state.engine.current }); }
  finally { previewBusy = false; paintChat(); document.querySelector('#chat-mount textarea')?.focus({ preventScroll: true }); disposeCanvas?.refresh?.(); window.BotForgeTour?.update(); }
}
function paintChat() {
  const host = document.querySelector('#chat-mount'); if (!host || !draft) return;
  host.replaceChildren();
  if (!previewState || previewState.engine.project.id !== draft.id) resetPreview();
  const stale = previewStale();
  const head = element('div', 'chat-heading'); const info = element('div'); info.append(element('strong', '', draft.name), element('small', '', 'Предпросмотр · локальный диалог')); head.append(element('span', 'chat-avatar', '▣'), info, button('↻', () => { resetPreview(); paintChat(); disposeCanvas?.refresh?.(); window.BotForgeTour?.update(); }, 'reset-chat')); head.lastChild.setAttribute('aria-label', 'Сбросить историю, шаг и переменные'); host.append(head);
  if (stale) { const warning = element('div', 'chat-warning'); warning.append(element('p', '', 'Сценарий изменён. Перезапустите тест, чтобы использовать новые блоки и настройки.'), button('Перезапустить тест', () => { resetPreview(); paintChat(); })); host.append(warning); }
  const history = element('div', 'chat-history'); history.setAttribute('role', 'log'); history.setAttribute('aria-label', 'История предпросмотра'); history.setAttribute('aria-live', 'polite');
  if (!previewState.history.length) { const empty = element('div', 'chat-empty'); empty.append(element('strong', '', 'Проверьте своего бота'), element('p', '', 'Нажмите /start, затем отвечайте на вопросы и выбирайте кнопки.'), Object.assign(button('▶ Запустить /start', () => sendPreview({ text: '/start' }, '/start'), 'primary'), { id: 'preview-start' })); history.append(empty); }
  for (const m of previewState.history) {
    const bubble = element('div', 'chat-message role-' + m.role); bubble.append(element('span', '', m.text));
    if (m.nodeId) bubble.append(button('Перейти к блоку →', () => { selectedNode = m.nodeId; editorTab = 'properties'; location.hash = 'builder'; render(); }));
    if (m.buttons?.length && m.placement !== 'keyboard') for (const choice of m.buttons) {
      if (choice.action === 'url') { const link = element('a', 'chat-choice', choice.label + ' ↗'); try { if (!['http:', 'https:'].includes(new URL(choice.url).protocol)) throw Error(); } catch { bubble.append(element('span', 'role-error', 'Неверная ссылка: укажите HTTP(S)')); continue; } link.href = choice.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; bubble.append(link); }
      else { const b = button(choice.label, () => sendPreview({ callback: choice.callback }, choice.label), 'chat-choice'); b.disabled = !!m.disabled || stale || previewBusy; bubble.append(b); }
    }
    history.append(bubble);
  }
  if (previewBusy && previewState.engine.behavior.typing) history.append(element('div', 'typing-indicator', 'Бот печатает…'));
  host.append(history);
  const keyboard = element('div', 'chat-keyboard');
  if (previewState.keyboard) for (const choice of previewState.keyboard.buttons) { const b = button(choice.label, () => sendPreview({ text: choice.label }, choice.label)); b.disabled = stale || previewBusy; keyboard.append(b); }
  if (keyboard.children.length) host.append(keyboard);
  const form = element('form', 'chat-form'); const input = element('textarea'); input.placeholder = 'Сообщение или /команда'; input.rows = 1; input.maxLength = 4096; input.setAttribute('aria-label', 'Сообщение боту'); input.disabled = stale;
  const send = element('button', 'primary', '↑'); send.type = 'submit'; send.setAttribute('aria-label', 'Отправить сообщение'); send.disabled = stale || previewBusy;
  form.onsubmit = e => { e.preventDefault(); const text = input.value.trim(); if (text) sendPreview({ text }, text); };
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } };
  form.append(input, send); host.append(form);
  const state = element('details', 'chat-state'); state.open = location.hash === '#testing'; state.append(element('summary', '', 'Переменные и текущий шаг'));
  state.append(element('pre', '', JSON.stringify(previewState.engine.values, null, 2)));
  const current = previewState.engine.project.nodes.find(n => n.id === previewState.engine.current); if (current) state.append(element('p', 'muted', 'Шаг: ' + blockNames[current.type] + (previewState.engine.waiting ? ' · ждёт ответ' : '')));
  host.append(state); history.scrollTop = history.scrollHeight;
}
function renderChat(parent) { const host = element('section', 'chat-mount'); host.id = 'chat-mount'; parent.append(host); paintChat(); }
function renderTesting() { heading('Тестирование', 'Локальный диалог по текущей схеме. Токен Telegram не нужен.'); const layout = element('div', 'testing-layout'); renderChat(layout); const help = element('aside', 'test-help'); help.append(element('h2', '', 'Проверьте сценарий'), element('p', '', 'Начните с /start, проверьте обе ветки кнопок и условий, правильный и неправильный ввод.'), element('p', '', '/help покажет команды, /cancel отменит ожидание и вернёт к стартовой ветке. /start сбросит переменные.'), button('Проверить схему', validateProject), button('Открыть конструктор', () => { location.hash = 'builder'; })); layout.append(help); main.append(layout); paintChat(); }
function renderExport() {
  const spec = window.BotForgeLanguages[exportLanguage];
  const h = heading('Экспорт бота', 'Скачайте исходники и запустите своего Telegram-бота локально.');
  h.append(element('span', 'platform-tag', '↗ Telegram · 4 языка экспорта'));
  const layout = element('section', 'export-layout'); const settings = element('aside', 'export-settings'); settings.append(element('h2', '', 'Настройки экспорта'));
  const wrap = element('label', 'field'); wrap.append(element('span', '', 'Язык программирования')); const select = element('select'); for (const [v, t] of Object.entries(window.BotForgeLanguages).map(([id, spec]) => [id, spec.name + ' · ' + spec.runtime])) { const o = element('option', '', t); o.value = v; select.append(o); } select.value = exportLanguage; select.disabled = exportBusy; select.onchange = () => { exportLanguage = select.value; exportResult = null; render(); }; wrap.append(select); settings.append(wrap);
  const generate = button(exportBusy ? 'Проверяем и генерируем…' : 'Проверить и подготовить код', prepareExport, 'primary'); generate.disabled = exportBusy; settings.append(generate, element('p', 'muted', 'Экспортируется текущая схема, включая несохранённые изменения. Токен добавляется только в локальный .env.'));
  const code = element('div', 'export-code');
  if (exportResult && exportResult.signature !== scenarioSignature()) exportResult = null;
  if (exportResult?.errors?.length) {
    code.append(element('h2', '', 'Исправьте ошибки сценария'));
    for (const issue of exportResult.errors) code.append(button(issue.message, () => { selectedNode = issue.nodeId || null; editorTab = 'properties'; location.hash = 'builder'; render(); }));
  } else if (exportResult?.files) {
    settings.append(element('h3', '', 'Файлы архива'));
    const view = element('pre', 'source-view'); const fileTitle = element('strong', 'source-title');
    const copy = button('Копировать файл', async () => { await navigator.clipboard.writeText(view.textContent); notify('Содержимое скопировано'); });
    for (const file of exportResult.files) settings.append(button(file.name, () => { view.textContent = file.content; fileTitle.textContent = file.name; }, 'file-button'));
    view.textContent = exportResult.files[0].content; fileTitle.textContent = exportResult.files[0].name;
    code.append(fileTitle, copy, view);
    const download = button('↓ Скачать ZIP', downloadExport, 'primary'); download.disabled = exportBusy; settings.append(download);
    for (const warning of exportResult.warnings || []) settings.append(element('p', 'muted', warning.message));
  } else code.append(element('div', 'empty', 'Подготовьте код — здесь появятся исходники и список файлов архива.'));
  layout.append(settings, code); main.append(layout);
  const instruction = element('section', 'properties export-instruction'); instruction.append(element('h2', '', 'Как запустить'), element('p', '', '1. Установите ' + spec.runtime + '. ' + spec.setup), element('p', '', '2. Распакуйте ZIP, скопируйте .env.example в .env и впишите токен от @BotFather.'), element('p', '', '3. В терминале из папки бота выполните: ' + spec.command), element('p', 'muted', 'Бот работает в личных чатах. Один экземпляр на токен; состояние пользователей хранится в памяти и сбрасывается после перезапуска.')); main.append(instruction);
}
async function exportRequest(zip) {
  const signature = scenarioSignature();
  const response = await fetch('/api/projects/' + draft.id + '/export' + (zip ? '/zip' : ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: draft, language: exportLanguage }) });
  if (!response.ok) { const data = await response.json(); if (data.errors) { if (signature === scenarioSignature()) exportResult = { errors: data.errors, signature }; return null; } throw Error(data.message || 'Не удалось подготовить экспорт'); }
  return zip ? response.blob() : response.json();
}
async function prepareExport() {
  if (exportBusy) return; exportBusy = true; render();
  const signature = scenarioSignature();
  try { const result = await exportRequest(false); if (result && signature === scenarioSignature()) exportResult = { ...result, signature }; }
  catch (error) { notify(error.message); }
  finally { exportBusy = false; render(); }
}
async function downloadExport() {
  if (exportBusy) return; exportBusy = true; const language = exportLanguage; render();
  try { const blob = await exportRequest(true); if (!blob) return render(); const url = URL.createObjectURL(blob); const link = element('a'); link.href = url; link.download = 'botforge-' + language + '.zip'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Архив подготовлен для скачивания'); }
  catch (error) { notify(error.message); } finally { exportBusy = false; render(); }
}
setInterval(() => {
  if (!draft || !previewState || previewBusy || previewStale()) return;
  const events = previewState.engine.tick(); if (events.length) { applyPreviewEvents(events); paintChat(); }
}, 500);
