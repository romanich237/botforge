import re
import math
import time
import uuid


class Session:
    def __init__(self, project, key=None):
        self.key = key or uuid.uuid4().hex[:8]
        self.project = project
        self.behavior = dict(unknownCommand=True, unknownText=True, help=True, cancel=True, disableOldButtons=True, repeatQuestion=True, preventDoubleClick=True)
        self.behavior.update(project['behavior'])
        self.sequence = 0
        self.menus = {}
        self.waiting = None
        self.current = None
        self.deadline = None
        self.times = []
        self.lastLimitNotice = None
        self.values = {v['name']: v['initial'] for v in project['variables']}

    def text(self, value):
        def string(v):
            return str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)
        return re.sub(r'\{([^{}]+)\}', lambda m: string(self.values[m[1]]) if m[1] in self.values else m[0], str(value or ''))

    def node(self, node_id):
        return next((n for n in self.project['nodes'] if n['id'] == node_id), None)

    def next(self, node_id, output='next'):
        return next((e['target'] for e in self.project['edges'] if e['source'] == node_id and e['output'] == output), None)

    def clear_menus(self):
        tokens = list(self.menus)
        links = {t: [dict(text=b['label'], url=b['url']) for b in self.menus[t]['buttons'] if b['action'] == 'url'] for t in tokens}
        self.menus = {}
        return [dict(type='disable', tokens=tokens, links=links)] if tokens else []

    def message(self, text, node=None):
        self.sequence += 1
        token = self.key + '-' + str(self.sequence)
        buttons = []
        if node and node['type'] == 'buttons':
            buttons = [dict(label=b['label'], action=b['action'], url=b.get('url'), callback=token + ':' + str(i)) for i, b in enumerate(node['data']['buttons'])]
        placement = node['data'].get('placement', 'inline') if node else 'inline'
        if buttons:
            self.menus[token] = dict(nodeId=node['id'], buttons=buttons, placement=placement)
        return dict(type='message', text=self.text(text), buttons=buttons, token=token, placement=placement)

    def run(self, node_id, now):
        events = []
        count = 0
        while node_id:
            if count == 100:
                self.waiting = self.deadline = None
                events.append(dict(type='error', text='Возможный цикл: 100 переходов без ожидания пользователя', nodeId=node_id))
                break
            count += 1
            node = self.node(node_id)
            if not node:
                events.append(dict(type='error', text='Блок не найден', nodeId=node_id))
                break
            self.current = node_id
            d = node['data']
            kind = node['type']
            if kind in ('text', 'buttons', 'input'):
                events.append(self.message(d['text'], node))
            if kind == 'input':
                self.waiting = node_id
                self.deadline = now + self.behavior['timeoutSeconds'] * 1000 if self.behavior.get('inputTimeout') else None
                break
            if kind in ('buttons', 'end'):
                self.waiting = self.deadline = None
                break
            if kind == 'condition':
                left = self.values[d['variable']]
                right = float(d['value']) if isinstance(left, (int, float)) else d['value']
                yes = {'eq': lambda: left == right, 'ne': lambda: left != right, 'contains': lambda: str(d['value']) in (str(int(left)) if isinstance(left, float) and left.is_integer() else str(left)), 'gt': lambda: left > right, 'lt': lambda: left < right}[d['operation']]()
                node_id = self.next(node_id, 'yes' if yes else 'no')
            else:
                node_id = self.next(node_id)
        return events

    def tick(self, now=None):
        now = time.time() * 1000 if now is None else now
        if self.deadline is not None and now >= self.deadline:
            self.waiting = self.deadline = None
            return [self.message(self.behavior.get('timeoutText') or 'Время ожидания истекло.')]
        return []

    def handle(self, event, now=None):
        now = time.time() * 1000 if now is None else now
        events = self.tick(now)
        b = self.behavior
        if b.get('rateLimit'):
            self.times = [t for t in self.times if now - t < b['rateSeconds'] * 1000]
            if len(self.times) >= b['rateCount']:
                if self.lastLimitNotice is None or now - self.lastLimitNotice >= b['rateSeconds'] * 1000:
                    events.append(self.message('Слишком много сообщений. Попробуйте позже.'))
                    self.lastLimitNotice = now
                return events
            self.times.append(now)
        target = None
        if event.get('callback'):
            parts = str(event['callback']).split(':')
            menu = self.menus.get(parts[0])
            index = int(parts[1]) if len(parts) == 2 and parts[1].isascii() and parts[1].isdigit() else -1
            choice = menu['buttons'][index] if menu and 0 <= index < len(menu['buttons']) else None
            if not choice or choice['action'] != 'transition':
                return events + [dict(type='notice', text='Эта кнопка больше не активна.')]
            target = self.next(menu['nodeId'], self.node(menu['nodeId'])['data']['buttons'][index]['id'])
        else:
            text = str(event.get('text', '')).strip()
            raw = re.sub(r'@[A-Za-z0-9_]+$', '', text.split()[0] if text else '')
            cmd = raw.lower() if b.get('ignoreCase') else raw
            start = next((n['id'] for n in self.project['nodes'] if n['type'] == 'start'), None)
            if cmd == '/start':
                events += self.clear_menus()
                self.values = {v['name']: v['initial'] for v in self.project['variables']}
                self.waiting = self.deadline = None
                return events + self.run(start, now) if start else events + [dict(type='error', text='Добавьте блок «Старт»', nodeId=None)]
            if cmd == '/help' and b.get('help'):
                commands = ['/start — Начать заново'] + [n['data']['command'] + (' — ' + n['data']['description'] if n['data'].get('description') else '') for n in self.project['nodes'] if n['type'] == 'command']
                if b.get('cancel'):
                    commands.append('/cancel — Отменить ввод')
                return events + [self.message('\n'.join(commands))]
            if cmd == '/cancel' and b.get('cancel'):
                self.waiting = self.deadline = None
                if b.get('disableOldButtons'):
                    events += self.clear_menus()
                return events + self.run(start, now)
            command = next((n for n in self.project['nodes'] if n['type'] == 'command' and (n['data']['command'].lower() if b.get('ignoreCase') else n['data']['command']) == cmd), None)
            if command:
                target = command['id']
            elif text.startswith('/'):
                return events + [self.message(b.get('unknownCommandText') or 'Неизвестная команда. Введите /help')] if b.get('unknownCommand') else events
            else:
                keyboard = next((m for m in reversed(list(self.menus.values())) if m['placement'] == 'keyboard' and any(c['label'] == text for c in m['buttons'])), None)
                if keyboard:
                    index = next(i for i, c in enumerate(keyboard['buttons']) if c['label'] == text)
                    target = self.next(keyboard['nodeId'], self.node(keyboard['nodeId'])['data']['buttons'][index]['id'])
                elif self.waiting:
                    node = self.node(self.waiting)
                    d = node['data']
                    numeric = bool(re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?', text)) and math.isfinite(float(text))
                    kind = d['validation']
                    ok = bool(text) if kind == 'text' else numeric if kind == 'number' else bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', text)) if kind == 'email' else text in [s.strip() for s in d['choices'].split(',')]
                    variable = next(v for v in self.project['variables'] if v['name'] == d['variable'])
                    if not ok or (variable['type'] == 'number' and not numeric):
                        return events + [self.message(d.get('error') or 'Проверьте введённое значение')] + ([self.message(d['text'])] if b.get('repeatQuestion') else [])
                    self.values[d['variable']] = float(text) if variable['type'] == 'number' else text
                    target = self.next(node['id'])
                else:
                    return events + [self.message(b.get('unknownTextMessage') or 'Не понимаю. Введите /help')] if b.get('unknownText') else events
        self.waiting = self.deadline = None
        if b.get('disableOldButtons'):
            events += self.clear_menus()
        return events + self.run(target, now)
