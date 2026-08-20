#!/bin/sh
# Export MANUEL de la base, lancé en ligne de commande sur l'hôte :
#   docker compose exec --user 1001:1001 cron backup.sh
#
# `--user 1001:1001` (l'utilisateur applicatif) est OBLIGATOIRE depuis le
# durcissement D4 : `cap_drop: ALL` retire à root CAP_DAC_OVERRIDE, donc root
# lui-même ne peut plus écrire dans /backups (possédé par 1001) — constaté le
# 2026-08-20 (« Permission denied »). Lancé sous 1001, le dump naît directement
# avec le bon propriétaire, sans aucune capacité.
#
# PAS utilisé par l'application ni par le crontab : l'export PLANIFIÉ est produit
# par l'app (route /api/cron/backup). Ce script embarqué dans l'image cron parle
# directement à Postgres (hôte « db »), il fonctionne donc même si le conteneur
# app est HS — c'est son intérêt (dump de secours avant intervention).
#
# Nommage `manuel-<ts>` : même convention que le bouton « Créer un export
# maintenant » de l'admin — la rotation applicative (7 derniers `culturesa-*`)
# ne purge JAMAIS ces fichiers ; penser à les supprimer quand ils ne servent plus.
set -eu

DIR=/backups
TS=$(date +%Y%m%d-%H%M%S)
TMP="$DIR/.manuel-$TS.sql"          # nom à point → ignoré par la liste des exports
FILE="$DIR/manuel-$TS.sql.gz"

# Mêmes options que l'export automatique (cf. src/server/services/backup.ts) :
#   --clean --if-exists : DROP ... IF EXISTS avant CREATE (restauration sur base existante)
#   --no-owner --no-privileges : pas de dépendance aux rôles/ACL de l'instance source
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h db -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --no-privileges --clean --if-exists >"$TMP"
gzip -9 -c "$TMP" >"$FILE"
rm -f "$TMP"
# Sous 1001 le fichier a déjà le bon propriétaire ; le chown ne subsiste que
# pour une éventuelle exécution root (CAP_CHOWN requise, elle aussi retirée
# par le durcissement — d'où le garde plutôt qu'un échec en toute fin).
[ "$(id -u)" != 0 ] || chown 1001:1001 "$FILE"

echo "$(date '+%F %T') dump OK : $FILE ($(wc -c <"$FILE") octets)"
