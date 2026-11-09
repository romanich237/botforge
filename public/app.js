const main = document.querySelector('#main');
const dialog = document.querySelector('#create-dialog');
const storageKey = 'botforge.projects.v1';
let projects = [];
let selectedId = null;
let storageError = false;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (!Array.isArray(saved) || saved.some(p => !p || typeof p.id !== 'string' || typeof p.name !== 'string' || !Number.isFinite(p.updatedAt))) {
    throw new Error('Invalid project data');
  }
  projects = saved;
} catch {
  storageError = true;
}

const titles = {
  projects: 'Мои проекты', builder: 'Конструктор', behavior: 'Поведение бота',
  variables: 'Переменные', testing: 'Тестирование', export: 'Экспорт кода', settings: 'Настройки'
};
const descriptions = {
  behavior: 'Автоответы, навигация и история сообщений.',
  variables: 'Переменные проекта и их начальные значения.',
  testing: 'Проверка сценария и состояния переменных.',
  export: 'Проверка проекта и скачивание исходного кода.',
  settings: 'Название, описание и параметры проекта.'
};
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 4500);
}
function save(next) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
    projects = next;
    storageError = false;
    return true;
  } catch {
    notify('Не удалось сохранить проект в браузере. Попробуйте ещё раз.');
    return false;
  }
}
function openCreate() {
  document.querySelector('#create-form').reset();
  dialog.showModal();
}
function projectCard(project) {
  const card = element('article', 'project-card');
  const top = element('div', 'card-top');
  const title = element('div');
  title.append(element('h2', '', project.name), element('span', 'platform-tag', '↗ Telegram'));
  top.append(element('div', 'project-icon', '▣'), title);
  card.append(top, element('p', 'muted', 'Изменён: ' + new Date(project.updatedAt).toLocaleDateString('ru-RU')));
  const actions = element('div', 'card-actions');
  const open = element('button', 'open', 'Открыть →');
  open.onclick = () => { selectedId = project.id; location.hash = 'builder'; };
  const remove = element('button', 'icon-button', '×');
  remove.setAttribute('aria-label', 'Удалить проект «' + project.name + '»');
  remove.onclick = () => {
    if (confirm('Удалить проект «' + project.name + '»?')) {
      if (save(projects.filter(p => p.id !== project.id))) render();
    }
  };
  actions.append(open, remove);
  card.append(actions);
  return card;
}
function renderProjects() {
  const heading = element('div', 'page-heading');
  const intro = element('div');
  intro.append(element('h1', '', titles.projects), element('p', '', 'Создавайте ботов и собирайте сценарии в одном месте.'));
  const create = element('button', 'primary', '+ Создать бота');
  create.onclick = openCreate;
  heading.append(intro, create);
  const toolbar = element('div', 'toolbar');
  const search = element('input');
  search.type = 'search';
  search.placeholder = 'Поиск по проектам…';
  search.setAttribute('aria-label', 'Поиск по проектам');
  toolbar.append(search, element('span', 'platform-tag', '↗ Telegram'));
  const results = element('div');
  function update() {
    results.replaceChildren();
    const filtered = projects.filter(p => p.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
    if (filtered.length) {
      results.className = 'project-grid';
      results.append(...filtered.map(projectCard));
    } else {
      results.className = 'empty';
      results.append(element('h2', '', projects.length ? 'Ничего не найдено' : 'Здесь будут ваши боты'), element('p', 'muted', projects.length ? 'Попробуйте другое название.' : 'Создайте первый проект для Telegram.'));
      if (!projects.length) {
        const button = element('button', 'primary', 'Создать первого бота');
        button.onclick = openCreate;
        results.append(button);
      }
    }
  }
  search.oninput = update;
  update();
  main.append(heading, toolbar);
  if (storageError) main.append(element('p', '', 'Не удалось прочитать сохранённые проекты. Данные не перезаписаны. Попробуйте перезагрузить страницу.'));
  main.append(results, element('p', 'stage-note', 'Этап 1 из 7 · Проекты хранятся в этом браузере. Серверное сохранение пока не подключено.'));
}
function renderBuilder() {
  main.innerHTML = `
    <div class="page-heading"><div><h1>Конструктор</h1><p>Макет рабочего пространства · редактирование появится на этапе 2</p></div></div>
    <section class="builder" aria-label="Макет конструктора">
      <aside class="library"><h2>Библиотека блоков</h2><div>▷ Старт</div><div>⌘ Команда</div><div>Т Текст</div><div>▦ Кнопки</div><div>⌨ Ввод данных</div><div>◇ Условие</div><div>□ Завершение</div></aside>
      <div class="canvas"><div class="flow"><div class="node start"><strong>▷ /start</strong>Начало</div><span class="arrow">→</span><div class="node"><strong>Т Приветствие</strong><p>Привет! Выберите раздел</p><span>Каталог</span><span>Контакты</span></div></div></div>
      <aside class="preview"><h2>Предпросмотр</h2><small>Демонстрация внешнего вида.<br>Telegram не подключён.</small><div class="bubble">Привет! Выберите раздел<button disabled>Каталог</button><button disabled>Контакты</button></div></aside>
    </section><p class="stage-note">Схема иллюстративная. Добавление блоков, связи и выполнение сценариев будут реализованы отдельно.</p>`;
}
function render() {
  const requested = location.hash.slice(1) || 'projects';
  const page = Object.hasOwn(titles, requested) ? requested : 'projects';
  main.replaceChildren();
  document.title = 'BotForge · ' + titles[page];
  const selected = projects.find(p => p.id === selectedId);
  document.querySelector('#breadcrumb').textContent = selected && page !== 'projects' ? selected.name : 'Рабочее пространство';
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === page;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (page === 'projects') return renderProjects();
  if (page === 'builder') return renderBuilder();
  const heading = element('div', 'page-heading');
  heading.append(element('h1', '', titles[page]));
  const panel = element('section', 'placeholder');
  panel.append(element('h2', '', 'Следующий этап'), element('p', '', descriptions[page]), element('p', 'muted', 'Раздел запланирован. Сейчас готов каркас интерфейса и управление локальными проектами.'));
  main.append(heading, panel);
}
document.querySelector('#close-dialog').onclick = () => dialog.close();
document.querySelector('#cancel-dialog').onclick = () => dialog.close();
document.querySelector('#create-form').onsubmit = event => {
  event.preventDefault();
  const field = document.querySelector('#bot-name');
  const name = field.value.trim();
  field.setCustomValidity(name ? '' : 'Введите название бота');
  if (!field.reportValidity()) return;
  if (storageError && !confirm('Сохранённые данные не прочитаны. Создание проекта заменит их. Продолжить?')) return;
  const project = { id: crypto.randomUUID(), name, platform: 'telegram', updatedAt: Date.now() };
  if (!save([...projects, project])) return;
  dialog.close();
  location.hash = 'projects';
  render();
  notify('Проект создан и сохранён в этом браузере');
};
document.querySelector('#bot-name').oninput = event => event.target.setCustomValidity('');
window.addEventListener('hashchange', render);
render();
