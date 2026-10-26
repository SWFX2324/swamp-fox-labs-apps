# Base image is pinned by digest (multi-arch: amd64 and aarch64); Dependabot
# proposes updates. Supervisor no
# longer supplies BUILD_FROM or reads build.yaml.
FROM ghcr.io/home-assistant/base:3.21@sha256:6f40fd4ef842d88b51bbd69d00ac4f7ba6a8ac4b23db87c3b529ea970158c731

# Released images are built by .github/workflows/build.yaml, which passes the
# version from config.yaml.
ARG BUILD_VERSION=dev
ENV APP_VERSION=${BUILD_VERSION}
LABEL org.opencontainers.image.source="https://github.com/SWFX2324/swamp-fox-labs-apps"

RUN apk add --no-cache nodejs

COPY app /app
WORKDIR /app

CMD ["node", "/app/server.js"]
