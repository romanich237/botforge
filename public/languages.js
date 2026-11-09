(function (root) {
  const languages = {
    python: { name: 'Python', runtime: 'Python 3.10+', setup: 'Внешние библиотеки не нужны.', command: 'python3 bot.py' },
    javascript: { name: 'JavaScript', runtime: 'Node.js 20+', setup: 'Внешние библиотеки не нужны.', command: 'node bot.js' },
    typescript: { name: 'TypeScript', runtime: 'Node.js 20+ и npm', setup: 'Установите зависимости командой npm install, затем выполните npm run build.', command: 'npm start' },
    go: { name: 'Go', runtime: 'Go 1.22+', setup: 'Используется только стандартная библиотека Go.', command: 'go run .' }
  };
  if (typeof module !== 'undefined') module.exports = languages; else root.BotForgeLanguages = languages;
})(typeof window !== 'undefined' ? window : globalThis);
