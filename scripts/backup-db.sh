#!/usr/bin/env sh
# Dump the bot's database to a timestamped file.
#
# Neither Aiven's free tier nor Supabase's retains a backup you can restore
# from, so this is the only copy that exists. Run it through dotenvx, which is
# what expands DATABASE_URL's ${...} parts:
#
#   ./node_modules/.bin/dotenvx run --quiet -- sh scripts/backup-db.sh
#
# Writes outside the repository by default. A dump holds every Discord username,
# member id and stored message in the guild, so it has no business sitting in a
# working tree where a stray `git add -A` can reach it.
set -eu

OUT_DIR="${BACKUP_DIR:-$HOME/backups/bibi-bot}"
KEEP="${BACKUP_KEEP:-14}"

mkdir -p "$OUT_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$OUT_DIR/bibi-$STAMP.dump"

# The password goes through the environment, never argv - anything on the
# command line is visible to every other process on the machine.
PGPASSWORD="$POSTGRES_PASSWORD" PGSSLMODE=require pg_dump \
  -h "$POSTGRES_HOST" \
  -p "${POSTGRES_PORT:-5432}" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --no-owner --no-privileges \
  --format=custom \
  --file "$FILE"

# A dump that cannot be read back is not a backup. pg_restore --list fails on a
# truncated or half-written file, which is the failure this catches.
pg_restore --list "$FILE" >/dev/null

echo "wrote $FILE ($(du -h "$FILE" | cut -f1))"

# Keep the last N, drop the rest.
ls -1t "$OUT_DIR"/bibi-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
  echo "pruned $(basename "$old")"
done
