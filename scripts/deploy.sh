#!/usr/bin/env bash
# First-time and repeat deploy to Cloudflare Pages + D1. Requires `npx wrangler login` (or CLOUDFLARE_API_TOKEN).
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${PROJECT:-chore-quest}"
if grep -q '00000000-0000-0000-0000-000000000000' wrangler.toml; then
  echo "Set database_id in wrangler.toml first (npx wrangler d1 create chore-quest)." >&2; exit 1
fi
npx wrangler pages project list | grep -qw "$PROJECT" || npx wrangler pages project create "$PROJECT" --production-branch main
if [ "${INIT_DB:-0}" = "1" ]; then
  npx wrangler d1 execute chore-quest --remote --file schema.sql --yes
  node scripts/seed.mjs --remote
fi
node scripts/build.mjs
npx wrangler pages deploy dist --project-name "$PROJECT" --branch main
