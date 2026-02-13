# Use a lightweight Node.js image
FROM node:20-alpine

# Set working directory inside container
WORKDIR /usr/src/app

# Install system dependencies for archive inspection and video verification
RUN apk add --no-cache p7zip ffmpeg

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Expose the port the addon listens on
EXPOSE 7000

# Run the server
CMD ["npm", "start"]
