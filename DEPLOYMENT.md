# Развёртывание BotForge

На VPS BotForge запускается от пользователя `botforge` через пользовательскую службу systemd. Nginx принимает запросы по HTTPS и передаёт их на `127.0.0.1:3000`.

| Компонент | Назначение |
| --- | --- |
| `botforge.service` | Запускает `node server.js` из `~/botforge` |
| `botforge-update.service` | Запускает `/bin/bash deploy/update.sh` из `~/botforge` с Node.js и npm в PATH |
| `botforge-update.timer` | Проверяет GitHub каждые 10 секунд |
| Nginx и Certbot | Проксируют трафик и обслуживают HTTPS |

Настройте интервал командой `bash deploy/configure-update-timer.sh` под пользователем `botforge`.

Службы пользователя находятся в `~/.config/systemd/user/`. Чтобы они запускались после перезагрузки VPS, администратор включает `loginctl enable-linger botforge`.

Для ручного обновления следуйте [инструкции в README](README.md#ручное-обновление-с-github). Чтобы оставить только ручное обновление, отключите таймер командой `systemctl --user disable --now botforge-update.timer`.

Переменные окружения приведены в [примере конфигурации](.env.example). Для systemd их можно задать через `Environment=` или подключить отдельный файл через `EnvironmentFile=` в `botforge.service`. Для публичного сайта задайте `PUBLIC_ORIGIN=https://botforge-studio.duckdns.org`. Для Google-входа укажите обе переменные `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET`.

Храните токены и параметры приложения на сервере. В резервную копию включайте каталог данных `~/botforge/data` или путь из `DATA_DIR`, если он задан.
