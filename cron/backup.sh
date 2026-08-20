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
# CHIFFREMENT (constat D1) : un dump contient l'intégralité des données
# nominatives, dont celles de mineurs — il ne doit pas exister en clair sur le
# disque. Celui-ci est chiffré au FORMAT OPENSSL standard (AES-256-CBC, PBKDF2),
# PAS au format maison AES-GCM de backup-crypto.ts : `openssl enc` ne produit
# pas de GCM et cette image n'a pas Node. Conséquences assumées :
#   - fichier `manuel-<ts>.sql.gz.aes`, INVISIBLE dans l'admin (Exports) et
#     JAMAIS purgé par l'app : restauration en ligne de commande uniquement,
#     et suppression à votre charge quand il ne sert plus ;
#   - déchiffrement (clé = BACKUP_ENCRYPTION_KEY du .env AU MOMENT du dump) :
#       openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
#         -pass env:BACKUP_ENCRYPTION_KEY -in manuel-<ts>.sql.gz.aes \
#         | gunzip > dump.sql
#     puis restauration : cf. docs/Guide-administration.md (« Restauration »).
# Sans clé dans l'environnement, le script REFUSE d'écrire un dump en clair ;
# dernier recours explicite : BACKUP_PLAINTEXT_OK=1 → `manuel-<ts>.sql.gz`.
set -eu
set -o pipefail

DIR=/backups
TS=$(date +%Y%m%d-%H%M%S)

# Mêmes options que l'export automatique (cf. src/server/services/backup.ts) :
#   --clean --if-exists : DROP ... IF EXISTS avant CREATE (restauration sur base existante)
#   --no-owner --no-privileges : pas de dépendance aux rôles/ACL de l'instance source
dump() {
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    -h db -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --no-owner --no-privileges --clean --if-exists
}

if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  FILE="$DIR/manuel-$TS.sql.gz.aes"
  TMP="$DIR/.manuel-$TS.sql.gz.aes"   # nom à point → jamais pris pour un dump fini
  # Le SQL en clair ne touche jamais le disque : pg_dump → gzip → openssl en flux.
  dump | gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
    -pass env:BACKUP_ENCRYPTION_KEY >"$TMP"
elif [ "${BACKUP_PLAINTEXT_OK:-}" = 1 ]; then
  FILE="$DIR/manuel-$TS.sql.gz"
  TMP="$DIR/.manuel-$TS.sql.gz"
  dump | gzip -9 >"$TMP"
else
  echo "ERREUR : BACKUP_ENCRYPTION_KEY absente de l'environnement — refus de" >&2
  echo "produire un dump nominatif EN CLAIR (constat D1). Définissez-la dans le" >&2
  echo ".env (cf. .env.example) puis \`docker compose up -d cron\`, ou, en tout" >&2
  echo "dernier recours : docker compose exec --user 1001:1001 \\" >&2
  echo "  -e BACKUP_PLAINTEXT_OK=1 cron backup.sh" >&2
  exit 1
fi

# Écriture terminée → le dump prend son nom définitif (un fichier partiel issu
# d'un échec en cours de route reste un `.manuel-*` caché, facile à identifier).
mv "$TMP" "$FILE"
chmod 600 "$FILE"
# Sous 1001 le fichier a déjà le bon propriétaire ; le chown ne subsiste que
# pour une éventuelle exécution root (CAP_CHOWN requise, elle aussi retirée
# par le durcissement — d'où le garde plutôt qu'un échec en toute fin).
[ "$(id -u)" != 0 ] || chown 1001:1001 "$FILE"

echo "$(date '+%F %T') dump OK : $FILE ($(wc -c <"$FILE") octets)"
