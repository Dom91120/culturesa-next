# Conteneur cron : busybox crond + curl — appelle les routes /api/cron/* de l'app
# toutes les 5 minutes (la planification réelle est configurée dans l'admin, onglet
# Tâches planifiées › CRON). L'export planifié de la base est réalisé PAR L'APP
# (route /api/cron/backup → pg_dump embarqué dans l'image de l'app).
#
# L'image embarque aussi backup.sh (export MANUEL en ligne de commande, hors crontab) :
#   docker compose exec --user 1001:1001 cron backup.sh
# → dump direct depuis Postgres, utilisable même si le conteneur app est HS.
# postgresql17-client : la version du client doit couvrir celle du serveur (postgres:17),
# d'où alpine >= 3.21 (3.20 s'arrête à postgresql16).
# openssl : chiffrement du dump manuel de backup.sh (constat D1) — la libcrypto
# est déjà là via curl, mais pas le binaire.
FROM alpine:3.22
RUN apk add --no-cache curl tzdata postgresql17-client openssl
ENV TZ=Europe/Paris
COPY crontab /etc/crontabs/root
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
# -f : foreground (pour Docker) ; -l 2 : niveau de log
CMD ["crond", "-f", "-l", "2"]
