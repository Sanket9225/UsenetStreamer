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

## 2. Install Docker, Compose, Caddy and the Usenetstreamer Stack
```bash
git clone https://github.com/Sanket9225/UsenetStreamer.git
cd UsenetStreamer/scripts
chmod +x install.sh
./install.sh
```

## 3. Configure the Services

Visit the services:

- `http://your-vps-ip:3000` – **Configure NZBDav:** Add your Usenet provider credentials, set up a WebDAV username/password, and note the API URL for later.
- `http://your-vps-ip:7000/<ADDON_SECRET>/admin/` – **Configure UsenetStreamer:**
  - Paste your NZBDav API/WebDAV info (click the "Test Connection" button).
  - Either enter Easynews credentials or add direct Newznab endpoints via the built-in presets.
  - *Optional:* If you still run Prowlarr/NZBHydra elsewhere, fill in the URL/API key and toggle which indexers you want shared.

## 4. Final Checklist

- Update `INDEXER_MANAGER_API_KEY`, NZBDav credentials, and `ADDON_BASE_URL` inside the UsenetStreamer dashboard (now reachable at your DuckDNS URL).
- Run the **Connection Tests** tab to confirm every service is reachable.
- Add the link displayed at the bottom of the UsenetStreamer dashboard into stremios addon search bar and a install window should pop up.

## Optional
Once everything is configured i suggest disabling the port rules as they pose a secruity risk. Furthermore shh password based authentication also poses a risk, so if you can switch do it. If you still want to acces your services you can create a ssh tunnel to your server and than use them with:
```
http://localhost:port
```

Need more help? Jump into [Discord](https://discord.gg/NJsprZyz) and share screenshots/logs.

## In german

# Einsteiger-Guide

## 0. Benötigte Accounts und Dienste

1. **Usenet-Anbieter:** z. B. Newshosting, Easynews, Eweka. Ohne einen Anbieter kannst du nichts herunterladen.
   - *Tipp:* Deutsche Nutzer sollten auf [Mydealz](https://www.mydealz.de/) nach Angeboten für Usenet-Anbieter suchen. 
2. **Indexer/API-Zugriff:** Wähle eine der folgenden Optionen:
   - Nutze die **integrierte Easynews-Bridge** (verwendet deinen Easynews-Benutzernamen/Passwort). Das ist hauptsächlich für           englischen content
   - [SceneNZBs](https://scenenzbs.com/) ist mit Abstand die beste Option für deutschen Content.
   - *Optional:* Lasse **Prowlarr oder NZBHydra** laufen, wenn du diese bevorzugst; sie sind für diesen Guide jedoch nicht mehr       erforderlich.
3. **DuckDNS-Account (Optional):** Nur erforderlich, wenn du öffentlichen HTTPS-Zugriff wünschst(Streaming von außerhalb deines Heimnetzwerkes). Für Streaming im Heimnetzwerk (LAN) kannst du dies überspringen und die IP deines Servers nutzen (z. B. `http://192.168.1.50:7000`). Falls du Fernzugriff benötigst, registriere dich bei [DuckDNS](https://www.duckdns.org), erstelle eine Subdomain (z. B. `mystreamer`) und verweise sie auf die statische IP deines VPS.
   - Das sollte [so aussehen](https://imgur.com/a/CHxhRzx).

## 1. VPS mieten und einloggen

Der Oracle Free Tier ist möglich, birgt aber das Risiko, dass der Account gekündigt wird. Für eine günstige Option sollte das [IONOS](https://www.ionos.de/server/vps) VPS-S Paket mehr als ausreichen.

### WICHTIG
Dein Cloud-Anbieter hat meistens eine eigene Firewall. Logge dich in dein VPS-Dashboard ein und füge eingehende Regeln (Inbound Rules) für die **Ports 80, 443, 7000, 3000 und 22 (TCP)** hinzu. Falls du dich entschieden hast, einen Manager (Prowlarr/Hydra) zu nutzen, füge auch **Port 9696** hinzu.

Bei Oracle/Vultr/AWS findest du dies unter „Security List“, „Firewall“ oder „VPC security group“. **Wenn du diesen Schritt überspringst, kann nichts von außen auf deine Dienste zugreifen, selbst wenn die UFW-Firewall auf dem Server sie erlaubt.**

Logge dich nun in deinen VPS ein:
```bash
ssh root@deine-vps-ip
```

## 2. Installation von Docker, Compose, Caddy und dem UsenetStreamer-Stack

```bash
git clone [https://github.com/Sanket9225/UsenetStreamer.git](https://github.com/Sanket9225/UsenetStreamer.git)
cd UsenetStreamer/scripts
chmod +x install.sh
./install.sh
```

## 3. Konfiguration der Dienste

Rufe die Dienste auf:

- `http://deine-vps-ip:3000` – **NZBDav konfigurieren:** Füge die Zugangsdaten deines Usenet-Anbieters hinzu, erstelle einen WebDAV-Benutzer/Passwort und notiere dir die API-URL für später.
- `http://deine-vps-ip:7000/<ADDON_SECRET>/admin/` – **UsenetStreamer konfigurieren:**
  - Füge deine NZBDav API/WebDAV-Infos ein (klicke auf den Button "Test Connection").
  - Gib entweder deine Easynews-Zugangsdaten ein oder füge direkte Newznab-Endpunkte über die Voreinstellungen hinzu.
  - Füge hier SceneNBZ als Indexer hinzu. die Zugangsdaten findest du in deinem SceneNBZ account.
  - *Optional:* Falls du Prowlarr/NZBHydra woanders betreibst, trage die URL/API-Key ein und wähle aus, welche Indexer geteilt werden sollen.

## 4. Abschließende Checkliste

- Aktualisiere `INDEXER_MANAGER_API_KEY`, NZBDav-Zugangsdaten und `ADDON_BASE_URL` im UsenetStreamer-Dashboard (jetzt über deine DuckDNS-URL erreichbar).
- Führe den **Connection Tests**-Tab aus, um zu bestätigen, dass jeder Dienst erreichbar ist.
- Füge den Link, der unten im UsenetStreamer-Dashboard angezeigt wird, in die Suchleiste der Stremio-Addons ein; ein Installationsfenster sollte erscheinen.

## Optional

Sobald alles konfiguriert ist, empfehle ich, die Port-Regeln (für 3000, 7000 etc.) wieder zu deaktivieren, da offene Ports ein Sicherheitsrisiko darstellen. Ferner empfehle ich auch ssh nicht mit einem passwort zu benutzen. Wenn du später auf deine Dienste zugreifen möchtest, kannst du einen SSH-Tunnel zu deinem Server erstellen und sie dann wie folgt aufrufen:

```
http://localhost:port
```

Brauchst du mehr Hilfe? Komm in den [Discord](https://discord.gg/NJsprZyz) und teile Screenshots oder Logs.
