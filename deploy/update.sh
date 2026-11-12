#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export GIT_TERMINAL_PROMPT=0

git_dir=$(git rev-parse --absolute-git-dir)
exec 9>"$git_dir/botforge-update.lock"
flock -n 9 || exit 0

if [[ $(git branch --show-current) != main || -n $(git status --porcelain --untracked-files=no) ]]; then
  echo 'BotForge: требуется чистая рабочая копия ветки main.' >&2
  exit 1
fi

git fetch origin refs/heads/main
target=$(git rev-parse FETCH_HEAD)
current=$(git rev-parse HEAD)
stamp="$git_dir/botforge-deployed"

if ! git merge-base --is-ancestor "$current" "$target"; then
  echo 'BotForge: обновление main невозможно без переписывания локальной истории.' >&2
  exit 1
fi

if [[ "$current" == "$target" && -f "$stamp" && $(<"$stamp") == "$target" ]]; then
  exit 0
fi

git merge --ff-only "$target"
npm ci --include=dev
npm run check
npm run build
systemctl --user restart botforge.service
printf '%s\n' "$target" > "$stamp"
echo "BotForge: установлен $target"
