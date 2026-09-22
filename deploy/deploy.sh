#!/usr/bin/env bash
#
# Pull the latest code and restart. Run by GitHub Actions on every push, and
# safe to run by hand:
#
#   bash ~/apps/scrollcast/deploy/deploy.sh
#
# If the build fails the old version keeps running — the restart only happens
# after a build that worked.

set -euo pipefail

APP_NAME="${APP_NAME:-scrollcast}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-$HOME/apps/$APP_NAME}"

say() { printf '\033[1;33m==> %s\033[0m\n' "$1"; }

cd "$APP_DIR"

BEFORE="$(git rev-parse HEAD)"

say "Fetching $BRANCH"
git fetch origin "$BRANCH"
AFTER="$(git rev-parse "origin/$BRANCH")"

if [ "$BEFORE" = "$AFTER" ]; then
  say "Already up to date at ${BEFORE:0:7}, nothing to do"
  exit 0
fi

say "Updating ${BEFORE:0:7} -> ${AFTER:0:7}"
git reset --hard "origin/$BRANCH"

# Only reinstall when the dependency list actually moved: npm ci wipes and
# rebuilds node_modules, and node-canvas compiling from source makes that
# slow enough to be worth skipping.
if ! git diff --quiet "$BEFORE" "$AFTER" -- package-lock.json package.json; then
  say "Dependencies changed, reinstalling"
  npm ci
else
  say "Dependencies unchanged, skipping install"
fi

say "Building"
# Build into a fresh directory, so a failure here leaves the running app
# untouched rather than half-replacing it.
npm run build

say "Restarting"
pm2 restart "$APP_NAME" --update-env
pm2 save >/dev/null 2>&1 || true

say "Deployed ${AFTER:0:7}"
pm2 describe "$APP_NAME" | grep -E "status|uptime" || true
