#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

need_node() {
  echo
  echo "  Saathi needs Node.js 20 or newer."
  if [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    echo "  Installing it with Homebrew..."
    brew install node
  else
    echo "  Install the LTS version from https://nodejs.org, then run ./start.sh again."
    exit 1
  fi
}

if ! command -v node >/dev/null 2>&1; then need_node; fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then need_node; fi

if [ ! -f node_modules/.package-lock.json ]; then
  echo
  echo "  Getting Saathi ready. This happens once and takes about a minute..."
  npm install --no-audit --no-fund
fi

if [ ! -f .env ]; then
  echo
  echo "  First time here: a few quick questions. Press Enter to skip any of them."
  npm run setup || true
fi

echo
echo "  Starting Saathi. Your browser will open by itself. Press Ctrl+C to stop."
SAATHI_OPEN_BROWSER=1 npm start
