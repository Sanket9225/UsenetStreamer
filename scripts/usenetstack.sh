#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# --- Configuration ---
INSTALL_DIR="$HOME/usenetstack"

echo "==========================================="
echo "   UsenetStack All-in-One Installer"
echo "==========================================="

# --- STEP 1: GATHER USER INPUTS ---

# 1. Domain Name
echo ""
echo "Please enter your Domain/DuckDNS URL (without https://)."
read -p "Example (mystreamer.duckdns.org): " USER_DOMAIN

if [ -z "$USER_DOMAIN" ]; then
  echo "Error: Domain cannot be empty."
  exit 1
fi

# Construct the full URL for the App Config
FULL_URL="https://$USER_DOMAIN"

# 2. Shared Secret
echo ""
read -p "Enter your Shared Secret (enter a secure random string): " USER_SECRET

if [ -z "$USER_SECRET" ]; then
  echo "Error: Secret cannot be empty."
  exit 1
fi

# 3. Prowlarr/Hydra Choice
echo ""
read -p "Do you want to expose Prowlarr/NZBHydra on Port 9696? (y/n): " PROWLARR_CHOICE


# --- STEP 2: INSTALL SYSTEM DEPENDENCIES ---

echo ""
echo "--- [1/5] Installing Docker & Dependencies ---"

# Update and install prerequisites
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release debian-keyring debian-archive-keyring apt-transport-https

# Add Docker GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Set up Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER

echo "Docker installed."


# --- STEP 3: INSTALL CADDY ---

echo ""
echo "--- [2/5] Installing Caddy Web Server ---"

# Add Caddy GPG key and Repo
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list

# Install Caddy
sudo apt update
sudo apt install -y caddy

echo "Caddy installed."


# --- STEP 4: CONFIGURE FIREWALL (UFW) ---

echo ""
echo "--- [3/5] Configuring Firewall ---"

# Basic Rules
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw allow 3000/tcp # NZBDav
sudo ufw allow 7000/tcp # UsenetStreamer

# Optional Prowlarr Rule
if [[ "$PROWLARR_CHOICE" =~ ^[Yy]$ ]]; then
    echo "Allowing Port 9696 (Prowlarr/Hydra)..."
    sudo ufw allow 9696/tcp
fi

# Enable Firewall
sudo ufw --force enable
sudo ufw reload

echo "Firewall active."


# --- STEP 5: CONFIGURE CADDY ---

echo ""
echo "--- [4/5] Configuring Caddy Reverse Proxy ---"

echo "Writing configuration for $USER_DOMAIN..."
cat <<EOF | sudo tee /etc/caddy/Caddyfile
$USER_DOMAIN {
    reverse_proxy 127.0.0.1:7000
}
EOF

echo "Restarting Caddy..."
sudo systemctl restart caddy


# --- STEP 6: SETUP & LAUNCH APPLICATION ---

echo ""
echo "--- [5/5] Deploying UsenetStack Containers ---"

# Detect ID
MY_PUID=$(id -u)
MY_PGID=$(id -g)

# Create Directories
mkdir -p "$INSTALL_DIR/nzbdav"
mkdir -p "$INSTALL_DIR/usenetstreamer-config"
mkdir -p "$INSTALL_DIR/prowlarr"

cd "$INSTALL_DIR"

# Create docker-compose.yml
cat <<EOF > docker-compose.yml
version: "3.9"

services:
  nzbdav:
    image: nzbdav/nzbdav:alpha
    container_name: nzbdav
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PUID=${MY_PUID}
      - PGID=${MY_PGID}
    volumes:
      - ./nzbdav:/config

  usenetstreamer:
    image: ghcr.io/sanket9225/usenetstreamer:latest
    container_name: usenetstreamer
    restart: unless-stopped
    depends_on:
      - nzbdav
    ports:
      - "7000:7000"
    environment:
      ADDON_SHARED_SECRET: ${USER_SECRET}
      ADDON_BASE_URL: ${FULL_URL}
      NZBDAV_URL: http://nzbdav:3000
      NZBDAV_WEBDAV_URL: http://nzbdav:3000
      CONFIG_DIR: /data/config
    volumes:
      - ./usenetstreamer-config:/data/config
EOF

# Create .env for user reference
echo "ADDON_SECRET=${USER_SECRET}" > .env

# Launch Containers
# Note: We use sudo here because the group change from Step 2 
# won't apply to the current shell script until a logout occurs.
echo "Pulling images and starting containers..."
sudo docker compose up -d

echo ""
echo "==========================================="
echo "      INSTALLATION SUCCESSFUL!"
echo "==========================================="
echo "1. Dashboard: $FULL_URL/$USER_SECRET/admin/"
echo "2. NZBDav:    http://$USER_DOMAIN:3000 (or via IP)"
echo ""
echo "NOTE: To use 'docker' commands manually in the future,"
echo "      please log out and log back in."
echo "==========================================="
