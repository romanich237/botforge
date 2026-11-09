(function (root) {
  class Session {
    constructor(project, key = crypto.randomUUID().slice(0, 8)) {
      this.key = key;
      this.project = JSON.parse(JSON.stringify(project));
      this.behavior = { unknownCommand: true, unknownText: true, help: true, cancel: true, disableOldButtons: true, repeatQuestion: true, preventDoubleClick: true, ...project.behavior };
      this.sequence = 0; this.menus = {}; this.waiting = null; this.current = null; this.deadline = null; this.times = []; this.lastLimitNotice = null;
      this.values = Object.fromEntries(project.variables.map(v => [v.name, v.initial]));
    }
    text(value) { return String(value ?? '').replace(/\{([^{}]+)\}/g, (_, key) => Object.hasOwn(this.values, key) ? String(this.values[key]) : '{' + key + '}'); }
    next(id, output = 'next') { return this.project.edges.find(e => e.source === id && e.output === output)?.target || null; }
    clearMenus() { const tokens = Object.keys(this.menus); const links = Object.fromEntries(tokens.map(t => [t, this.menus[t].buttons.filter(b => b.action === 'url').map(b => ({ text: b.label, url: b.url }))])); this.menus = {}; return tokens.length ? [{ type: 'disable', tokens, links }] : []; }
    message(text, node, now) {
      const token = this.key + '-' + String(++this.sequence);
      const buttons = node?.type === 'buttons' ? node.data.buttons.map((b, i) => ({ label: b.label, action: b.action, url: b.url || null, callback: token + ':' + i })) : [];
      if (buttons.length) this.menus[token] = { nodeId: node.id, buttons, placement: node.data.placement || 'inline' };
      return { type: 'message', text: this.text(text), buttons, token, placement: node?.data.placement || 'inline' };
    }
    run(id, now) {
      const events = [];
      for (let count = 0; id; count++) {
        if (count === 100) { this.waiting = null; this.deadline = null; events.push({ type: 'error', text: 'Возможный цикл: 100 переходов без ожидания пользователя', nodeId: id }); break; }
        const node = this.project.nodes.find(n => n.id === id);
        if (!node) { events.push({ type: 'error', text: 'Блок не найден', nodeId: id }); break; }
        this.current = node.id; const d = node.data;
        if (['text', 'buttons', 'input'].includes(node.type)) events.push(this.message(d.text, node, now));
        if (node.type === 'input') { this.waiting = node.id; this.deadline = this.behavior.inputTimeout ? now + this.behavior.timeoutSeconds * 1000 : null; break; }
        if (node.type === 'buttons' || node.type === 'end') { this.waiting = null; this.deadline = null; break; }
        if (node.type === 'condition') {
          const left = this.values[d.variable], right = typeof left === 'number' ? Number(d.value) : d.value;
          const yes = { eq: () => left === right, ne: () => left !== right, contains: () => String(left).includes(String(right)), gt: () => left > right, lt: () => left < right }[d.operation]();
          id = this.next(id, yes ? 'yes' : 'no');
        } else id = this.next(id);
      }
      return events;
    }
    tick(now = Date.now()) {
      if (this.deadline !== null && now >= this.deadline) { this.waiting = null; this.deadline = null; return [this.message(this.behavior.timeoutText || 'Время ожидания истекло.')]; }
      return [];
    }
    handle(event, now = Date.now()) {
      const events = this.tick(now), b = this.behavior;
      if (b.rateLimit) {
        this.times = this.times.filter(t => now - t < b.rateSeconds * 1000);
        if (this.times.length >= b.rateCount) {
          if (this.lastLimitNotice === null || now - this.lastLimitNotice >= b.rateSeconds * 1000) { events.push(this.message('Слишком много сообщений. Попробуйте позже.')); this.lastLimitNotice = now; }
          return events;
        }
        this.times.push(now);
      }
      let target = null;
      if (event.callback) {
        if (!/^[a-f0-9-]+:[0-9]+$/.test(String(event.callback))) return events;
        const [token, index] = String(event.callback).split(':'); const menu = this.menus[token];
        const choice = menu?.buttons[Number(index)];
        if (!choice || choice.action !== 'transition') return [...events, { type: 'notice', text: 'Эта кнопка больше не активна.' }];
        target = this.next(menu.nodeId, this.project.nodes.find(n => n.id === menu.nodeId).data.buttons[Number(index)].id);
      } else {
        const text = String(event.text || '').trim(); const raw = text.split(/\s/)[0].replace(/@[A-Za-z0-9_]+$/, ''); const cmd = b.ignoreCase ? raw.toLowerCase() : raw;
        if (cmd === '/start') {
          events.push(...this.clearMenus()); this.values = Object.fromEntries(this.project.variables.map(v => [v.name, v.initial])); this.waiting = null; this.deadline = null;
          const start = this.project.nodes.find(n => n.type === 'start');
          return start ? [...events, ...this.run(start.id, now)] : [...events, { type: 'error', text: 'Добавьте блок «Старт»', nodeId: null }];
        }
        if (cmd === '/help' && b.help) return [...events, this.message(['/start — Начать заново', ...this.project.nodes.filter(n => n.type === 'command').map(n => n.data.command + (n.data.description ? ' — ' + n.data.description : '')), ...(b.cancel ? ['/cancel — Отменить ввод'] : [])].join('\n'))];
        if (cmd === '/cancel' && b.cancel) { this.waiting = null; this.deadline = null; if (b.disableOldButtons) events.push(...this.clearMenus()); return [...events, ...this.run(this.project.nodes.find(n => n.type === 'start')?.id, now)]; }
        const command = this.project.nodes.find(n => n.type === 'command' && (b.ignoreCase ? n.data.command.toLowerCase() : n.data.command) === cmd);
        if (command) target = command.id;
        else if (text.startsWith('/')) return b.unknownCommand ? [...events, this.message(b.unknownCommandText || 'Неизвестная команда. Введите /help')] : events;
        else {
          const keyboard = Object.entries(this.menus).reverse().find(([, m]) => m.placement === 'keyboard' && m.buttons.some(c => c.label === text));
          if (keyboard) {
            const menu = keyboard[1], index = menu.buttons.findIndex(c => c.label === text);
            target = this.next(menu.nodeId, this.project.nodes.find(n => n.id === menu.nodeId).data.buttons[index].id);
          } else if (this.waiting) {
            const node = this.project.nodes.find(n => n.id === this.waiting); const d = node.data;
            const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) && Number.isFinite(Number(text));
            const ok = d.validation === 'text' ? !!text : d.validation === 'number' ? numeric : d.validation === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) : d.choices.split(',').map(s => s.trim()).includes(text);
            const variable = this.project.variables.find(v => v.name === d.variable);
            if (!ok || (variable.type === 'number' && !numeric)) return [...events, this.message(d.error || 'Проверьте введённое значение'), ...(b.repeatQuestion ? [this.message(d.text)] : [])];
            this.values[d.variable] = variable.type === 'number' ? Number(text) : text; target = this.next(node.id);
          } else return b.unknownText ? [...events, this.message(b.unknownTextMessage || 'Не понимаю. Введите /help')] : events;
        }
      }
      this.waiting = null; this.deadline = null;
      if (b.disableOldButtons) events.push(...this.clearMenus());
      return [...events, ...this.run(target, now)];
    }
  }
  if (typeof module !== 'undefined') module.exports = { Session }; else root.BotForgeRuntime = { Session };
})(typeof window !== 'undefined' ? window : globalThis);
