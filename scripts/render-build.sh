#!/bin/sh
# Render's build (render.yaml). Installs, optionally applies database changes, then builds.
# Database changes run here only when MIGRATE_ON_BUILD=true (on for staging). On production
# they normally go through the approved Deploy workflow in GitHub Actions instead (docs/RENDER.md).
set -eu

npm ci --include=dev

if [ "${MIGRATE_ON_BUILD:-false}" = "true" ]; then
  echo "Applying database changes (MIGRATE_ON_BUILD=true)..."
  # Neon's direct (non-pooled) connection is safest for migrations; the pooled one also works.
  DATABASE_URL="${DATABASE_URL_DIRECT:-$DATABASE_URL}" npx drizzle-kit migrate
fi

npm run build
