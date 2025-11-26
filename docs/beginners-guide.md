# Beginner Guide

## 0. Accounts and Services You Need First

1. **Usenet Provider:** e.g., Newshosting, Easynews, Eweka. Without a provider, you cannot download anything.
   - *Tip:* German users should check [Mydealz](https://www.mydealz.de/) for Usenet provider deals. Other users should check Reddit, as it often has good deals.
2. **Indexer/API Access:** Pick one of the following:
   - Use the **built-in Easynews bridge** (uses your Easynews username/password).
   - Add one or more **direct Newznab APIs** (NZBGeek, Usenet-Crawler, etc.) straight into the UsenetStreamer admin panel.
   - *For German Users:* [SceneNZBs](https://scenenzbs.com/) is by far the best option.
   - *Optional:* Run **Prowlarr or NZBHydra** if you already prefer them, but they are no longer required for this guide.
3. **DuckDNS Account (Optional):** Only needed if you want public HTTPS access. For home/LAN streaming, you can skip this and use your server’s IP (e.g., `http://192.168.1.50:7000`). If you need remote access, sign up at [DuckDNS](https://www.duckdns.org), create a subdomain (e.g., `mystreamer`), and point it to your VPS/static IP.
   - It should look like [this](https://imgur.com/a/CHxhRzx).

## 1. Rent a VPS and Log In

The Oracle Free Tier is possible, but there is a risk of the account being terminated. For a cheap option, the [IONOS](https://www.ionos.de/server/vps) Vps-S package is more than enough.


### IMPORTANT
Your cloud provider usually has its own firewall. Log into your VPS dashboard and add inbound rules for ports 80, 443, 7000, 3000, and 22 (TCP)—plus 9696 if you chose to publish a manager. On Oracle/Vultr/AWS you’ll find this under “Security List,” “Firewall,” or “VPC security group.” If you skip this step, nothing outside the VPS will reach your services even though UFW allows them. If you expose Prowlarr/NZBHydra on the same box, also allow 9696/tcp.

Now log into your VPS:
```bash
ssh root@your-vps-ip
```

## 2. Install Docker, Compose, and Caddy

```bash
git clone https://github.com/Sanket9225/UsenetStreamer.git
cd UsenetStreamer/Scripts
chmod +x install_.sh
./install.sh
newgrp docker
```

## 3. Prepare Folders and Secrets

```bash
chmod +x usenetstack.sh
./usenetstack.sh
```

## 4. Configure the Services


Visit the services:

- `http://your-vps-ip:3000` – **Configure NZBDav:** Add your Usenet provider credentials, set up a WebDAV username/password, and note the API URL for later.
- `http://your-vps-ip:7000/<ADDON_SECRET>/admin/` – **Configure UsenetStreamer:**
  - Paste your NZBDav API/WebDAV info (click the "Test Connection" button).
  - Either enter Easynews credentials or add direct Newznab endpoints via the built-in presets.
  - *Optional:* If you still run Prowlarr/NZBHydra elsewhere, fill in the URL/API key and toggle which indexers you want shared.

## 5. Final Checklist

- Update `INDEXER_MANAGER_API_KEY`, NZBDav credentials, and `ADDON_BASE_URL` inside the UsenetStreamer dashboard (now reachable at your DuckDNS URL).
- Run the **Connection Tests** tab to confirm every service is reachable.
- Add `https://mystreamer.duckdns.org/super-secret-token/manifest.json` inside Stremio.

Need more help? Jump into [Discord](https://discord.gg/NJsprZyz) and share screenshots/logs.
