(function (root) {
  const steps = [
    { title: 'Создайте проект', text: 'В разделе «Проекты» нажмите «Создать бота», задайте название и откройте проект. Для первого знакомства можно создать отдельный учебный пример.' },
    { title: 'Добавьте блоки', text: 'Нажмите на тип блока в левой панели. «Старт» запускает сценарий по /start, «Текст» отправляет сообщение, «Кнопки» предлагает выбор. Нажмите на блок, чтобы открыть его свойства.' },
    { title: 'Соедините сценарий', text: 'Перетащите точку справа от блока к точке слева у следующего. У каждой кнопки и ветки условия свой выход. На телефоне можно выбрать переход в свойствах без перетаскивания.' },
    { title: 'Настройте ответы', text: 'Введите текст сообщения в свойствах. Для персональных ответов создайте переменную в разделе «Переменные», выберите её в блоке «Ввод данных» и вставьте в текст: например, {имя}.' },
    { title: 'Проверьте и сохраните', text: 'Нажмите «Проверить»: ошибки помогут найти незаполненные блоки и переходы. Затем нажмите «Сохранить» и дождитесь подтверждения. Предпросмотр диалога и скачивание кода пока в разработке.' }
  ];
  function checklist(project, dirty) {
    return [
      { label: 'Добавьте блок «Старт»', done: project.nodes.some(n => n.type === 'start') },
      { label: 'Напишите первое сообщение', done: project.nodes.some(n => ['text', 'buttons', 'input'].includes(n.type) && n.data.text?.trim()) },
      { label: 'Соедините блоки', done: project.edges.length > 0 },
      { label: 'Сохраните изменения', done: project.nodes.length > 0 && !dirty }
    ];
  }
  function example(id) {
    const start = id(), menu = id(), yes = id(), no = id(), first = id(), second = id();
    return { name: 'Мой первый бот · пример', nodes: [
      { id: start, type: 'start', x: 0, y: 120, data: {} },
      { id: menu, type: 'buttons', x: 340, y: 120, data: { text: 'Привет! Чем помочь?', placement: 'inline', buttons: [{ id: first, label: 'О проекте', action: 'transition' }, { id: second, label: 'Контакты', action: 'transition' }] } },
      { id: yes, type: 'text', x: 700, y: 0, data: { text: 'Мы создаём удобных ботов без программирования.' } },
      { id: no, type: 'text', x: 700, y: 300, data: { text: 'Напишите нам: hello@example.com' } }
    ], edges: [ { id: id(), source: start, output: 'next', target: menu }, { id: id(), source: menu, output: first, target: yes }, { id: id(), source: menu, output: second, target: no } ] };
  }
  const guide = { steps, checklist, example };
  if (typeof module !== 'undefined') module.exports = guide;
  else root.BotForgeGuide = guide;
})(typeof window !== 'undefined' ? window : globalThis);
