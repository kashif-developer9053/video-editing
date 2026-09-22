# Deploying to a VPS

Written for a Hostinger VPS running Ubuntu, but any Ubuntu or Debian server
works the same way.

This app needs a real Node server: it runs FFmpeg as a child process and
writes files to disk. It will **not** run on Vercel, Netlify, or any other
serverless host.

If the server already runs other sites, nothing here disturbs them — the app
gets its own port, its own pm2 process and its own nginx file.

---

## 1. Connect

```bash
ssh root@YOUR_SERVER_IP
```

Working as root is fine, but a normal user is safer. To make one:

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
su - deploy
```

## 2. Run the setup script

```bash
curl -fsSL https://raw.githubusercontent.com/kashif-developer9053/video-editing/main/deploy/setup.sh -o setup.sh
bash setup.sh
```

It installs Node 22, FFmpeg, the libraries node-canvas needs, and pm2; clones
the repo to `~/apps/scrollcast`; builds it; and starts it on **port 3001**
with pm2, set to come back after a reboot.

Allow ten minutes or so. Most of it is node-canvas compiling from source.

To use a different port or directory:

```bash
APP_PORT=3005 APP_DIR=~/apps/video bash setup.sh
```

Check it is alive:

```bash
curl -I http://127.0.0.1:3001
pm2 status
```

## 3. Point a domain at it

In your DNS, add an **A record** for the subdomain you want, pointing at the
server's IP. Then:

```bash
cd ~/apps/scrollcast
sudo cp deploy/nginx.conf /etc/nginx/sites-available/scrollcast
sudo sed -i 's/YOUR_DOMAIN/video.yourdomain.com/g' /etc/nginx/sites-available/scrollcast
sudo ln -sf /etc/nginx/sites-available/scrollcast /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` checks every site on the server, so if it passes, the other
projects are still fine.

## 4. Turn on HTTPS

Once DNS has propagated — `dig +short video.yourdomain.com` should show your
server's IP:

```bash
bash deploy/ssl.sh video.yourdomain.com you@example.com
```

Then set the real address, because the sitemap and link previews are built
from it:

```bash
sed -i 's|^NEXT_PUBLIC_SITE_URL=.*|NEXT_PUBLIC_SITE_URL=https://video.yourdomain.com|' .env
npm run build && pm2 restart scrollcast
```

---

## 5. Deploy automatically on every push

### On the server — make a key for GitHub

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/github_deploy      # copy all of this, including the BEGIN/END lines
```

### On GitHub — add four secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
| --- | --- |
| `VPS_HOST` | your server's IP |
| `VPS_USER` | the user you are logged in as (`deploy`, or `root`) |
| `VPS_SSH_KEY` | the whole private key you just printed |
| `VPS_PORT` | `22` |

That is it. Every push to `main` now builds on GitHub first, and only touches
the server if the build passed — so a broken commit cannot take the site
down. Watch it run under the **Actions** tab.

To deploy without pushing, use **Actions → Deploy → Run workflow**.

To deploy by hand:

```bash
bash ~/apps/scrollcast/deploy/deploy.sh
```

---

## Day to day

```bash
pm2 status                  # is it running
pm2 logs scrollcast         # follow the log
pm2 logs scrollcast --err   # errors only
pm2 restart scrollcast      # restart
pm2 monit                   # live CPU and memory
```

## When something is wrong

**The site does not load.** Check the app first, then nginx:

```bash
curl -I http://127.0.0.1:3001     # app itself
sudo nginx -t                     # nginx config
sudo tail -50 /var/log/nginx/error.log
```

**`pm2 restart` says the process was not found.** pm2 has no record of it —
usually because the daemon was restarted, or setup.sh stopped at a failed
build before it got that far. Start it instead:

```bash
cd ~/apps/scrollcast
pm2 start ecosystem.config.js
pm2 save
```

**Renders fail.** Almost always FFmpeg:

```bash
ffmpeg -version || sudo apt-get install -y ffmpeg
```

**Renders fail only after a fresh install.** node-canvas did not compile.
Reinstall the headers and rebuild:

```bash
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev \
  libjpeg-dev libgif-dev librsvg2-dev
cd ~/apps/scrollcast && npm rebuild canvas && pm2 restart scrollcast
```

**The build runs out of memory** on a 1GB server. Add swap once:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**`EADDRINUSE: address already in use :::3000`.** The app is not reading
`.env`, so it fell back to port 3000 and hit another site. Always start it
through the config file, which loads `.env` itself:

```bash
cd ~/apps/scrollcast
pm2 delete all
pm2 start ecosystem.config.js
pm2 save
```

**Port already taken.** See what has it and pick another:

```bash
sudo ss -tulpn | grep LISTEN
```

Then edit `PORT` in `.env`, change `proxy_pass` in the nginx file to match,
and `pm2 restart scrollcast && sudo systemctl reload nginx`.

---

## What this costs to run

Video encoding is CPU-bound and does not share well: one render occupies a
core for its duration. Two people rendering at once on a 2-core server makes
both slower, which is why the app only runs one job at a time.

Rough capacity, assuming short videos:

| Plan | Concurrent renders | Comfortable daily volume |
| --- | --- | --- |
| 1 core, 4GB | 1 | tens |
| 2 cores, 8GB | 1–2 | ~100 |
| 4 cores, 16GB | 2–4 | several hundred |

Before real traffic arrives, add a job queue and per-IP rate limiting —
`src/server/jobs.ts` is deliberately shaped like the interface a queue would
expose, so BullMQ drops in without changing the callers.
