# Build the monorepo with Yarn 4 (node-modules linker), then ship a slim runtime.
FROM node:26-alpine AS base
# Node 25+ no longer bundles corepack, so it is installed explicitly and PINNED: an unpinned
# install would make the image depend on whatever npm serves on the day of the build. 0.36.0 is
# the version verified on the development host on 2026-11-16 to provide yarn 4.9.2 from the
# root package.json "packageManager" field.
RUN npm install -g corepack@0.36.0 && corepack enable
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

# Production dependencies ONLY, resolved separately from the build.
#
# The runner used to copy node_modules from the builder, which shipped the whole monorepo's
# devDependencies in every image — Next.js, Firebase, rspack, Nx and TypeScript, none of which a
# backend service runs. That was 1.1GB of node_modules inside a 1.65GB image; this brings it to
# roughly 330MB, which is the difference between a fast ECS rollout and a slow one.
FROM base AS prod-deps
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/ apps/
COPY libs/ libs/
RUN yarn workspaces focus @project-signal/sentiment-worker --production

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Workspace libs are built to dist; node resolves @project-signal/* via node_modules -> libs/*/dist.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/sentiment-worker/dist ./apps/sentiment-worker/dist
COPY --from=builder /app/apps/sentiment-worker/package.json ./apps/sentiment-worker/

RUN addgroup -S signal && adduser -S signal -G signal
USER signal

EXPOSE 8082
CMD ["node", "apps/sentiment-worker/dist/main.js"]
