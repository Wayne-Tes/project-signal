#!/bin/sh
# Build the workspace libs to JS in dependency order (leaves first). Deterministic and
# Nx-independent — used by the app Dockerfiles.
#
# esbuild bundles each lib's relative (internal) imports into a single dist/index.js, so
# emitted code has no unresolved extensionless specifiers at runtime. node_modules and
# sibling @project-signal/* packages stay external (resolved via node_modules to their own dist).
# tsc emits the .d.ts that consumer builds typecheck against.
set -e
for lib in config shared-types db storage scoring llm messaging source-adapters; do
  echo "building @project-signal/$lib"
  ./node_modules/.bin/esbuild "libs/$lib/src/index.ts" \
    --bundle --platform=node --format=esm --packages=external \
    --outfile="libs/$lib/dist/index.js"
  ./node_modules/.bin/tsc -p "libs/$lib/tsconfig.build.json" --emitDeclarationOnly
done
