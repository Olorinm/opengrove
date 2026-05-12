FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV OPENGROVE_PROFILE=server
ENV OPENGROVE_BRIDGE_HOST=0.0.0.0
ENV OPENGROVE_BRIDGE_PORT=37371

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/web-dist ./web-dist
COPY --from=build /app/assets ./assets
COPY --from=build /app/extension ./extension
COPY --from=build /app/src/skills/bundled ./src/skills/bundled
COPY --from=build /app/README.md /app/README.zh-CN.md /app/LICENSE ./

EXPOSE 37371
CMD ["node", "dist/cli.js", "server"]
