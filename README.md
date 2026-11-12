# BotForge Studio

Визуальный конструктор Telegram-ботов. Соберите сценарий из блоков, пройдите его в тестовом чате и скачайте исходники для запуска своего бота.

[Открыть BotForge Studio](https://botforge-studio.duckdns.org/)

## Возможности

- **Редактор сценариев.** Команды, сообщения, кнопки, ввод пользователя, условия и переменные.
- **Тестовый чат.** Проверьте ветки сценария и реакции на кнопки прямо в студии.
- **Экспорт исходников.** Скачайте проект для Node.js, TypeScript, Python или Go.
- **Проекты в SQLite.** Сценарии сохраняются на сервере. При настройке доступны вход через Google и ИИ-помощник.

## Структура

| Путь | Назначение |
| --- | --- |
| `frontend/public/` | HTML, CSS, браузерный JavaScript и иконки |
| `frontend/src/` | Редактор схем на React и React Flow |
| `backend/` | HTTP API, авторизация, SQLite, валидация, ИИ и экспорт |
| `backend/templates/` | Шаблоны исходников для экспортируемых ботов |
| `deploy/update.sh` | Обновление из GitHub и перезапуск через systemd |
| `deploy/configure-update-timer.sh` | Настройка проверки обновлений каждые 10 секунд |
| `server.js` | Точка входа приложения для npm и systemd |

## Локальный запуск

Понадобятся Git и Node.js. Рекомендуем Node.js 24.

```bash
git clone https://github.com/romanich237/botforge.git
cd botforge
npm ci --include=dev
npm start
```

Откройте [localhost:3000](http://localhost:3000/). Команда `npm start` сама собирает фронтенд. Данные по умолчанию хранятся в `data/` в корне проекта.

## Ручное обновление с GitHub

На VPS выполните под пользователем `botforge`. Команда запускает обновление сразу через уже настроенную службу systemd.

```bash
cd ~/botforge
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
systemctl --user start botforge-update.service
systemctl --user status botforge.service --no-pager
curl -fsS -o /dev/null -w 'HTTPS %{http_code}\n' https://botforge-studio.duckdns.org/
```

Таймер проверяет GitHub каждые 10 секунд. Служба проверяет `origin/main`, применяет изменения через fast-forward, устанавливает зависимости, проверяет синтаксис, собирает фронтенд и перезапускает приложение. Если этот коммит уже установлен, повторный запуск пропустит сборку. Для приватного репозитория используется сохранённый HTTPS-токен с правом чтения.

Если обновление завершилось ошибкой, посмотрите журнал:

```bash
journalctl --user -u botforge-update.service -u botforge.service -n 60 --no-pager
```

[Настройки VPS, systemd и конфигурация](DEPLOYMENT.md)
