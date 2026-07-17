#!/usr/bin/env bash
#
# Installation de CultuRésa sur un nouveau serveur.
#
# Prépare l'environnement (.env + secrets), construit et démarre la stack Docker
# (app + db + cron), applique les migrations Prisma puis initialise une
# base VIERGE avec UNIQUEMENT le compte administrateur (cf. prisma/seed-init.ts).
#
# Idempotent : relançable. Les secrets déjà renseignés dans .env sont conservés ;
# le seed d'init ne duplique rien.
#
# Usage :
#   ./scripts/install.sh
#
# Variables d'environnement reconnues (sinon : valeurs de .env ou saisie interactive) :
#   APP_DOMAIN       domaine public (ex. reservations.mon-asso.fr ; "localhost" en local)
#   ADMIN_EMAIL      e-mail du compte admin (= identifiant de connexion + Let's Encrypt)
#   ADMIN_PASSWORD   mot de passe admin (≥ 12 car. ; généré si absent)
#
set -euo pipefail

cd "$(dirname "$0")/.."   # racine du projet
ENV_FILE=".env"

# ── Sélection de la commande Docker Compose (v2 « docker compose » ou v1) ──
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "✗ Docker Compose introuvable. Installe Docker + le plugin Compose." >&2
  exit 1
fi
command -v openssl >/dev/null 2>&1 || { echo "✗ openssl est requis." >&2; exit 1; }

say()  { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# Remplace (ou ajoute) une clé KEY=valeur dans .env, en échappant la valeur pour sed.
set_env() {
  local key="$1" val="$2"
  local esc
  esc=$(printf '%s' "$val" | sed -e 's/[\/&]/\\&/g')
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak -E "s/^${key}=.*/${key}=${esc}/" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# Lit la valeur courante d'une clé dans .env (vide si absente).
get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true; }

# ── 1. Fichier .env ──
say "1/5 · Configuration (.env)"
if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  ok ".env créé depuis .env.example"
else
  warn ".env déjà présent — les valeurs existantes sont conservées."
fi

# Génère un secret seulement si la valeur courante est vide ou un placeholder « change-moi… ».
gen_if_placeholder() {
  local key="$1" gen="$2" cur
  cur=$(get_env "$key")
  if [ -z "$cur" ] || printf '%s' "$cur" | grep -qi 'change-moi'; then
    set_env "$key" "$gen"
    ok "$key généré"
  fi
}
gen_if_placeholder BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
gen_if_placeholder CRON_SECRET        "$(openssl rand -hex 24)"
gen_if_placeholder POSTGRES_PASSWORD  "$(openssl rand -hex 32)"   # hex → sûr dans l'URL Postgres

# Domaine + URLs dérivées.
DOMAIN="${APP_DOMAIN:-}"
if [ -z "$DOMAIN" ]; then
  cur_domain=$(get_env APP_DOMAIN)
  read -r -p "Domaine public [${cur_domain:-localhost}] : " DOMAIN || true
  DOMAIN="${DOMAIN:-${cur_domain:-localhost}}"
fi
# HTTPS supposé : le TLS relève désormais d'un reverse proxy EXTERNE à la stack
# (Caddy retiré du compose). En accès direct http://<hôte>:3000, ajuster APP_URL
# et NEXT_PUBLIC_APP_URL dans .env après l'installation.
SCHEME="https"
set_env APP_DOMAIN "$DOMAIN"
set_env APP_URL "${SCHEME}://${DOMAIN}"
set_env NEXT_PUBLIC_APP_URL "${SCHEME}://${DOMAIN}"
ok "Domaine : ${SCHEME}://${DOMAIN}"

# E-mail admin (= identifiant de connexion + contact Let's Encrypt).
AEMAIL="${ADMIN_EMAIL:-}"
if [ -z "$AEMAIL" ]; then
  cur_email=$(get_env ADMIN_EMAIL)
  read -r -p "E-mail administrateur [${cur_email:-admin@${DOMAIN}}] : " AEMAIL || true
  AEMAIL="${AEMAIL:-${cur_email:-admin@${DOMAIN}}}"
fi
set_env ADMIN_EMAIL "$AEMAIL"

# Mot de passe admin (généré si absent/placeholder).
APASS="${ADMIN_PASSWORD:-}"
GENERATED_PASS=""
if [ -z "$APASS" ]; then
  cur_pass=$(get_env ADMIN_PASSWORD)
  if [ -z "$cur_pass" ] || printf '%s' "$cur_pass" | grep -qi 'change-moi'; then
    # 18 octets base64 → ~24 car. ; on garantit la complexité avec un suffixe fixe.
    APASS="$(openssl rand -base64 18 | tr -d '/+=')Aa1!"
    GENERATED_PASS="$APASS"
  else
    APASS="$cur_pass"
  fi
fi
if [ "${#APASS}" -lt 12 ]; then
  echo "✗ ADMIN_PASSWORD doit faire au moins 12 caractères." >&2
  exit 1
fi
set_env ADMIN_PASSWORD "$APASS"
ok "Compte admin : ${AEMAIL}"

if [ -z "$(get_env SMTP_HOST)" ] || grep -qi 'change-moi\|smtp.exemple.fr' <<< "$(get_env SMTP_HOST)$(get_env SMTP_PASSWORD)"; then
  warn "SMTP non configuré dans .env : pensez à le renseigner depuis l'interface d'administration (Messagerie) — sans cela, aucun e-mail (confirmations, mot de passe oublié) ne partira."
fi

# ── 2. Build + démarrage de la stack ──
say "2/5 · Construction et démarrage des conteneurs"
$DC up -d --build app db cron

# ── 3. Attente de la base ──
say "3/5 · Attente de PostgreSQL"
for i in $(seq 1 30); do
  if $DC exec -T db pg_isready -U "$(get_env POSTGRES_USER)" -d "$(get_env POSTGRES_DB)" >/dev/null 2>&1; then
    ok "Base prête"
    break
  fi
  [ "$i" -eq 30 ] && { echo "✗ La base n'est pas prête après 30 tentatives." >&2; exit 1; }
  sleep 2
done

# ── 4. Migrations (déjà jouées par l'entrypoint de l'app, on s'en assure) ──
say "4/5 · Migrations Prisma"
$DC exec -T app node_modules/.bin/prisma migrate deploy
ok "Schéma à jour"

# ── 5. Initialisation : référentiels système + compte admin ──
say "5/5 · Initialisation (compte administrateur uniquement)"
$DC run --rm init

say "Installation terminée."
echo "  • Application : $(get_env APP_URL)"
echo "  • Connexion admin : ${AEMAIL}"
if [ -n "$GENERATED_PASS" ]; then
  printf '  • Mot de passe admin (généré) : \033[1;33m%s\033[0m\n' "$GENERATED_PASS"
  echo "    (enregistré dans .env ; change-le après la première connexion)"
else
  echo "  • Mot de passe admin : celui défini dans .env (ADMIN_PASSWORD)"
fi
echo
echo "Référentiels métier (demandeurs, structures, niveaux, vacances, services…) :"
echo "à créer depuis l'interface d'administration. Pour un jeu de démo complet,"
echo "lancer à la place :  $DC run --rm init pnpm db:seed"
