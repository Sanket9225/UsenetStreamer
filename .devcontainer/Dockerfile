# Use the official Deno image as base
FROM denoland/deno:latest

# Set working directory inside container
WORKDIR /app

# Cache dependencies if you have a deps.ts
# COPY deps.ts .
# RUN deno cache deps.ts

# Copy project files
COPY . .

# Expose port if your app runs a server (optional)
EXPOSE 8000

# Default command to run when container starts
CMD ["deno", "run", "--allow-net", "--allow-read", "mod.ts"]
