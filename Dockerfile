# Build the Vite client with the complete dependency set.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    MUSIC_DIR=/app/music
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 python3-pip tini \
    && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp mutagen \
    && ln -sf "$(command -v yt-dlp)" /usr/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/* /root/.cache/pip
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /app/music /app/data && chown -R node:node /app/music /app/data && chmod 755 /usr/local/bin/docker-entrypoint.sh
VOLUME ["/app/music", "/app/data"]
EXPOSE 8787
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
