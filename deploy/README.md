# Deployment

Two-machine architecture (v2):

- **Mac (host)**: runs the **runner** in a Docker container. Triggered by
  launchd on DB mtime change + a weekly Sunday 06:00 schedule. Ollama runs
  on the Mac host at `localhost:11434`.
- **Raspberry Pi**: runs the Next.js dashboard **read-only** via systemd
  (`pulse.service`). Never runs the runner. Sees `insights/` and `state/`
  via Syncthing.

State (`pause.json`, `labs.json`, `alarm_state.json`) lives in a **bidirectional**
Syncthing folder `state/` — Pi-writable + Mac-writable, eventual consistency.

---

## Mac side (runner, v2)

### Pre-requisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and
  running. The runner image targets `node:22-alpine` (linux/arm64 on Apple Silicon).
- Ollama running on the host: `ollama serve` listens on `localhost:11434`.
  The container reaches it via `host.docker.internal:11434`.
- Syncthing already syncing your shared root (`$PULSE_ROOT`).

### One-time setup

```bash
cd "$PULSE_REPO_ROOT"   # wherever you cloned the repo

# 1. Validate compose syntax (no build):
docker compose -f runner/docker-compose.yml config

# 2. Build the runner image:
docker compose -f runner/docker-compose.yml build

# 3. (sanity) Boot the container in foreground; ctrl-C to stop:
docker compose -f runner/docker-compose.yml up

# 4. Verify the container can reach host Ollama:
docker exec gadgetbridge-runner curl -s http://host.docker.internal:11434/api/tags

# 5. Install the launchd plist:
cp deploy/pulse-runner.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/pulse-runner.plist

# 6. Verify it's loaded:
launchctl list | grep gadgetbridge-runner
```

### How it triggers

- **`WatchPaths`**: launchd watches `Gadgetbridge.db` for mtime change and
  runs `docker compose ... up --abort-on-container-exit`. The container's
  `daily-watch` mode then re-runs the v2 pipeline.
- **`StartCalendarInterval`**: weekly Sunday 06:00 — for the weekly insights
  refresh even on quiet days.
- **`KeepAlive` / `ThrottleInterval`**: launchd retries on non-zero exit;
  rate-limited to once per 30 s.

### Troubleshooting

```bash
# launchd logs
tail -f ~/Library/Logs/gadgetbridge-runner.log
tail -f ~/Library/Logs/gadgetbridge-runner-error.log

# Container logs (live)
docker logs -f gadgetbridge-runner

# Manual one-off run (no launchd):
docker compose -f runner/docker-compose.yml up --abort-on-container-exit

# Reload plist after editing:
launchctl unload ~/Library/LaunchAgents/pulse-runner.plist
launchctl load   ~/Library/LaunchAgents/pulse-runner.plist
```

If `/usr/local/bin/docker` doesn't exist on your Mac (Apple Silicon often
uses `/opt/homebrew/bin/docker`; some installs expose it under
`/Applications/Docker.app/Contents/Resources/bin/docker`), find the binary
with `which docker` and update `ProgramArguments[0]` in the plist.

### Syncthing folders

The Mac is the source-of-truth for `Gadgetbridge.db` (replicated **from**
the phone) and writes `insights/`. The state folder is bidirectional:

| folder       | Mac      | Pi        | direction      | notes                             |
|--------------|----------|-----------|----------------|-----------------------------------|
| `Gadgetbridge.db` | read | (none)    | phone → Mac    | not shared with Pi                |
| `insights/`  | write    | read-only | Mac → Pi       | runner output, served by Next.js  |
| `state/`     | r/w      | r/w       | bidirectional  | UI on Pi can write toggles        |

In Syncthing UI on both Mac and Pi, add a folder for `state/` under the
shared transfer root with **Send & Receive** mode on both sides. Initial
seed of `state/*.json` happens automatically on first runner start (see
`runner/src/state/bootstrap.ts` and `deploy/pulse-runner.sh`).

---

## Pi side (dashboard, read-only)

Target: Raspberry Pi 4/5, Raspbian 12 (bookworm), Node 22+, Syncthing already
syncing your shared root onto the Pi.

### One-time setup

```bash
# 1. install Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3

# 2. clone / sync repo to Pi (via Syncthing already)
cd "$PULSE_REPO_ROOT"   # wherever you cloned the repo on the Pi
npm ci
npm run build

# 3. systemd unit
sudo cp deploy/pulse.service /etc/systemd/system/pulse.service
sudo systemctl daemon-reload
sudo systemctl enable --now pulse
sudo systemctl status pulse
```

Reach the dashboard at `http://<pi-ip>:3030` or `http://pulse.local:3030` (if
mDNS configured).

### Health check

```bash
curl http://localhost:3030/api/health
# { "ok": true, "activityRows": 1944, "mtimeIso": "...", ... }
```

### Logs

```bash
journalctl -u pulse -f
```

### Update

When the Mac side syncs new code via Syncthing:

```bash
cd "$PULSE_REPO_ROOT"   # wherever you cloned the repo on the Pi
npm ci && npm run build
sudo systemctl restart pulse
```

### Notes

- The DB path is `Gadgetbridge.db` at the Syncthing root. The runner on the
  Mac writes `insights/` next to it. The Pi only **reads** from both.
- `lib/db.ts` re-opens the SQLite handle whenever the file's mtime or inode
  changes — Syncthing's atomic-rename pattern is handled.
- Standalone build means a single Node bundle; no dev deps in production.

---

## Optional: Caddy reverse proxy + TLS (Pi)

Three flavors. Pick one.

### A. Bare HTTP on the LAN (default — simplest)

Skip Caddy entirely. Reach `http://pi.local:3030` (avahi-daemon) or
`http://<pi-ip>:3030`.

### B. Caddy + Tailscale TLS (recommended for remote access)

Tailscale auto-issues certs for `<host>.<tailnet>.ts.net`. No Let's Encrypt
required. Drop this in `/etc/caddy/Caddyfile`:

```caddyfile
pulse.<your-tailnet>.ts.net {
  bind tailscale0
  reverse_proxy localhost:3030

  # Optional: cache-control for static assets
  @assets path /_next/static/* /favicon.ico
  header @assets Cache-Control "public, max-age=31536000, immutable"
}
```

Then:
```bash
sudo apt-get install -y caddy
sudo systemctl enable --now caddy
```

### C. Caddy + Let's Encrypt on a public domain

If `pulse.example.com` resolves to your Pi (e.g. via DDNS + port-forward 80/443):

```caddyfile
pulse.example.com {
  reverse_proxy localhost:3030

  # Strict transport, basic security headers
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options    "nosniff"
    Referrer-Policy           "strict-origin-when-cross-origin"
    -Server
  }

  # Optional: gzip + brotli
  encode gzip zstd
}
```

Caddy auto-renews certs. Logs: `journalctl -u caddy -f`.

### LAN-only `.local` mDNS cert

`.local` doesn't resolve via Let's Encrypt. Either:
- Issue a self-signed cert and trust it on each device (annoying)
- Use Caddy's `tls internal` directive (still self-signed, but auto-managed):
```caddyfile
pulse.local {
  tls internal
  reverse_proxy localhost:3030
}
```

Pi will self-sign. Browsers warn unless the cert is trusted. Tailscale path
(B) is friction-free; prefer it.
