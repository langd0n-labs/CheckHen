# Development tools for install, typecheck, tests, and build. Keep the Node image the same as checkhen/Dockerfile.
FROM docker.io/library/node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl python3 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
