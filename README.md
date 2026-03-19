# UsenetStreamer

<p align="center">
  <img src="assets/icon.png" alt="UsenetStreamer logo" width="180" />
</p>

<p align="center">
  <strong>Your Usenet-powered bridge between Prowlarr/NZBHydra, NZBDav, and Stremio.</strong><br />
  Query your favorite indexers, stream directly over WebDAV, and manage it all from a friendly web dashboard.
</p>

<p align="center">
  <a href="https://discord.gg/tUwNjXSZZN"><img src="https://img.shields.io/badge/Discord-Join-blue?logo=discord&logoColor=white" alt="Join Discord" /></a>
  <a href="https://buymeacoffee.com/gaikwadsank"><img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-yellow?logo=buymeacoffee&logoColor=white" alt="Buy me a coffee" /></a>
  <a href="https://ghcr.io/sanket9225/usenetstreamer"><img src="https://img.shields.io/badge/Docker-ghcr.io%2Fsanket9225%2Fusenetstreamer-blue?logo=docker" alt="Docker image" /></a>
</p>

---

## 🔗 Quick Links

- **Docker image:** `ghcr.io/sanket9225/usenetstreamer:latest`
- **Admin dashboard:** `https://your-addon-domain/<admin-token (ADDON_SHARED_SECRET)>/admin/`
- **Manifest template:** `https://your-addon-domain/<stream-token>/manifest.json`
- **Discord:** [Community chat](https://discord.gg/tUwNjXSZZN)
- **Support:** [Buy me a coffee](https://buymeacoffee.com/gaikwadsank)
- **Self-hosting guide:** [Jump to instructions](#-deployment)

---

> **Disclaimer:** UsenetStreamer is not affiliated with any Usenet provider or indexer, does not host or distribute media, and is offered strictly for educational purposes.

> **⚠️ Upgrade notice:** If you are upgrading from a version older than 1.7.6, you may need to reinstall the addon in Stremio for changes to take effect.

## ☕ Support Development

**[Buy Me A Coffee &rarr;](https://buymeacoffee.com/gaikwadsank)** — every cup keeps the addon maintained, hosted, and packed with new features.

---

## ✨ Feature Highlights

### 🆕 Recent Enhancements
- **Stream Protection modes** — unified protection selector in the dashboard: `none`, `auto-advance`, `health-check`, `health-check-auto-advance`, `smart-play-only`, and `smart-play`.
- **Smart Play (background triage)** — background health checks add a dedicated Smart Play stream that can auto-pick healthy candidates while checks continue.
- **Custom sorting chain** — `NZB_SORT_ORDER` drives result ordering with any combination of: `language`, `release_group`, `size`, `resolution`, `quality`, `encode`, `visual_tag`, `audio_tag`, `keyword`, `date`, `files`. Default chain: `quality,size,files`.
- **Per-indexer capability gating** — ID-based plans run only on indexers that advertise required caps support (e.g., skip `imdbid` tvsearch where unsupported).
- **Anime ID support** — accepts `kitsu:`, `mal:`, and `anilist:` IDs and resolves them to IMDb/TVDb via bundled mapping databases (Fribb, Kitsu-IMDB, Manami).

### 🚀 Performance & Caching
- Parallel queries to Prowlarr or NZBHydra with automatic deduplication.
- Two-tier cache (Stremio responses + verified NZBs) to keep repeat requests instant.

### 🔍 Smart Search & Language Filtering
- IMDb/TMDb/TVDb and anime-ID (`kitsu:`, `mal:`, `anilist:`) aware search plans with TVDB-prefixed ID support (no Cinemeta needed). Anime IDs are resolved to IMDb/TVDb via bundled mapping databases.
- Release titles parsed for resolution, quality, and audio language — sorting is fully configurable via `NZB_SORT_ORDER` (e.g. `quality,size,files`, `language,quality,date`, or any combination).
- Preferred language groups (single or multiple) rise to the top and display with clear 🌐 labels.
- Optional dedupe filter (enabled by default) collapses duplicates when normalized title + Usenet group match within the publish window; keeps preferred result by paid indexer, then lower file count.
- A single per-quality cap (e.g., 4) keeps only the first few results for each resolution before falling back to the next tier.

### ⚡ Instant Streams from NZBDav
- Completed NZBDav jobs are recognized automatically and surfaced with a ⚡ tag.
- Instant streams are floated to the top of the list so you can start watching immediately.

### 🔌 Built-in Easynews Indexer
- Toggle Easynews in the admin panel, drop in your username/password, and get native search results without running the standalone proxy.
- Movies/series use strict Cinemeta matching for precise hits, while external text-only addons stay in loose mode.
- Easynews results skip triage (they're treated as ✅ verified) but still flow through the usual dedupe/sorting pipeline.

### 🩺 NNTP Health Checks
- Optional triage downloads a handful of NZBs, inspects archive contents, and flags bad uploads before Stremio sees them.
- Archive checks are used to peek inside NZBs and verify two things before selection:
  1) the archive format is supported by NZBDav
  2) playable video files are present in the payload
- Decisions are cached per download URL and per normalized title, so later requests inherit health verdicts instantly.

### 🔐 Secure-by-Default
- **Admin token** (`ADDON_SHARED_SECRET`) — used to access the admin dashboard where you can edit settings and credentials. Credentials are write-only (never exposed back to the UI).
- **Stream token** (`ADDON_STREAM_TOKEN`) — a separate token used only for streaming; it cannot access the admin dashboard or modify any settings.

---

## 🗺️ How It Works

1. **Stremio request:** Stremio calls `/stream/<type>/<id>.json` (optionally with `?lang=de` or other hints).
2. **Indexer search:** UsenetStreamer plans IMDb/TMDb/TVDb/anime-ID searches plus fallbacks and queries Prowlarr/NZBHydra simultaneously.
3. **Release parsing:** Titles are normalized for resolution, size, and language; oversize files above your cap are dropped.
4. **Triage & caching (optional):** Health checks sample NZBs via NNTP; decisions and NZBs are cached.
5. **NZBDav streaming:** Chosen NZBs feed NZBDav, which exposes a WebDAV stream back to Stremio.
6. **Instant detection:** Completed NZBDav jobs are matched by normalized title and tagged ⚡ for instant playback.

---

## 🐳 Deployment

### Docker (recommended)

```bash
mkdir -p ~/usenetstreamer-config
docker run -d --restart unless-stopped \
  --name usenetstreamer \
  --log-opt max-size=10m \
  --log-opt max-file=1 \
  -p 7000:7000 \
  -e ADDON_SHARED_SECRET=super-secret-token \
  -e CONFIG_DIR=/data/config \
  -v ~/usenetstreamer-config:/data/config \
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
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "1"
    environment:
      ADDON_SHARED_SECRET: super-secret-token
      CONFIG_DIR: /data/config
    volumes:
      - ./usenetstreamer-config:/data/config
```

Then browse to `https://your-domain/super-secret-token/admin/` to enter your credentials. The `CONFIG_DIR` variable tells the addon to store `runtime-env.json` under the mounted path so your admin settings survive container recreations. The container ships with Node 20, exposes port 7000, and supports both `linux/amd64` and `linux/arm64` thanks to `buildx`.

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

The dashboard and stream routes are protected by secret tokens. Rotate secrets/tokens if you ever suspect exposure.

---

## ⚙️ Configuration & Environment Variables *(prefer the admin dashboard)*

- **Indexer sources:** `INDEXER_MANAGER` (`none`, `prowlarr`, `nzbhydra`), `INDEXER_MANAGER_URL`, `INDEXER_MANAGER_API_KEY`, `INDEXER_MANAGER_INDEXERS`, `INDEXER_MANAGER_STRICT_ID_MATCH`.
- **Direct Newznab mode:** `NEWZNAB_ENABLED`, `NEWZNAB_FILTER_NZB_ONLY`, numbered `NEWZNAB_*` entries, optional `NEWZNAB_CAPS_CACHE`.
- **Addon security + routing:** `ADDON_BASE_URL` (HTTPS), `ADDON_SHARED_SECRET` (required), optional `ADDON_STREAM_TOKEN` (separate stream token).
- **Sorting + filtering:** `NZB_SORT_MODE` (legacy/back-compat), `NZB_SORT_ORDER` (priority chain, default `quality,size,files`), `NZB_PREFERRED_LANGUAGE`, `NZB_DEDUP_ENABLED`, `NZB_MAX_RESULT_SIZE_GB`, `NZB_ALLOWED_RESOLUTIONS`, `NZB_RESOLUTION_LIMIT_PER_QUALITY`, `NZB_RELEASE_EXCLUSIONS`.
- **Stream naming:** `NZB_DISPLAY_NAME_PATTERN`, `NZB_NAMING_PATTERN` with token-list support (`title`, `stream_quality`, `source`, `codec`, `group`, `size`, `files`, `date`, `languages`, `indexer`, `health`, etc.).
- **NZBDav:** `NZBDAV_URL`, `NZBDAV_API_KEY`, WebDAV credentials, category controls, and history/cache options.
- **Easynews:** `EASYNEWS_ENABLED`, `EASYNEWS_USERNAME`, `EASYNEWS_PASSWORD`, optional size/text-mode flags.
- **TMDb/TVDb/anime metadata assist:** `TMDB_ENABLED`, `TMDB_API_KEY`, `TMDB_SEARCH_MODE` (`english_only` / `english_and_regional`), `TMDB_SEARCH_LANGUAGES`, `TVDB_ENABLED`, `TVDB_API_KEY`, plus built-in anime ID mapping support.
- **Stream protection + health checks:** `NZB_STREAM_PROTECTION`, `NZB_AUTO_ADVANCE_STRATEGY`, `NZB_SMART_PLAY_MODE`, and `NZB_TRIAGE_*` NNTP/triage controls.
- **Archive-check knobs:** `NZB_TRIAGE_HEALTH_METHOD`, `NZB_TRIAGE_STAT_SAMPLE_COUNT`, and `NZB_TRIAGE_ARCHIVE_SAMPLE_COUNT`.

See `.env.example` for the complete list and defaults.

---

## 🧠 Advanced Capabilities

### Language-based ordering
- Switch to `language_quality_size` sorting to pin one or more preferred languages (set via dashboard or `NZB_PREFERRED_LANGUAGE=English,Tamil`).
- Matching releases get a ⭐ tag plus `🌐 <Language>` badges, but non-matching streams stay available.

### Instant cache awareness
- Completed NZBDav titles and still-mounted NZBs are resolved by normalized titles.
- Instant streams jump to the top of the response and are logged in Stremio metadata (`cached`, `cachedFromHistory`).

### Health triage decisions
- Triage can mark NZBs `✅ verified`, `⚠️ unverified`, or `🚫 blocked`, reflected in stream tags.
- Approved samples optionally store NZB payloads in memory, letting NZBDav mount them without re-fetching.

### Stream protection modes
- **None** — no health checks, no auto-advance.
- **Auto-Advance** — no health checks; fallback only when a stream fails.
- **Upfront Health Check** — triage before returning stream list.
- **Upfront Health Check + Auto-Advance** — upfront filtering plus fallback queueing.
- **Background Health Check + Smart Play** — return immediately, verify in background, Smart Play picks healthy results.
- **Background Health Check + Smart Play + Auto-Advance** — Smart Play plus auto-advance protection.

---

## 🖥️ Platform Compatibility

| Platform | Status |
| --- | --- |
| Stremio 4.x desktop (Win/Linux) | ✅ Tested |
| Stremio 5.x beta | ✅ Tested |
| Android TV / Mobile | ✅ Tested |
| iOS via Safari/TestFlight | ✅ Tested |
| Web (Chromium-based browsers) | ✅ Tested |
| tvOS / Apple TV (Omni/Vidi/Fusion) | ✅ Tested |

Anything that can load HTTPS manifests and handle `externalPlayer` hints should work. Open an issue or drop by Discord if you hit a platform-specific quirk.

---

## 🤝 Support & Community

- **Discord:** [Join the chat](https://discord.gg/tUwNjXSZZN)
- **Buy me a coffee:** [Keep development humming](https://buymeacoffee.com/gaikwadsank)
- **Issues & PRs:** [GitHub tracker](https://github.com/Sanket9225/UsenetStreamer/issues)

Huge thanks to everyone testing, filing bugs, and sharing feature ideas.
