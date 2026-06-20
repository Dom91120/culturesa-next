#!/bin/sh
# Sauvegarde quotidienne de la base PostgreSQL avec rotation.
# Lancé par crond (cf. crontab). Les variables POSTGRES_* et la résolution du hôte
# « db » proviennent du conteneur cron (docker-compose : environment + réseau web).
#
# Rotation : on ne conserve que les RETAIN dumps les plus récents (≈ une semaine pour
# une exécution quotidienne) ; les plus anciens sont supprimés.
set -eu

DIR=/backups
RETAIN=7

mkdir -p "$DIR"
TS=$(date +%Y%m%d-%H%M%S)
TMP="$DIR/.culturesa-$TS.sql"          # nom à point → ignoré par le glob de rotation
FILE="$DIR/culturesa-$TS.sql.gz"

# Dump complet (schéma + données), restaurable tel quel via psql.
#   --clean --if-exists : DROP ... IF EXISTS avant CREATE (restauration sur base existante)
#   --no-owner --no-privileges : pas de dépendance aux rôles/ACL de l'instance source
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h db -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --no-privileges --clean --if-exists >"$TMP"
gzip -9 -c "$TMP" >"$FILE"
rm -f "$TMP"
echo "$(date '+%F %T') dump OK : $FILE ($(wc -c <"$FILE") octets)"

# Rotation : conserver les RETAIN plus récents (tri par date de modification).
ls -1t "$DIR"/culturesa-*.sql.gz 2>/dev/null | tail -n +$((RETAIN + 1)) | while IFS= read -r old; do
  rm -f "$old"
  echo "$(date '+%F %T') purge : $old"
done
