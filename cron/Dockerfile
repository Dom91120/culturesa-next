# Conteneur cron minimal : busybox crond + curl.
# Appelle les routes /api/cron du service "app" sur le réseau interne.
FROM alpine:3.20
RUN apk add --no-cache curl tzdata
ENV TZ=Europe/Paris
COPY crontab /etc/crontabs/root
# -f : foreground (pour Docker) ; -l 2 : niveau de log
CMD ["crond", "-f", "-l", "2"]
