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
COPY scripts/ scripts/
RUN yarn install --immutable

# NEXT_PUBLIC_* values are inlined into the client bundle by `next build`, so they must be
# present HERE — setting them as container runtime env vars has no effect. Declared after
# `yarn install` so changing them doesn't invalidate the dependency layer.
#
# Both Cognito values are required: lib/cognito.ts throws at startup if either is empty, which is
# deliberate — defaulting them would ship a bundle pointed at the wrong user pool, and a
# build-time inlined mistake is invisible until someone tries to sign in.
#
# NEXT_PUBLIC_API_URL is the ALB origin. Web and API share it, so the browser makes same-origin
# requests and no CORS allowlist is needed.
ARG NEXT_PUBLIC_COGNITO_USER_POOL_ID
ARG NEXT_PUBLIC_COGNITO_CLIENT_ID
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_COGNITO_USER_POOL_ID=$NEXT_PUBLIC_COGNITO_USER_POOL_ID \
    NEXT_PUBLIC_COGNITO_CLIENT_ID=$NEXT_PUBLIC_COGNITO_CLIENT_ID \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# The web app now imports a workspace library (`@project-signal/help-content`, which carries the
# help corpus the assistant and the help centre share). Workspace packages resolve through their
# `main` field to `dist/`, which does not exist until they are built — without this the Next
# build fails with "Module not found", which reads like a missing dependency rather than an
# unbuilt one. The API image has always done the same thing one line before its own compile.
RUN sh scripts/build-libs.sh

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
