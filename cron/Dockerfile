# Conteneur cron : busybox crond + curl — se contente d'appeler les routes /api/cron/*
# de l'app toutes les 5 minutes (la planification réelle est configurée dans l'admin,
# onglet Tâches planifiées › CRON). L'export de la base est réalisé PAR L'APP
# (route /api/cron/backup → pg_dump embarqué dans l'image de l'app) : plus besoin de
# pg_dump ni de l'ancien script backup.sh ici.
FROM alpine:3.20
RUN apk add --no-cache curl tzdata
ENV TZ=Europe/Paris
COPY crontab /etc/crontabs/root
# -f : foreground (pour Docker) ; -l 2 : niveau de log
CMD ["crond", "-f", "-l", "2"]
