#!/usr/bin/env bash
# Non-interactive migration generator: diffs the live dev database against schema.prisma,
# writes a new migration folder, applies it, and regenerates the client.
# Usage: bash scripts/new-migration.sh <name>
set -euo pipefail
name="${1:?migration name required}"
dir="prisma/migrations/$(date -u +%Y%m%d%H%M%S)_${name}"
sql=$(npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script)
if echo "$sql" | grep -q "empty migration"; then echo "No schema changes."; exit 0; fi
mkdir -p "$dir"
echo "$sql" > "$dir/migration.sql"
echo "Created $dir"
cat "$dir/migration.sql"
npx prisma migrate deploy
npx prisma generate
