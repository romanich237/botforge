type BotEvent = {
  type: string;
  text?: string;
  token?: string;
  placement?: string;
  buttons?: Array<{ label: string; action: string; url?: string | null; callback: string }>;
  tokens?: string[];
  links?: Record<string, Array<{ text: string; url: string }>>;
};
type BotSession = {
  engine: Session;
  chatId: number;
  messages: Record<string, number>;
  lastMessage: number | null;
  lastPlacement?: string;
  pending?: number;
  chain?: Promise<void>;
};
type TelegramError = Error & { retryAfter?: number };
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Session } from './runtime';
const base = path.resolve(__dirname, '..');
const project = JSON.parse(fs.readFileSync(path.join(base, 'project.json'), 'utf8'));
const envFile = path.join(base, '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^BOT_TOKEN\s*=\s*(.*?)\s*$/);
  if (m && !process.env.BOT_TOKEN) process.env.BOT_TOKEN = m[1].replace(/^(['"])(.*)\1$/, '$2');
}
const token = process.env.BOT_TOKEN;

async function telegram(method: string, data: Record<string, unknown>): Promise<any> {
  let response;
  try { response = await fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(35000) }); }
  catch { throw Error('Нет соединения с Telegram'); }
  const result = await response.json();
  if (!result.ok) { const error: TelegramError = Error(method + ': ' + (result.description || 'Ошибка Telegram')); error.retryAfter = result.parameters?.retry_after; throw error; }
  return result.result;
}
function markup(event: BotEvent) {
  if (event.placement === 'keyboard' && (event.buttons || []).length) return { keyboard: (event.buttons || []).map(b => [{ text: b.label }]), resize_keyboard: true };
  if ((event.buttons || []).length) return { inline_keyboard: (event.buttons || []).map(b => [b.action === 'url' ? { text: b.label, url: b.url } : { text: b.label, callback_data: b.callback }]) };
  return { remove_keyboard: true };
}
async function deliver(session: BotSession, events: BotEvent[], call = telegram) {
  const b = session.engine.behavior, chat_id = session.chatId;
  for (const event of events) {
    if (event.type === 'disable') {
      for (const key of event.tokens || []) { const id = session.messages[key]; if (id) { try { await call('editMessageReplyMarkup', { chat_id, message_id: id, reply_markup: { inline_keyboard: (event.links?.[key] || []).map(b => [b]) } }); } catch { console.warn('Не удалось отключить старую клавиатуру'); } delete session.messages[key]; } }
      continue;
    }
    if (event.type === 'notice') continue;
    if (b.typing) { try { await call('sendChatAction', { chat_id, action: 'typing' }); } catch {} }
    const text = event.text || 'Сценарий завершён';
    // shortcut: split long dynamic values into plain messages; media needs a dedicated renderer.
    const points = Array.from(text), chunks = [];
    for (let i = 0; i < points.length; i += 4000) chunks.push(points.slice(i, i + 4000).join(''));
    for (let i = 0; i < chunks.length; i++) {
      const last = i === chunks.length - 1, reply_markup = last ? markup({ ...event, buttons: event.buttons || [] }) : { remove_keyboard: true };
      let result;
      if (b.history === 'update' && session.lastMessage && session.lastPlacement !== 'keyboard' && !reply_markup.keyboard) {
        try { result = await call('editMessageText', { chat_id, message_id: session.lastMessage, text: chunks[i], reply_markup: { inline_keyboard: reply_markup.inline_keyboard || [] } }); } catch { console.warn('Обновление недоступно, отправляем новое сообщение'); }
      }
      if (!result) {
        if (b.history === 'delete' && session.lastMessage) { try { await call('deleteMessage', { chat_id, message_id: session.lastMessage }); } catch { console.warn('Удаление недоступно, диалог продолжается'); } }
        result = await call('sendMessage', { chat_id, text: chunks[i], reply_markup });
      }
      session.lastMessage = result.message_id; session.lastPlacement = event.placement || 'inline';
      if (last && event.buttons?.length) session.messages[event.token!] = result.message_id;
    }
  }
}
function enqueue(session: BotSession, task: () => Promise<void>, isCallback = false): boolean {
  if (isCallback && session.pending && session.engine.behavior.preventDoubleClick) return false;
  session.pending = (session.pending || 0) + 1;
  session.chain = (session.chain || Promise.resolve()).then(task).catch(error => console.error(error.message)).finally(() => { session.pending = (session.pending || 1) - 1; });
  return true;
}
async function main() {
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw Error('Укажите BOT_TOKEN в локальном .env');
  // Polling needs an unused bot: do not silently remove a webhook belonging to another service.
  const webhook = await telegram('getWebhookInfo', {});
  if (webhook.url) throw Error('У бота установлен webhook. Отключите его перед запуском polling.');
  const sessions = new Map<string, BotSession>(); let offset = 0;
  console.log('Бот запущен. Для остановки нажмите Ctrl+C.');
  while (true) {
    try {
      const updates = await telegram('getUpdates', { offset, timeout: 1, allowed_updates: ['message', 'callback_query'] });
      for (const update of updates) {
        offset = update.update_id + 1;
        const callback = update.callback_query, message = callback?.message || update.message;
        if (!message || message.chat.type !== 'private') continue;
        if (callback) { try { await telegram('answerCallbackQuery', { callback_query_id: callback.id }); } catch {} }
        const key = String(message.chat.id); let session = sessions.get(key);
        if (!session) { session = { engine: new Session(project), chatId: message.chat.id, messages: {}, lastMessage: null }; sessions.set(key, session); }
        const event = callback ? { callback: callback.data } : { text: message.text || '' };
        enqueue(session, async () => {
          await deliver(session, session.engine.handle(event));
          if (!callback && session.engine.behavior.deleteUser) { try { await telegram('deleteMessage', { chat_id: message.chat.id, message_id: message.message_id }); } catch { console.warn('Нет возможности удалить сообщение пользователя'); } }
        }, !!callback);
      }
      for (const session of sessions.values()) if (!session.pending) enqueue(session, () => deliver(session, session.engine.tick()));
    } catch (error) { const failure = error as TelegramError; console.error(failure.message); await new Promise(resolve => setTimeout(resolve, Math.max(2000, (failure.retryAfter || 0) * 1000))); }
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
export { deliver, markup, enqueue };
