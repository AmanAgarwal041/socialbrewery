# Image for Cloudflare Containers (built by `wrangler deploy`). linux/amd64.
FROM node:22-alpine

RUN apk add --no-cache ca-certificates fuse curl

ARG TIGRISFS_VERSION=1.2.1
RUN ARCH=$(uname -m) && \
    case "$ARCH" in x86_64) ARCH=amd64 ;; aarch64) ARCH=arm64 ;; esac && \
    curl -fL "https://github.com/tigrisdata/tigrisfs/releases/download/v${TIGRISFS_VERSION}/tigrisfs_${TIGRISFS_VERSION}_linux_${ARCH}.tar.gz" -o /tmp/tigrisfs.tar.gz && \
    tar -xzf /tmp/tigrisfs.tar.gz -C /usr/local/bin/ && \
    rm /tmp/tigrisfs.tar.gz && \
    chmod +x /usr/local/bin/tigrisfs

ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY cloudflare/container-start.sh /container-start.sh

EXPOSE 3847
CMD ["sh", "/container-start.sh"]
