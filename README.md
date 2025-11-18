# UsenetStreamer

<p align="center">
  <img src="assets/icon.png" alt="UsenetStreamer logo" width="180" />
</p>

<p align="center">
  <strong>Your Usenet-powered bridge between Prowlarr/NZBHydra, NZBDav, and Stremio.</strong><br />
  Query your favorite indexers, stream directly over WebDAV, and manage it all from a friendly web dashboard.
</p>

<p align="center">
  <a href="https://discord.gg/NJsprZyz"><img src="https://img.shields.io/badge/Discord-Join-blue?logo=discord&logoColor=white" alt="Join Discord" /></a>
  <a href="https://buymeacoffee.com/gaikwadsank"><img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-yellow?logo=buymeacoffee&logoColor=white" alt="Buy me a coffee" /></a>
  <a href="https://github.com/Sanket9225/UsenetStreamer/actions"><img src="https://img.shields.io/github/actions/workflow/status/Sanket9225/UsenetStreamer/docker-publish.yml?label=docker%20build" alt="CI badge" /></a>
  <a href="https://ghcr.io/sanket9225/usenetstreamer"><img src="https://img.shields.io/badge/Docker-ghcr.io%2Fsanket9225%2Fusenetstreamer-blue?logo=docker" alt="Docker image" /></a>
</p>

---

## 🔗 Quick Links

- **Docker image:** `ghcr.io/sanket9225/usenetstreamer:latest`
- **Admin dashboard:** `https://your-addon-domain/<token>/admin/`
- **Manifest template:** `https://your-addon-domain/<token>/manifest.json`
- **Discord:** [Community chat](https://discord.gg/NJsprZyz)
- **Support:** [Buy me a coffee](https://buymeacoffee.com/gaikwadsank)
- **Self-hosting guide:** [Jump to instructions](#-deployment)

---

## ✨ Feature Highlights

### 🚀 Performance & Caching
- Parallel queries to Prowlarr or NZBHydra with automatic deduplication.
- Two-tier cache (Stremio responses + verified NZBs) to keep repeat requests instant.
- Configurable TTLs and size limits so you can tune memory usage for any server.

### 🔍 Smart Search & Language Filtering
- IMDb/TMDB/TVDB-aware search plans and TVDB-prefixed ID support (no Cinemeta needed).
- Release titles parsed for resolution, quality, and audio language, enabling `quality_then_size` or `language_quality_size` sorting.
- Preferred language items rise to the top and display with clear 🌐 labels.

### ⚡ Instant Streams from NZBDav
- Completed NZBDav jobs are recognized automatically and surfaced with a ⚡ tag.
- Instant streams are floated to the top of the list so you can start watching immediately.

### 🩺 NNTP Health Checks
- Optional triage downloads a handful of NZBs, samples archives over NNTP, and flags broken uploads before Stremio sees them.
- Decisions are cached per download URL and per normalized title, so later requests inherit health verdicts instantly.

### 🔐 Secure-by-Default
- Shared-secret gate ensures only URLs with `/your-secret/` can load the manifest or streams.
- Admin dashboard, manifest, and stream endpoints all reuse the same token.

---

## 🗺️ How It Works

1. **Stremio request:** Stremio calls `/stream/<type>/<id>.json` (optionally with `?lang=de` or other hints).
2. **Indexer search:** UsenetStreamer plans IMDb/TMDB/TVDB searches plus fallbacks and queries Prowlarr/NZBHydra simultaneously.
3. **Release parsing:** Titles are normalized for resolution, size, and language; oversize files above your cap are dropped.
4. **Triage & caching (optional):** Health checks sample NZBs via NNTP; decisions and NZBs are cached.
5. **NZBDav streaming:** Chosen NZBs feed NZBDav, which exposes a WebDAV stream back to Stremio.
6. **Instant detection:** Completed NZBDav jobs are matched by normalized title and tagged ⚡ for instant playback.

---

## 🐳 Deployment

### Docker (recommended)

```bash
docker run -d --restart unless-stopped \
  --name usenetstreamer \
  -p 7000:7000 \
  -e ADDON_SHARED_SECRET=super-secret-token \
  ghcr.io/sanket9225/usenetstreamer:latest
```

#### Docker Compose

```yaml
services:
  usenetstreamer:
    image: ghcr.io/sanket9225/usenetstreamer:latest
    container_name: usenetstreamer
    restart: unless-stopped
    ports:
      - "7000:7000"
    environment:
      ADDON_SHARED_SECRET: super-secret-token
```

Then browse to `https://your-domain/super-secret-token/admin/` to enter your credentials. The container ships with Node 20, exposes port 7000, and supports both `linux/amd64` and `linux/arm64` thanks to `buildx`.

### Source installation

```bash
git clone https://github.com/Sanket9225/UsenetStreamer.git
cd UsenetStreamer
npm install
node server.js
```

Create `.env` (see `.env.example`) or, better, load `http://localhost:7000/<token>/admin/` to configure everything from the UI.

### Reverse proxy & HTTPS

Stremio requires HTTPS. Place Nginx/Caddy/Traefik in front of the addon, terminate TLS, and forward to `http://127.0.0.1:7000`. Expose `/manifest.json`, `/stream/*`, `/nzb/*`, `/assets/*`, and `/admin/*`. Update `ADDON_BASE_URL` accordingly.

---

## 🍼 Beginner-Friendly End-to-End Setup

Prefer a hand-held walkthrough? Read [`docs/beginners-guide.md`](docs/beginners-guide.md) for a soup-to-nuts tutorial that covers:

- Picking a Usenet provider + indexer, spinning up a VPS, and installing Docker.
- Deploying Prowlarr, NZBDav, and UsenetStreamer with a single `docker compose` file.
- Opening firewall ports, wiring DuckDNS, and configuring Caddy for HTTPS the beginner way.

Refer to that guide whenever you need a step-by-step checklist; the rest of this README focuses on day-to-day usage details.

## 🛠️ Admin Dashboard

Visit `https://your-addon-domain/<token>/admin/` to:

- Load and edit every runtime setting with validation and helpful hints.
- Trigger connection tests for indexer manager, NZBDav, and NNTP provider.
- Copy the ready-to-use manifest URL right after saving.
- Restart the addon safely once changes are persisted.

The dashboard is protected by the same shared secret as the manifest. Rotate it if you ever suspect exposure.

---

## ⚙️ Configuration & Environment Variables *(prefer the admin dashboard)*

The dashboard writes to `config/runtime-env.json`, but the addon still respects traditional env vars for automation or container platforms. Key settings include:

### Relocating `runtime-env.json`

If you need to keep configuration outside the project tree (e.g. bind-mounting a host folder in Docker, using a central config path for multiple forks), set the environment variable `CONFIG_DIR` before starting the process:

```bash
CONFIG_DIR=/data/usenetstreamer-config node server.js
```

Rules:
- If `CONFIG_DIR` is set and non-empty, it is resolved with `path.resolve()` (relative paths become absolute from the current working directory).
- The file `runtime-env.json` will then live at: `$CONFIG_DIR/runtime-env.json`.
- The directory is auto-created if missing.
- Leaving `CONFIG_DIR` unset falls back to the bundled default `config/` directory next to the code.

This allows forks or containerized deployments to update upstream code without losing local runtime settings.

- `INDEXER_MANAGER` (default `prowlarr`) — set `nzbhydra` for Hydra.
- `INDEXER_MANAGER_URL`, `INDEXER_MANAGER_API_KEY`, `INDEXER_MANAGER_INDEXERS`, `INDEXER_MANAGER_STRICT_ID_MATCH`.
- `ADDON_BASE_URL` (must be HTTPS), `ADDON_SHARED_SECRET` (required for security).
- `NZB_SORT_MODE` (`quality_then_size` or `language_quality_size`), `NZB_PREFERRED_LANGUAGE`, `NZB_MAX_RESULT_SIZE_GB` (defaults to 30 GB, set 0 for no cap).
- `NZBDAV_URL`, `NZBDAV_API_KEY`, `NZBDAV_WEBDAV_URL`, `NZBDAV_WEBDAV_USER`, `NZBDAV_WEBDAV_PASS`, `NZBDAV_CATEGORY*`.
- `NZBDAV_HISTORY_FETCH_LIMIT`, `NZBDAV_CACHE_TTL_MINUTES` (controls instant detection cache).
- `NZB_TRIAGE_*` for NNTP health checks (host, port, user/pass, timeouts, candidate counts, reuse pool, etc.).

### Direct Newznab indexers (optional)

In addition to using an indexer manager (Prowlarr or NZBHydra), you can query one or more Newznab-compatible indexers in parallel. Configure these via environment variables or the admin dashboard:

- `NEWZNAB_ENABLED` — set to `true` to enable direct Newznab queries.
- `NEWZNAB_ENDPOINTS` — comma-separated list of base URLs, for example: `https://indexer1.example,https://indexer2.example`.
- `NEWZNAB_API_KEYS` — comma-separated list of API keys aligned with `NEWZNAB_ENDPOINTS`.
- `NEWZNAB_API_PATHS` — optional comma-separated list of API path prefixes per endpoint. Defaults to `/api` when omitted. Some indexers customize this path.
- `NEWZNAB_FILTER_NZB_ONLY` — when `true` (default), only results with an NZB download URL are returned.

Notes:
- Endpoints are matched by position across the three lists. If you provide three endpoints, provide up to three API keys and API paths in the same order.
- API paths are normalized to begin with `/` and have no trailing slash (e.g., `/api`, `/custom/api`). Full URLs are also accepted; only the path portion will be used.

See `.env.example` for the complete list and defaults.

---

## 🧠 Advanced Capabilities

### Language-based ordering
- Switch to `language_quality_size` sorting to pin a preferred language (set via dashboard or `NZB_PREFERRED_LANGUAGE`).
- Matching releases get a ⭐ tag plus `🌐 <Language>` badges, but non-matching streams stay available.

### Instant cache awareness
- Completed NZBDav titles and still-mounted NZBs are resolved by normalized titles.
- Instant streams jump to the top of the response and are logged in Stremio metadata (`cached`, `cachedFromHistory`).

### Health triage decisions
- Triage can mark NZBs `✅ verified`, `⚠️ unverified`, or `🚫 blocked`, reflected in stream tags.
- Approved samples optionally store NZB payloads in memory, letting NZBDav mount them without re-fetching.

---

## 🖥️ Platform Compatibility

| Platform | Status |
| --- | --- |
| Stremio 4.x desktop (Win/Linux) | ✅ Tested |
| Stremio 5.x beta | ✅ Tested |
| Android TV / Mobile | ✅ Tested |
| iOS via Safari/TestFlight | ✅ Tested |
| Web (Chromium-based browsers) | ✅ Tested |
| tvOS / Apple TV (Omni/Vidi/Fusion) | ✅ Reported working |

Anything that can load HTTPS manifests and handle `externalPlayer` hints should work. Open an issue or drop by Discord if you hit a platform-specific quirk.

---

## 🤝 Support & Community

- **Discord:** [Join the chat](https://discord.gg/NJsprZyz)
- **Buy me a coffee:** [Keep development humming](https://buymeacoffee.com/gaikwadsank)
- **Issues & PRs:** [GitHub tracker](https://github.com/Sanket9225/UsenetStreamer/issues)

Huge thanks to everyone testing, filing bugs, and sharing feature ideas.

---

<p align="center">
  <strong>Ready?</strong> Add <code>https://your-domain/super-secret-token/manifest.json</code> to Stremio and start streaming from your own Usenet stack.
</p>
