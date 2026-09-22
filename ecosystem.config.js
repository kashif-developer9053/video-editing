/**
 * pm2 configuration.
 *
 * pm2 does not read .env — it starts the process with its own environment,
 * so PORT never reached Next and the app fell back to 3000, which collided
 * with another project on the same server. This file loads .env explicitly
 * and hands the values to the process.
 */

const fs = require("node:fs");
const path = require("node:path");

/** Minimal .env reader: KEY=value, ignoring blanks and comments. */
function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    // Strip surrounding quotes if someone added them.
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

const env = readEnv(path.join(__dirname, ".env"));

module.exports = {
  apps: [
    {
      name: "scrollcast",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start",
      // One instance only: encoding is CPU-bound and the job registry lives
      // in memory, so a second instance would not see the first one's jobs.
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        // A default here so a missing .env cannot silently fall back to
        // 3000 and collide with another site.
        PORT: env.PORT || "3001",
        ...env,
      },
      // Renders are long-running; do not kill the process for being busy.
      kill_timeout: 10000,
      // Stop the restart loop if it is failing for a real reason, instead of
      // burning CPU retrying thirty times.
      max_restarts: 10,
      min_uptime: "20s",
      restart_delay: 3000,
      merge_logs: true,
      time: true,
    },
  ],
};
