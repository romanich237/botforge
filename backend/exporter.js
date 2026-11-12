const fs = require('node:fs/promises');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const { checkShape, validate } = require('./project');
const languages = require('../frontend/public/languages');
async function generate(project, language) {
  if (language !== 'all' && !Object.hasOwn(languages, language)) throw Object.assign(Error('Выберите Python, JavaScript, TypeScript или Go'), { status: 400 });
  const shape = checkShape(project);
  if (shape) throw Object.assign(Error(shape), { status: 400 });
  const validation = validate(project);
  if (!validation.valid) return { ...validation, files: [] };
  if (language === 'all') {
    const variants = await Promise.all(Object.keys(languages).map(async name => ({ name, result: await generate(project, name) })));
    const files = [{ name: 'botforge-project/project.json', content: JSON.stringify(project, null, 2) + '\n' }, { name: 'botforge-project/README.md', content: '# Полный проект BotForge\n\nproject.json содержит сценарий, координаты блоков, связи, переменные и настройки.\n\nВ папках python, javascript, typescript и go — самостоятельные варианты бота с исходным кодом, настройками и инструкцией запуска. Выберите один язык и следуйте README.md в его папке. Токен Telegram получите у @BotFather и заполните локальный .env.\n\nВнутри ZIP нет ключа ИИ и данных Google-входа. Начальные значения переменных и тексты сценария входят в project.json: перед публикацией проверьте их.\n' }];
    for (const variant of variants) for (const file of variant.result.files) files.push({ ...file, name: 'botforge-project/' + variant.name + '/' + file.name });
    return { ...validation, files };
  }
  const spec = languages[language];
  const read = async (name, source) => ({ name, content: await fs.readFile(path.join(__dirname, source), 'utf8') });
  let files;
  if (language === 'go') {
    files = await Promise.all(['main.go', 'runtime.go', 'go.mod'].map(name => read(name, 'templates/go/' + name)));
  } else if (language === 'typescript') {
    files = await Promise.all([read('bot.ts', 'templates/bot.ts'), read('runtime.js', '../frontend/public/runtime.js'), read('runtime.d.ts', 'templates/runtime.d.ts')]);
    files.push({ name: 'package.json', content: JSON.stringify({ name: 'botforge-bot', version: '1.0.0', private: true, type: 'commonjs', engines: { node: '>=20' }, scripts: { build: 'tsc', start: 'node dist/bot.js' }, devDependencies: { typescript: require('../package-lock.json').packages['node_modules/typescript'].version, '@types/node': require('../package-lock.json').packages['node_modules/@types/node'].version } }, null, 2) + '\n' });
    files.push({ name: 'tsconfig.json', content: JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', outDir: 'dist', rootDir: '.', strict: true, allowJs: true, checkJs: false, skipLibCheck: true, types: ['node'] }, include: ['bot.ts', 'runtime.js'] }, null, 2) + '\n' });
  } else {
    const python = language === 'python';
    files = await Promise.all([read(python ? 'bot.py' : 'bot.js', python ? 'templates/bot.py' : 'templates/bot.js'), read(python ? 'runtime.py' : 'runtime.js', python ? 'templates/runtime.py' : '../frontend/public/runtime.js')]);
  }
  files.push(
    { name: 'project.json', content: JSON.stringify(project, null, 2) + '\n' },
    { name: '.env.example', content: 'BOT_TOKEN=\n' },
    { name: '.gitignore', content: '.env\n__pycache__/\nnode_modules/\ndist/\nbotforge-bot\nbotforge-bot.exe\n' },
    { name: 'README.md', content: '# Запуск Telegram-бота · ' + spec.name + '\n\n1. Установите ' + spec.runtime + '. ' + spec.setup + '\n2. Создайте бота через @BotFather и получите токен. Не отправляйте его на сайт.\n3. Скопируйте `.env.example` в `.env` рядом с `project.json` и заполните `BOT_TOKEN=ваш_токен`.\n4. Откройте терминал в папке архива и выполните `' + spec.command + '`.\n5. Напишите боту /start в личном чате. Для остановки нажмите Ctrl+C.\n\nИнтернет нужен для Telegram Bot API. Запускайте только один экземпляр с одним токеном. Если установлен webhook, отключите его отдельно: генератор не удаляет чужие подключения автоматически.\n\nПоддерживаются личные чаты, команды, сообщения, кнопки, ввод, переменные, условия и настройки поведения из проекта. Состояние пользователей хранится в памяти и теряется после перезапуска. История удаления/редактирования зависит от возможностей Telegram; при отказе бот продолжает диалог. Ограничение частоты действует отдельно для каждого пользователя.\n\nНе публикуйте `.env`. В `project.json` находятся тексты и начальные значения переменных: не включайте туда секреты. Автоматические переходы ограничены 100 шагами. Длинные сообщения разбиваются на части.\n' }
  );
  return { ...validation, files };
}
function archive(files) { return Buffer.from(zipSync(Object.fromEntries(files.map(file => [file.name, strToU8(file.content)])))); }
module.exports = { generate, archive };
