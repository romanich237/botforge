import json
import os
import re
import time
import urllib.request
import urllib.error
from pathlib import Path
from runtime import Session
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

BASE = Path(__file__).resolve().parent
PROJECT = json.loads((BASE / 'project.json').read_text(encoding='utf-8'))
if (BASE / '.env').exists():
    for line in (BASE / '.env').read_text(encoding='utf-8').splitlines():
        m = re.fullmatch(r'BOT_TOKEN\s*=\s*(.*?)\s*', line)
        if m and not os.environ.get('BOT_TOKEN'):
            os.environ['BOT_TOKEN'] = m[1].strip('\'"')
TOKEN = os.environ.get('BOT_TOKEN', '')


def telegram(method, data):
    request = urllib.request.Request('https://api.telegram.org/bot' + TOKEN + '/' + method, data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            result = json.load(error)
        except Exception:
            raise RuntimeError('Ошибка Telegram HTTP ' + str(error.code)) from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError('Нет соединения с Telegram') from None
    if not result.get('ok'):
        pause = result.get('parameters', {}).get('retry_after', 0)
        if pause:
            time.sleep(pause)
        raise RuntimeError(method + ': ' + result.get('description', 'Ошибка Telegram'))
    return result['result']


def markup(event):
    buttons = event.get('buttons', [])
    columns = max(1, min(4, int(event.get('columns') or 1)))
    rows = []
    for i in range(0, len(buttons), columns):
        rows.append([dict(text=b['label'], **({} if event.get('placement') == 'keyboard' else {'url': b['url']} if b['action'] == 'url' else {'callback_data': b['callback']})) for b in buttons[i:i + columns]])
    if event.get('placement') == 'keyboard' and buttons:
        return dict(keyboard=rows, resize_keyboard=True, one_time_keyboard=bool(event.get('oneTime')))
    if buttons:
        return dict(inline_keyboard=rows)
    return dict(remove_keyboard=True)

def deliver(session, events, call=telegram):
    b = session['engine'].behavior
    chat_id = session['chatId']
    for event in events:
        if event['type'] == 'disable':
            for key in event['tokens']:
                message_id = session['messages'].pop(key, None)
                if message_id:
                    try:
                        call('editMessageReplyMarkup', dict(chat_id=chat_id, message_id=message_id, reply_markup=dict(inline_keyboard=[[b] for b in event.get('links', {}).get(key, [])])))
                    except RuntimeError:
                        print('Не удалось отключить старую клавиатуру')
            continue
        if event['type'] == 'notice':
            continue
        if b.get('typing'):
            try:
                call('sendChatAction', dict(chat_id=chat_id, action='typing'))
            except RuntimeError:
                pass
        text = event.get('text') or 'Сценарий завершён'
        chunks = [text[i:i + 4000] for i in range(0, len(text), 4000)]
        for i, chunk in enumerate(chunks):
            last = i == len(chunks) - 1
            reply_markup = markup(event) if last else dict(remove_keyboard=True)
            result = None
            if b.get('history') == 'update' and session['lastMessage'] and session.get('lastPlacement') != 'keyboard' and 'keyboard' not in reply_markup:
                try:
                    result = call('editMessageText', dict(chat_id=chat_id, message_id=session['lastMessage'], text=chunk, reply_markup=dict(inline_keyboard=reply_markup.get('inline_keyboard', []))))
                except RuntimeError:
                    print('Обновление недоступно, отправляем новое сообщение')
            if not result:
                if b.get('history') == 'delete' and session['lastMessage']:
                    try:
                        call('deleteMessage', dict(chat_id=chat_id, message_id=session['lastMessage']))
                    except RuntimeError:
                        print('Удаление недоступно, диалог продолжается')
                result = call('sendMessage', dict(chat_id=chat_id, text=chunk, reply_markup=reply_markup))
            session['lastMessage'] = result['message_id']
            session['lastPlacement'] = event.get('placement', 'inline')
            if last and event.get('buttons'):
                session['messages'][event['token']] = result['message_id']


class Dispatcher:
    def __init__(self, engine, executor):
        self.engine = engine
        self.executor = executor
        self.lock = Lock()
        self.queue = deque()
        self.busy = False

    def submit(self, task, is_callback=False):
        with self.lock:
            if is_callback and self.busy and self.engine.behavior.get('preventDoubleClick'):
                return False
            self.queue.append(task)
            if not self.busy:
                self.busy = True
                self.executor.submit(self.drain)
            return True

    def drain(self):
        while True:
            with self.lock:
                if not self.queue:
                    self.busy = False
                    return
                task = self.queue.popleft()
            try:
                task()
            except Exception as error:
                print(str(error))


def main():
    if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+', TOKEN):
        raise RuntimeError('Укажите BOT_TOKEN в локальном .env')
    if telegram('getWebhookInfo', {}).get('url'):
        raise RuntimeError('У бота установлен webhook. Отключите его перед запуском polling.')
    sessions = {}
    executor = ThreadPoolExecutor(max_workers=8)
    offset = 0
    print('Бот запущен. Для остановки нажмите Ctrl+C.')
    while True:
        try:
            updates = telegram('getUpdates', dict(offset=offset, timeout=1, allowed_updates=['message', 'callback_query']))
            for update in updates:
                offset = update['update_id'] + 1
                callback = update.get('callback_query')
                message = callback.get('message') if callback else update.get('message')
                if not message or message['chat']['type'] != 'private':
                    continue
                if callback:
                    try:
                        telegram('answerCallbackQuery', dict(callback_query_id=callback['id']))
                    except RuntimeError:
                        pass
                key = str(message['chat']['id'])
                if key not in sessions:
                    sessions[key] = dict(engine=Session(PROJECT), chatId=message['chat']['id'], messages={}, lastMessage=None)
                    sessions[key]['dispatcher'] = Dispatcher(sessions[key]['engine'], executor)
                session = sessions[key]
                event = dict(callback=callback.get('data', '')) if callback else dict(text=message.get('text', ''))
                def process(s=session, e=event, m=message, cb=callback):
                    channel = PROJECT.get('behavior', {}).get('subscriptionChat')
                    if channel:
                        try:
                            member = telegram('getChatMember', dict(chat_id=channel, user_id=m['chat']['id']))
                            allowed = member.get('status') in ('creator', 'administrator', 'member') or (member.get('status') == 'restricted' and member.get('is_member'))
                        except RuntimeError as exc:
                            print('Не удалось проверить подписку:', exc)
                            allowed = False
                        if not allowed:
                            if not cb:
                                telegram('sendMessage', dict(chat_id=m['chat']['id'], text=PROJECT.get('behavior', {}).get('subscriptionMessage') or 'Подпишитесь на канал и повторите попытку.'))
                            return
                    deliver(s, s['engine'].handle(e))
                    if not cb and s['engine'].behavior.get('deleteUser'):
                        try:
                            telegram('deleteMessage', dict(chat_id=m['chat']['id'], message_id=m['message_id']))
                        except RuntimeError:
                            print('Нет возможности удалить сообщение пользователя')
                session['dispatcher'].submit(process, bool(callback))
            for session in sessions.values():
                if not session['dispatcher'].busy:
                    session['dispatcher'].submit(lambda s=session: deliver(s, s['engine'].tick()))
        except (RuntimeError, OSError, ValueError) as error:
            print(str(error))
            time.sleep(2)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('Бот остановлен')
    except RuntimeError as error:
        raise SystemExit(str(error))
