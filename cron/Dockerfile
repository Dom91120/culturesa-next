# Conteneur cron : busybox crond + curl (appels HTTP /api/cron) + pg_dump (sauvegarde DB).
# Basé sur postgres:17-alpine pour disposer d'un pg_dump à la MÊME version majeure que
# le serveur "db" (postgres:17) — pg_dump refuse de sauvegarder un serveur plus récent.
FROM postgres:17-alpine
# L'image postgres a un ENTRYPOINT dédié (init du serveur) : on le neutralise pour que
# le CMD (crond) s'exécute tel quel, en root (nécessaire à crond).
ENTRYPOINT []
RUN apk add --no-cache curl tzdata
ENV TZ=Europe/Paris
COPY crontab /etc/crontabs/root
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
# -f : foreground (pour Docker) ; -l 2 : niveau de log
CMD ["crond", "-f", "-l", "2"]
