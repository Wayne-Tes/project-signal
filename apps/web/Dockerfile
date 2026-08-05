# Build the Next.js app with Yarn 4, then ship the self-contained standalone output.
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS builder
# `yarn install --immutable` needs the lockfile, .yarnrc.yml and every workspace
# manifest, so copy the workspaces wholesale; .dockerignore keeps node_modules/.next
# out of the build context.
COPY package.json yarn.lock .yarnrc.yml tsconfig.base.json ./
COPY apps/ apps/
COPY libs/ libs/
RUN yarn install --immutable
RUN yarn workspace @project-signal/web run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Next.js standalone output bundles its own runtime deps (incl. compiled workspace libs).
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static apps/web/.next/static
COPY --from=builder /app/apps/web/public apps/web/public

RUN addgroup -S signal && adduser -S signal -G signal
USER signal

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]
