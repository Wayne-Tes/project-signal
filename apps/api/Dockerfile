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
RUN sh scripts/build-libs.sh && ./node_modules/.bin/tsc -p apps/api/tsconfig.build.json

# Production dependencies ONLY, resolved separately from the build.
#
# The runner used to copy node_modules from the builder, which meant every image shipped the
# whole monorepo's devDependencies: the API image carried Next.js (174MB), @next (124MB),
# Firebase (97MB), rspack (65MB), Nx (65MB) and TypeScript (23MB) — none of which it runs.
# 1.1GB of node_modules in a 1.65GB image.
#
# `yarn workspaces focus <workspace> --production` installs that workspace's production
# dependencies and its workspace siblings, and nothing else.
FROM base AS prod-deps
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/ apps/
COPY libs/ libs/
RUN yarn workspaces focus @project-signal/api --production

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Workspace libs are built to dist; node resolves @project-signal/* via node_modules -> libs/*/dist.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/migrations ./apps/api/migrations
COPY --from=builder /app/apps/api/package.json ./apps/api/

RUN addgroup -S signal && adduser -S signal -G signal
USER signal

EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
