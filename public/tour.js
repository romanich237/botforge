(function () {
  let active = false, step = 0, projectId = null, card, pointer, frame;
  const steps = [
    ['Добавьте начало', 'Вот этот блок запускает бота. Перетащите «Старт» слева на полотно или просто нажмите на него.', '[data-block-type="start"]'],
    ['Добавьте сообщение', 'Теперь перетащите «Текст» на свободное место рядом со стартом. Это будет первый ответ бота.', '[data-block-type="text"]'],
    ['Напишите ответ', 'В подсвеченном поле справа напишите: «Привет! Это мой первый бот». Можно написать свой текст.', '[data-tour="message"]'],
    ['Соедините два блока', 'Потяните от цветной точки справа у «Старт» к точке слева у «Текст». На телефоне: выберите «Старт» и задайте переход в свойствах.', '.flow-canvas'],
    ['Попробуйте разговор', 'Откройте «Проверить чат» справа и нажмите «Запустить /start». Бот должен показать ваше сообщение.', '[data-tour="preview"]'],
    ['Сохраните своего бота', 'Нажмите «Сохранить». После этого проект можно открыть снова, а в разделе «Экспорт» скачать код.', '[data-tour="save"]']
  ];
  function done() {
    if (!draft || draft.id !== projectId) return false;
    const start = draft.nodes.find(n => n.type === 'start'), text = draft.nodes.find(n => n.type === 'text');
    return [!!start, !!text, !!text?.data.text?.trim(), !!(start && text && draft.edges.some(e => e.source === start.id && e.target === text.id && e.output === 'next')), !!(previewState?.engine.project.id === projectId && previewState.history.some(e => e.text === text?.data.text)), !dirty][step];
  }
  function stop() { active = false; card?.remove(); pointer?.remove(); document.querySelectorAll('.tour-target').forEach(e => e.classList.remove('tour-target')); }
  function paint() {
    if (!active) return;
    if (draft?.id !== projectId || location.hash !== '#builder') { stop(); return; }
    card?.remove(); pointer?.remove(); document.querySelectorAll('.tour-target').forEach(e => e.classList.remove('tour-target'));
    card = element('section', 'tour-coach'); card.setAttribute('aria-label', 'Практическое обучение'); card.setAttribute('aria-live', 'polite');
    const top = element('div', 'tour-heading'); const close = button('×', stop, 'icon-button'); close.setAttribute('aria-label', 'Закрыть обучение'); top.append(element('span', 'eyebrow', 'ПРАКТИКА · ' + (step + 1) + ' / ' + steps.length), close);
    card.append(top, element('h2', '', steps[step][0]), element('p', '', steps[step][1]));
    const complete = done(); card.append(element('p', complete ? 'tour-success' : 'muted', complete ? '✓ Получилось! Можно дальше.' : 'Выполните действие на экране.'));
    const controls = element('div', 'dialog-actions'); const back = button('Назад', () => { step--; reveal(); }); back.disabled = !step;
    const next = button(step === steps.length - 1 ? 'Готово!' : 'Далее →', () => { if (step === steps.length - 1) { stop(); notify('Вы создали и проверили первого бота!'); } else { step++; reveal(); } }, 'primary'); next.disabled = !complete; controls.append(back, next); card.append(controls); document.body.append(card);
    let targets = [document.querySelector(steps[step][2])];
    if (step === 3 && window.matchMedia('(max-width:650px)').matches) targets = [document.querySelector('.properties select')];
    if (step === 4 && document.querySelector('#preview-start')) targets = [document.querySelector('#preview-start')];
    if (step === 3 && !window.matchMedia('(max-width:650px)').matches) { const start = draft.nodes.find(n => n.type === 'start'), text = draft.nodes.find(n => n.type === 'text'); targets = [document.querySelector('[data-id="' + CSS.escape(start?.id || '') + '"] .react-flow__handle-right'), document.querySelector('[data-id="' + CSS.escape(text?.id || '') + '"] .react-flow__handle-left')]; }
    for (const target of targets) if (target?.getBoundingClientRect().width) target.classList.add('tour-target');
    const target = targets[0]; if (target?.getBoundingClientRect().width) { const r = target.getBoundingClientRect(); pointer = element('div', 'tour-pointer', '☝'); pointer.setAttribute('aria-hidden', 'true'); pointer.style.left = Math.max(8, Math.min(innerWidth - 48, r.left + r.width / 2 - 18)) + 'px'; pointer.style.top = Math.max(4, Math.min(innerHeight - 70, r.bottom + 3)) + 'px'; document.body.append(pointer); }
  }
  function update() { if (!active) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(paint); }
  function reveal() {
    if (window.matchMedia('(max-width:650px)').matches) editorTab = step < 2 ? 'blocks' : step === 2 || step === 3 ? 'properties' : step === 4 ? 'test' : 'canvas';
    if (step === 2) selectedNode = draft.nodes.find(n => n.type === 'text')?.id;
    if (step === 3) selectedNode = draft.nodes.find(n => n.type === 'start')?.id;
    render(); update(); setTimeout(update, 150);
  }
  async function start() {
    if (!leave()) return;
    stop(); const p = await api('', 'POST', {name:'Мой первый бот · обучение'}); projects.unshift(p); dirty = false; await openProject(p.id); projectId = p.id; active = true; step = 0; advancedBlocks = false; reveal();
  }
  document.addEventListener('click', update); document.addEventListener('input', update); window.addEventListener('resize', update); document.addEventListener('scroll', update, true);
  window.BotForgeTour = {start, update, stop};
})();
