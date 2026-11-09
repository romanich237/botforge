#!/usr/bin/env bash
set -euo pipefail
if command -v node >/dev/null && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  node --version
  exit 0
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
curl -fsS --retry 2 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o sums.txt
archive=$(awk '$2 ~ /^node-v22\..*-linux-x64\.tar\.xz$/ {print $2}' sums.txt)
test -n "$archive"
curl -fsS --retry 2 "https://nodejs.org/dist/latest-v22.x/$archive" -o "$archive"
awk -v target="$archive" '$2 == target' sums.txt | sha256sum -c -
mkdir -p /opt/node
tar -xJf "$archive" -C /opt/node --strip-components=1
ln -s /opt/node/bin/node /usr/local/bin/node
ln -s /opt/node/bin/npm /usr/local/bin/npm
ln -s /opt/node/bin/npx /usr/local/bin/npx
node --version
