const fs = require('node:fs/promises');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const { checkShape, validate } = require('./project');
async function generate(project, language) {
  if (!['python', 'javascript'].includes(language)) throw Object.assign(Error('Выберите Python или JavaScript'), { status: 400 });
  const shape = checkShape(project);
  if (shape) throw Object.assign(Error(shape), { status: 400 });
  const validation = validate(project);
  if (!validation.valid) return { ...validation, files: [] };
  const python = language === 'python';
  const bot = await fs.readFile(path.join(__dirname, 'templates', python ? 'bot.py' : 'bot.js'), 'utf8');
  const runtime = await fs.readFile(path.join(__dirname, python ? 'templates/runtime.py' : 'public/runtime.js'), 'utf8');
  const files = [
    { name: python ? 'bot.py' : 'bot.js', content: bot },
    { name: python ? 'runtime.py' : 'runtime.js', content: runtime },
    { name: 'project.json', content: JSON.stringify(project, null, 2) + '\n' },
    { name: '.env.example', content: 'BOT_TOKEN=\n' },
    { name: '.gitignore', content: '.env\n__pycache__/\n' },
    { name: 'README.md', content: '# Запуск Telegram-бота\n\n1. Установите ' + (python ? 'Python 3.10+' : 'Node.js 20+') + '. Внешние библиотеки не нужны.\n2. Создайте бота через @BotFather и получите токен. Не отправляйте его на сайт.\n3. Скопируйте `.env.example` в `.env` рядом с исходниками и заполните `BOT_TOKEN=ваш_токен`.\n4. Откройте терминал в папке архива и выполните `' + (python ? 'python3 bot.py' : 'node bot.js') + '`.\n5. Напишите боту /start в личном чате. Для остановки нажмите Ctrl+C.\n\nИнтернет нужен для Telegram Bot API. Запускайте только один экземпляр с одним токеном. Если установлен webhook, отключите его отдельно: генератор не удаляет чужие подключения автоматически.\n\nПоддерживаются личные чаты, команды, сообщения, кнопки, ввод, переменные, условия и настройки поведения из проекта. Состояние пользователей хранится в памяти и теряется после перезапуска. История удаления/редактирования зависит от возможностей Telegram; при отказе бот продолжает диалог. Ограничение частоты действует отдельно для каждого личного чата.\n\nНе публикуйте `.env`. В `project.json` находятся тексты и начальные значения переменных: не включайте туда секреты. Автоматические переходы ограничены 100 шагами. Длинные сообщения разбиваются на части.\n' }
  ];
  return { ...validation, files };
}
function archive(files) { return Buffer.from(zipSync(Object.fromEntries(files.map(file => [file.name, strToU8(file.content)])))); }
module.exports = { generate, archive };
