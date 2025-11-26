#!/bin/bash

# Stop execution if any command fails
set -e

# --- Configuration ---
INSTALL_DIR="$HOME/usenetstack"

echo "--- Starting UsenetStack Setup ---"

# 1. Detect User ID and Group ID automatically
MY_PUID=$(id -u)
MY_PGID=$(id -g)
echo "Detected User configuration: PUID=${MY_PUID}, PGID=${MY_PGID}"

# 2. Ask for the DuckDNS/Base URL
read -p "Enter your full DuckDNS/Base URL (e.g., https://my-app.duckdns.org): " USER_URL

# Validate URL input
if [ -z "$USER_URL" ]; then
  echo "Error: URL cannot be empty."
  exit 1
fi

# 3. Ask for the Shared Secret (User Input)
read -p "Enter your Shared Secret (enter a secure random string): " USER_SECRET

# Validate Secret input
if [ -z "$USER_SECRET" ]; then
  echo "Error: Secret cannot be empty."
  exit 1
fi

# 4. Prepare Folders
echo "Creating directories in $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR/nzbdav"
mkdir -p "$INSTALL_DIR/usenetstreamer-config"
mkdir -p "$INSTALL_DIR/prowlarr"

# Navigate to the directory
cd "$INSTALL_DIR"

# 5. Create docker-compose.yml
echo "Creating docker-compose.yml..."

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
      ADDON_BASE_URL: ${USER_URL}
      NZBDAV_URL: http://nzbdav:3000
      NZBDAV_WEBDAV_URL: http://nzbdav:3000
      CONFIG_DIR: /data/config
    volumes:
      - ./usenetstreamer-config:/data/config
EOF

# 6. Create .env file for reference
echo "Creating .env file..."
cat <<EOF > .env
ADDON_SECRET=${USER_SECRET}
EOF

echo "--- Setup Complete ---"
echo "Files created in: $INSTALL_DIR"
echo ""
echo "To start the containers, run:"
echo "cd $INSTALL_DIR && docker compose up -d"
