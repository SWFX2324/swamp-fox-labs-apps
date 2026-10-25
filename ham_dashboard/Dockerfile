# Base image is pinned here (multi-arch: amd64 and aarch64). Supervisor no
# longer supplies BUILD_FROM or reads build.yaml.
FROM ghcr.io/home-assistant/base:3.21

# Supervisor passes the app version from config.yaml.
ARG BUILD_VERSION=dev
ENV APP_VERSION=${BUILD_VERSION}

RUN apk add --no-cache nodejs

COPY app /app
WORKDIR /app

CMD ["node", "/app/server.js"]
