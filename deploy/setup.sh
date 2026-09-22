#!/usr/bin/env bash
#
# One-time setup on a fresh Ubuntu/Debian VPS.
#
# Run this once as a user with sudo. It installs what the app needs, clones
# the repo, builds it, and starts it under pm2 so it survives reboots.
#
#   bash setup.sh
#
# Re-running is safe: every step checks before it acts.

set -euo pipefail

# ---- settings you may want to change -----------------------------------
APP_NAME="${APP_NAME:-scrollcast}"
APP_PORT="${APP_PORT:-3001}"          # 3000 is probably taken by another app
REPO="${REPO:-https://github.com/kashif-developer9053/video-editing.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-$HOME/apps/$APP_NAME}"
NODE_MAJOR="${NODE_MAJOR:-22}"
# ------------------------------------------------------------------------

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }

say "Installing system packages"
sudo apt-get update -qq
# build-essential and the cairo/pango/jpeg headers are for node-canvas, which
# compiles from source. ffmpeg does the actual encoding. Without either the
# app installs fine and then fails at the first render.
sudo apt-get install -y --no-install-recommends \
  curl git ca-certificates ffmpeg \
  build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
  fontconfig fonts-dejavu-core

say "Checking Node"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v
ffmpeg -version | head -1

say "Installing pm2"
command -v pm2 >/dev/null 2>&1 || sudo npm install -g pm2

say "Getting the code into $APP_DIR"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

say "Writing .env"
if [ ! -f .env ]; then
  # Ask specifically for IPv4. A server that answers with IPv6 gives back a
  # bare address like 2a02:4780:75:d63c::1, and gluing ":$APP_PORT" onto that
  # produces a string no URL parser accepts — the build then fails with
  # "Failed to collect page data for /_not-found", which says nothing about
  # the cause.
  PUBLIC_IP="$(curl -fsS --max-time 5 -4 ifconfig.me 2>/dev/null || true)"
  if printf '%s' "$PUBLIC_IP" | grep -qE '^[0-9]+(\.[0-9]+){3}$'; then
    SITE_URL="http://$PUBLIC_IP:$APP_PORT"
  else
    SITE_URL="http://localhost:$APP_PORT"
  fi

  cat > .env <<ENVEOF
# Point this at your real domain before sharing the link. Canonical URLs, the
# sitemap and link previews are all built from it, so a wrong value gets
# indexed as a broken link.
NEXT_PUBLIC_SITE_URL=$SITE_URL
PORT=$APP_PORT
NODE_ENV=production
ENVEOF
  echo "wrote $APP_DIR/.env with NEXT_PUBLIC_SITE_URL=$SITE_URL"
else
  echo ".env already exists, leaving it alone"
fi

say "Installing dependencies (node-canvas compiles here, give it a minute)"
npm ci

say "Building"
# set -e already aborts here, but say so plainly: the script stopping before
# it reaches pm2 is exactly why "pm2 restart" later reports the process does
# not exist, which reads as a pm2 problem rather than a build one.
if ! npm run build; then
  echo
  echo "The build failed, so the app was not started."
  echo "Fix the error above, then run:"
  echo "  cd $APP_DIR && npm run build && pm2 start npm --name $APP_NAME -- start && pm2 save"
  exit 1
fi

say "Starting under pm2 on port $APP_PORT"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
# Started through ecosystem.config.js, which reads .env itself. Starting npm
# directly does not: pm2 gives the process its own environment, PORT never
# arrives, and Next falls back to 3000 — which on a server already running
# something there fails with EADDRINUSE and restarts forever.
pm2 start ecosystem.config.js
pm2 save

say "Making pm2 start on boot"
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | grep -E '^sudo' | bash || \
  echo "If the app does not come back after a reboot, run: pm2 startup"

say "Done"
echo "  Running on http://127.0.0.1:$APP_PORT"
echo "  Logs:    pm2 logs $APP_NAME"
echo "  Restart: pm2 restart $APP_NAME"
echo
echo "Next: point a domain at it with deploy/nginx.conf, then run deploy/ssl.sh"
