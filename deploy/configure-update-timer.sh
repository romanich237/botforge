#!/usr/bin/env bash
set -euo pipefail

if [[ $(id -un) != botforge ]]; then
  echo 'Запустите скрипт под пользователем botforge.' >&2
  exit 1
fi

project_dir=$(cd "$(dirname "$0")/.." && pwd)
unit_dir="$HOME/.config/systemd/user"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"

install -d -m 700 "$unit_dir"
install -m 644 "$project_dir/deploy/systemd/botforge-update.timer" "$unit_dir/botforge-update.timer"
systemctl --user daemon-reload
systemctl --user enable --now botforge-update.timer
systemctl --user restart botforge-update.timer
systemctl --user list-timers botforge-update.timer --no-pager
