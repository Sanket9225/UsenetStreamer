# UsenetStreamer

UsenetStreamer is a Stremio addon that bridges Prowlarr and NZBDav. It hosts no media itself; it simply orchestrates search and streaming through your existing Usenet stack. The addon searches Usenet indexers via Prowlarr, queues NZB downloads in NZBDav, and exposes the resulting media as Stremio streams.

## Features

- ID-aware search plans (IMDb/TMDB/TVDB) with automatic metadata enrichment.
- Parallel Prowlarr queries with deduplicated NZB aggregation.
- Direct WebDAV streaming from NZBDav (no local mounts required).
- Configurable via environment variables (see `.env.example`).
- Fallback failure clip when NZBDav cannot deliver media.

## Getting Started

1. Copy `.env.example` to `.env` and fill in your Prowlarr/NZBDav credentials and addon base URL.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the addon:

   ```bash
   node server.js
   ```


## Environment Variables

- `PROWLARR_URL`, `PROWLARR_API_KEY`
- `NZBDAV_URL`, `NZBDAV_API_KEY`, `NZBDAV_WEBDAV_URL`, `NZBDAV_WEBDAV_USER`, `NZBDAV_WEBDAV_PASS`
- `ADDON_BASE_URL`

See `.env.example` for the authoritative list.

### Choosing an `ADDON_BASE_URL`

`ADDON_BASE_URL` must be the publicly reachable origin that hosts your addon. Stremio uses it to download the manifest, streams, and the icon (`/assets/icon.png`).

1. **Grab a DuckDNS domain (free):**
   - Sign in at [https://www.duckdns.org](https://www.duckdns.org) with GitHub/Google/etc.
   - Choose a subdomain (e.g. `myusenet.duckdns.org`) and note the token DuckDNS gives you.
   - Point the domain to your server by running their update script (CRON/systemd) so the IP stays current.

2. **Serve the addon on HTTPS:**
   - Use a reverse proxy such as Nginx, Caddy, or Traefik on your host.
   - Obtain a certificate:
     - **Let’s Encrypt** via certbot/lego/Traefik’s built-ins for fully trusted HTTPS.
     - Or DuckDNS’ ACME helper if you prefer wildcard certificates.
   - Proxy requests from `https://<your-domain>` to `http://localhost:<addon-port>` and expose `/manifest.json`, `/stream/*`, and `/assets/*`.

3. **Update `.env`:** set `ADDON_BASE_URL=https://myusenet.duckdns.org` and restart the addon so manifests reference the secure URL.

Tips:

- Keep port 7000 (or whichever you use) firewalled; let the reverse proxy handle public traffic.
- Renew certificates automatically (cron/systemd timer or your proxy’s auto-renew feature).
- If you deploy behind Cloudflare or another CDN, ensure WebDAV/body sizes are allowed and HTTPS certificates stay valid.
- Finally, add `https://myusenet.duckdns.org/manifest.json` (replace with your domain) to Stremio’s addon catalog.
