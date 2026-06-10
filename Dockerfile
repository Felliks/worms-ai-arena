# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm test
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    PUBLIC_ROOT=/app \
    AGENT_LOG_DIR=/app/logs \
    AGENT_CONSOLE_LOGS=false

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev && npm cache clean --force

RUN mkdir -p /app/src/audio /app/logs
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/index.htm ./index.htm
COPY --from=build --chown=node:node /app/LICENSE.txt ./LICENSE.txt
COPY --from=build --chown=node:node /app/css ./css
COPY --from=build --chown=node:node /app/data ./data
COPY --from=build --chown=node:node /app/external ./external
COPY --from=build --chown=node:node /app/assets ./assets
COPY --from=build --chown=node:node /app/src/Worms.js ./src/Worms.js
COPY --from=build --chown=node:node /app/src/audio/SoundBufferLoader.js ./src/audio/SoundBufferLoader.js
RUN chown -R node:node /app/logs

USER node
EXPOSE 8787
CMD ["node", "dist/server/index.js"]
