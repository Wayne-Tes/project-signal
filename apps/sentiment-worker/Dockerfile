# Build the monorepo with Yarn 4 (node-modules linker), then ship a slim runtime.
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS builder
# yarn install --immutable needs the lockfile, .yarnrc.yml and every workspace manifest,
# so copy the workspaces wholesale; .dockerignore keeps node_modules/dist out of context.
COPY package.json yarn.lock .yarnrc.yml tsconfig.base.json ./
COPY apps/ apps/
COPY libs/ libs/
COPY scripts/ scripts/
RUN yarn install --immutable
# Build libs (esbuild bundle + .d.ts) in dependency order, then this app (tsc).
# Deterministic and Nx-independent.
RUN sh scripts/build-libs.sh && ./node_modules/.bin/tsc -p apps/sentiment-worker/tsconfig.build.json

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Workspace libs are built to dist; node resolves @project-signal/* via node_modules -> libs/*/dist.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/sentiment-worker/dist ./apps/sentiment-worker/dist
COPY --from=builder /app/apps/sentiment-worker/package.json ./apps/sentiment-worker/

RUN addgroup -S signal && adduser -S signal -G signal
USER signal

EXPOSE 8080
CMD ["node", "apps/sentiment-worker/dist/main.js"]
