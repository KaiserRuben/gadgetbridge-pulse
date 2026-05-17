# Setup

Linear setup guide for running Pulse end-to-end. Two variants:

1. **Single-machine** — runner + dashboard on the same Mac. Simplest.
2. **Two-machine** — runner on the Mac, dashboard on a Raspberry Pi
   (or any always-on Linux box), Syncthing in between. Production
   topology.

The verified scope is described in the top-level
[README.md](../README.md). If your watch / locale / hardware doesn't
match it, expect to port code, not just configure.

---

## 1. Phone — Gadgetbridge auto-export

1. Install [Gadgetbridge](https://gadgetbridge.org) on your Android
   phone (F-Droid build recommended).
2. Pair your watch in Gadgetbridge → **Add Device**. Confirm the watch
   appears with its real device name + Bluetooth MAC.
3. Walk through Gadgetbridge's "About you" screen so `USER` and
   `USER_ATTRIBUTES` get populated (height, weight, step goal, sleep
   goal). Pulse will warn on `USER._id ≠ 1`; single-user is the
   verified path.
4. Enable **Settings → Data management → Auto-export**. Set:
   - **Export directory** → a folder Syncthing will watch (or any
     folder you can move to your Mac).
   - **Export interval** → 1 hour (or whatever suits you).
   - **Include data** → on. This produces the `Gadgetbridge.db` Pulse
     reads.

If you do not use Syncthing, you'll be moving `Gadgetbridge.db` to the
Mac manually (USB / `adb pull` / similar). Auto-replication is
recommended — the runner picks up file mtime changes.

## 2. Mac — install prerequisites

### Node 22+
```bash
# via Homebrew
brew install node@22

# or via nvm
nvm install 22 && nvm use 22
```

### Docker Desktop
Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
for Apple Silicon. The runner image targets `linux/arm64`.

### Ollama + models
```bash
# install
brew install ollama
ollama serve &                  # leave running

# pull models (~16 GB total on disk)
ollama pull qwen3.6:latest      # batch pipeline (default $COACH_MODEL)
ollama pull ministral-3:3b      # on-demand chart / chat panel
```

Verify Ollama responds:
```bash
curl http://localhost:11434/api/tags
```

### Syncthing (only if going two-machine)
Install [Syncthing](https://syncthing.net) on Mac + Pi. Pair them. We'll
configure the shared folder in step 4.

## 3. Mac — clone + install

```bash
git clone <this-repo> pulse
cd pulse

# dashboard deps
npm install

# runner deps
cd runner && npm install && cd ..
```

## 4. Mac — pick + populate `$PULSE_ROOT`

All Pulse-managed data lives under one root directory, separate from the
repo. Choose a location — for Syncthing, this is the shared folder.

```bash
export PULSE_ROOT="$HOME/Syncthing/pulse"   # or wherever
mkdir -p "$PULSE_ROOT"
```

Add to `~/.zshrc` / `~/.bash_profile` so subsequent shells see it.

Drop your `Gadgetbridge.db` in:
```bash
cp /path/to/auto-export/Gadgetbridge.db "$PULSE_ROOT/Gadgetbridge.db"
```

If you're using Syncthing's automatic export → shared folder pipeline,
no copy needed; the file lands there directly.

## 5. Mac — configure web-push (optional)

If you want the dashboard to send push notifications:

```bash
npx web-push generate-vapid-keys --json
```

Copy the output into a `.env.local` at the repo root:
```env
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:you@example.com
```

Skip this for headless dev — push isn't required for the dashboard to
work.

## 6. Mac — first runner run

Backfill the last 30 days of insights:

```bash
cd runner
npx tsx src/index.ts backfill --days=30
```

This:
- Reads `$PULSE_ROOT/Gadgetbridge.db`
- For each day-complete period, runs Stage 0 → 1 → 2 → 3 → 4 → 5 → 6
  → 7 → W
- Writes results to `$PULSE_ROOT/insights/`

First run is slow — qwen3.6 inference is the bottleneck (~30-90 s per
day). Subsequent runs reuse hash-cached coaching outputs and skip days
with `_complete` sentinels.

If a day's pipeline fails, the failure is recorded in `_bundle.json`
with stage records + timings. Re-run with `--force` after fixing.

## 7. Mac — start the dashboard

Single-machine variant:
```bash
cd <repo root>
npm run dev
# → http://localhost:3030
```

Two-machine variant: the Mac dashboard is optional during normal use,
but useful for development. Set `PULSE_ROOT` as in step 4 first; the
dashboard reads from the same location the runner wrote to.

## 8. *(two-machine)* Pi — install

Target: Raspberry Pi 4/5 with Raspbian 12 (bookworm).

```bash
# Node 22 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3

# clone or sync the repo to the Pi (Syncthing recommended so updates
# from the Mac propagate automatically)
cd ~/Projects
git clone <this-repo> pulse
cd pulse
npm ci

# build the standalone bundle
bash deploy/build-pi.sh    # runs `next build` + swaps in @next/swc
```

## 9. *(two-machine)* Pi — Syncthing folder

Pair Mac and Pi in Syncthing. Add `$PULSE_ROOT` (on Mac) as a shared
folder; pick a matching path on the Pi (e.g.
`/home/$USER/Syncthing/pulse`). Folder mode:

- `insights/` → **Send Only** from Mac, **Receive Only** on Pi
- `state/` → **Send & Receive** on both (Pi UI writes toggles)
- `Gadgetbridge.db` → **Receive Only** on Mac (phone → Mac), don't
  share with Pi

Copy `deploy/data-folder.stignore` to the Pi's shared folder root as
`.stignore` so SQLite WALs + ingest outbox stay local.

## 10. *(two-machine)* Pi — systemd

Render the unit template:

```bash
cp deploy/pulse-v4.service.template /tmp/pulse-v4.service
# substitute placeholders:
#   {{PI_USER}}         → output of `whoami`
#   {{REPO_PATH}}       → /home/<you>/Projects/pulse
#   {{PULSE_DATA_ROOT}} → /home/<you>/Syncthing/pulse
#   {{NODE_BIN}}        → output of `which node`
#   {{OLLAMA_URL}}      → http://<mac-host>:11434
#   {{TZ}}              → Europe/Berlin
sudo mv /tmp/pulse-v4.service /etc/systemd/system/pulse.service
sudo systemctl daemon-reload
sudo systemctl enable --now pulse
sudo systemctl status pulse
```

Reach the dashboard at `http://<pi-ip>:3030` or `http://pulse.local:3030`.

## 11. *(two-machine)* Mac — launchd for the runner

Render the launchd template:

```bash
cp deploy/pulse-runner.plist.template /tmp/pulse-runner.plist
# substitute placeholders:
#   {{REPO_PATH}}        → /Users/<you>/Projects/pulse
#   {{PULSE_DATA_ROOT}}  → /Users/<you>/Syncthing/pulse
#   {{MAC_USER}}         → output of `whoami`
#   {{DOCKER_BIN}}       → output of `which docker`
cp /tmp/pulse-runner.plist ~/Library/LaunchAgents/local.pulse-runner.plist
launchctl load ~/Library/LaunchAgents/local.pulse-runner.plist
launchctl list | grep pulse-runner
```

This launches `runner/docker-compose.yml` on every mtime change of
`$PULSE_DATA_ROOT/Gadgetbridge.db` + every Sunday at 06:00. The
container runs `daily-watch` (cheap, no LLM) on mtime change, and the
finalize loop service handles the heavy LLM work on its own schedule.

Logs land in `~/Library/Logs/pulse-runner.log` /
`pulse-runner-error.log`.

## 12. *(two-machine)* Caddy + TLS — optional

See [deploy/README.md](../deploy/README.md) for three flavours:

- Bare HTTP on the LAN (simplest)
- Caddy + Tailscale TLS (recommended for remote access)
- Caddy + Let's Encrypt on a public domain

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Gadgetbridge.db not found` | `PULSE_ROOT` not set in current shell | Re-source profile + restart runner |
| Runner exits with `mount failed` | Docker compose can't resolve `$PULSE_ROOT` | Add `PULSE_ROOT=...` to `runner/.env` (read automatically by compose) |
| `Why?` button hangs on the Pi | `OLLAMA_URL` not set in the systemd unit | Add `Environment=OLLAMA_URL=http://<mac>:11434` and restart |
| Insights say "partial" | Verifier hard-failed on S1 drift | Check `_bundle.json` → look for `S1 violation`; usually a prompt regression |
| `_complete` never appears | Day-complete check failed | A day is "complete" at the next-day wake window crossing. Check `period.ts` math + your timezone |
| Dashboard 500 with relative path | Bare `$PULSE_ROOT` unset, fallback `./pulse` doesn't exist | Export `PULSE_ROOT` in the dashboard's environment |
| Push notifications never fire | VAPID keys missing or `VAPID_SUBJECT` invalid | Regenerate keys + ensure `VAPID_SUBJECT` starts with `mailto:` or `https://` |

## Going further

- Add metrics: [docs/COACH_PLAN.md](COACH_PLAN.md) describes how a new
  metric flows from `Gadgetbridge.db` → facts → rules → article.
- Change prompts: `runner/src/prompts/daily.ts` is the v2 article
  prompt. Re-run the drift fixture (`runner/src/test/drift.ts`) after
  any prompt change.
- Add a domain page: copy `app/(app)/sleep/` as a starting template.
  The runner emits `domain_insights` shaped consistently; your new page
  reads from there.
- Switch language: every prompt file under `runner/src/prompts/`. Stage
  6 critic regexes (`runner/src/stages/stage6-verify.ts`) will need
  rewriting too.
