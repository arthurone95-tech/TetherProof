# syntax=docker/dockerfile:1

# TetherProof API — packaged for Railway (and any other container host).
#
# The API is one workspace of an npm-workspaces repository and imports
# @tetherproof/shared from its compiled dist/, so the image builds the whole
# workspace graph from the lockfile and ships only the API in the end.

FROM node:24-alpine AS build

WORKDIR /repo

# Manifests first, so the dependency layer can be cached independently of
# source changes. npm ci resolves the whole workspace, so every workspace
# manifest must be present before it can run. tsconfig.base.json is extended
# by every workspace's tsconfig ("../../tsconfig.base.json") and must be
# present too, or tsc fails with TS5083.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

# Only the API and the shared package it imports are needed to compile it.
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/

RUN npm run build:shared && npm run build --workspace @tetherproof/api

FROM node:24-alpine AS runner

ENV NODE_ENV=production
WORKDIR /repo

# The full installed tree carries the workspace symlink that resolves
# `@tetherproof/shared` to packages/shared/dist, copied right below.
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/api ./apps/api

EXPOSE 4000

# The API listens on API_PORT, falling back to the platform-injected PORT,
# then 4000 (apps/api/src/config/env.ts). Railway injects PORT; its health
# check should probe /api/v1/health.
CMD ["node", "apps/api/dist/index.js"]