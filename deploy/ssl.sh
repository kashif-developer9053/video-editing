#!/usr/bin/env bash
#
# Adds a free Let's Encrypt certificate and turns on HTTPS.
# Run after the domain's DNS A record points at this server.
#
#   bash deploy/ssl.sh video.example.com you@example.com

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Usage: bash deploy/ssl.sh <domain> <email>"
  exit 1
fi

command -v certbot >/dev/null 2>&1 || sudo apt-get install -y certbot python3-certbot-nginx

# --redirect sends http traffic to https; certbot edits the nginx file itself.
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo
echo "HTTPS is on. Renewal is automatic; check it with:"
echo "  sudo certbot renew --dry-run"
echo
echo "Now set the real address so links and share previews are right:"
echo "  sed -i 's|^NEXT_PUBLIC_SITE_URL=.*|NEXT_PUBLIC_SITE_URL=https://$DOMAIN|' ~/apps/scrollcast/.env"
echo "  cd ~/apps/scrollcast && npm run build && pm2 restart scrollcast"
