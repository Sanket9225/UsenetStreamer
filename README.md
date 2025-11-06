# UsenetStreamer

![UsenetStreamer logo](assets/icon.png)

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

### Docker Usage

The image is published to the GitHub Container Registry. Pull it and run with your environment variables:

```bash
docker pull ghcr.io/sanket9225/usenetstreamer:latest

docker run -d \
   --name usenetstreamer \
   -p 7000:7000 \
   -e PROWLARR_URL=https://your-prowlarr-host:9696 \
   -e PROWLARR_API_KEY=your-prowlarr-api-key \
   -e NZBDAV_URL=http://localhost:3000 \
   -e NZBDAV_API_KEY=your-nzbdav-api-key \
   -e NZBDAV_WEBDAV_URL=http://localhost:3000 \
   -e NZBDAV_WEBDAV_USER=webdav-username \
   -e NZBDAV_WEBDAV_PASS=webdav-password \
   -e ADDON_BASE_URL=https://myusenet.duckdns.org \
   -e MANIFEST_AUTH_PASSWORD=your-secret-password \
   ghcr.io/sanket9225/usenetstreamer:latest
```

If you prefer to keep secrets in a file, use `--env-file /path/to/usenetstreamer.env` instead of specifying `-e` flags.

> Need a custom build? Clone this repo, adjust the code, then run `docker build -t usenetstreamer .` to create your own image.


## Environment Variables

- `PROWLARR_URL`, `PROWLARR_API_KEY`, `PROWLARR_STRICT_ID_MATCH`
- `NZBDAV_URL`, `NZBDAV_API_KEY`, `NZBDAV_WEBDAV_URL`, `NZBDAV_WEBDAV_USER`, `NZBDAV_WEBDAV_PASS`
- `ADDON_BASE_URL`
- `MANIFEST_AUTH_PASSWORD` (optional)

`PROWLARR_STRICT_ID_MATCH` defaults to `false`. Set it to `true` if you want strictly ID-based searches (IMDb/TVDB/TMDB only). This usually yields faster, more precise matches but many indexers do not support ID queries, so you will receive fewer total results.

`MANIFEST_AUTH_PASSWORD` is optional. When set, it requires authentication to access the manifest endpoint, preventing unauthorized users from adding your addon to their Stremio client.

See `.env.example` for the authoritative list.

### Choosing an `ADDON_BASE_URL`

`ADDON_BASE_URL` must be a **public HTTPS domain** that points to your addon deployment. Stremio refuses insecure origins, so you must front the addon with TLS before adding it to the catalog. DuckDNS + Let's Encrypt is an easy path, but any domain/CA combo works.

1. **Grab a DuckDNS domain (free):**
   - Sign in at [https://www.duckdns.org](https://www.duckdns.org) with GitHub/Google/etc.
   - Choose a subdomain (e.g. `myusenet.duckdns.org`) and note the token DuckDNS gives you.
   - Run their update script (cron/systemd/timer) so the domain always resolves to your server’s IP.

2. **Serve the addon over HTTPS (non-negotiable):**
   - Place Nginx, Caddy, or Traefik in front of the Node server.
   - Issue a certificate:
     - **Let’s Encrypt** with certbot, lego, or Traefik’s built-in ACME integration for a trusted cert.
     - DuckDNS also provides an ACME helper if you prefer wildcard certificates.
   - Terminate TLS at the proxy and forward requests from `https://<your-domain>` to `http://127.0.0.1:7000` (or your chosen port).
   - Expose `/manifest.json`, `/stream/*`, `/nzb/*`, and `/assets/*`. Stremio will reject plain HTTP URLs.

3. **Update `.env`:** set `ADDON_BASE_URL=https://myusenet.duckdns.org` and restart the addon so manifests reference the secure URL. Stremio will only load the addon when `ADDON_BASE_URL` points to a valid HTTPS domain.

Tips:

- Keep port 7000 (or whichever you use) firewalled; let the reverse proxy handle public traffic.
- Renew certificates automatically (cron/systemd timer or your proxy's auto-renew feature).
- If you deploy behind Cloudflare or another CDN, ensure WebDAV/body sizes are allowed and HTTPS certificates stay valid.
- Finally, add the manifest URL to Stremio's addon catalog (see below for URL format). Use straight HTTPS—the addon will not show up over HTTP.

### Adding the Addon to Stremio

**Without authentication** (when `MANIFEST_AUTH_PASSWORD` is not set):

1. Open your addon in a browser: `https://myusenet.duckdns.org`
2. Click the "Install" button on the landing page
3. Stremio will open and install the addon automatically

**With authentication** (when `MANIFEST_AUTH_PASSWORD` is set):

1. Open your addon in a browser: `https://myusenet.duckdns.org`
2. You'll be redirected to the configuration page automatically
3. Enter your `MANIFEST_AUTH_PASSWORD` value in the password field
4. Click "Install" button
5. Stremio will open and install the configured addon

The addon implements Stremio's official configuration system with:
- **Landing page** at `/` with auto-redirect to `/configure` when password is required
- **Configuration page** at `/configure` with a password input form
- **Automatic installation** - After entering your password, clicking "Install" generates a `stremio://` URL that opens Stremio

**How it works:**
- The configuration form encodes your password as base64 JSON in the installation URL
- Example: `stremio://domain.com/eyJwYXNzd29yZCI6InRlc3QifQ==/manifest.json`
- The encoded data (`eyJwYXNzd29yZCI6InRlc3QifQ==`) contains `{"password":"test"}`
- Stremio saves this URL and includes the userData in all future requests
- All manifest and stream requests validate the password on the server

**Security notes:**
- Passwords are validated on every request using middleware
- The password is stored in Stremio's addon configuration (not plaintext in URLs)
- All requests require authentication when password is configured
- Failed authentication returns 401/403 errors
