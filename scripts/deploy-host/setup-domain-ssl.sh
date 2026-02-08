#!/usr/bin/env bash
set -euo pipefail

# Automates the 2-step nginx TLS flow for a new hostname:
#   1) Install HTTP-only vhost (ACME challenge enabled)
#   2) Run certbot (HTTP-01, webroot)
#   3) Install HTTPS vhost + reload nginx
#
# Run from your local machine; requires SSH access to your deploy host.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-config.sh
source "$SCRIPT_DIR/load-config.sh"

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-$USER}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"

DEPLOY_ROOT="${DEPLOY_ROOT:-}"
WEBSERVER_DIR="${WEBSERVER_DIR:-${DEPLOY_ROOT:+$DEPLOY_ROOT/webserver}}"
NGINX_CONFD_DIR="${NGINX_CONFD_DIR:-${WEBSERVER_DIR:+$WEBSERVER_DIR/nginx/conf.d}}"
SITE_ROOT_DIR="${SITE_ROOT_DIR:-${WEBSERVER_DIR:+$WEBSERVER_DIR/site}}"

NGINX_CONTAINER_NAME="${NGINX_CONTAINER_NAME:-nginx_web}"
CERTBOT_CONTAINER_NAME="${CERTBOT_CONTAINER_NAME:-certbot}"

EMAIL="${EMAIL:-}"
PROXY_PASS="${PROXY_PASS:-}"
DOMAIN="${DOMAIN:-}"

usage() {
  cat <<EOF
Usage:
  scripts/deploy-host/setup-domain-ssl.sh --domain <host> --proxy-pass <http://127.0.0.1:PORT>

Required:
  --domain       Fully-qualified hostname (e.g. api.example.com)

Optional:
  --proxy-pass   Upstream to proxy to (e.g. http://127.0.0.1:18080). If omitted, vhost serves a placeholder response.
  --email        Certbot email (default: $EMAIL)

SSH env overrides:
  DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_PORT

Server path env overrides:
  DEPLOY_ROOT, WEBSERVER_DIR, NGINX_CONFD_DIR, SITE_ROOT_DIR

Container name overrides:
  NGINX_CONTAINER_NAME, CERTBOT_CONTAINER_NAME

Examples:
  scripts/deploy-host/setup-domain-ssl.sh \
    --domain newapp.example.com \
    --proxy-pass http://127.0.0.1:19000

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="$2"; shift 2 ;;
    --proxy-pass)
      PROXY_PASS="$2"; shift 2 ;;
    --email)
      EMAIL="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$DOMAIN" ]]; then
  echo "ERROR: --domain is required" >&2
  usage
  exit 2
fi

if [[ -z "$DEPLOY_HOST" ]]; then
  echo "ERROR: DEPLOY_HOST is required (set in .deploy.env)" >&2
  exit 2
fi

if [[ -z "$DEPLOY_ROOT" ]]; then
  echo "ERROR: DEPLOY_ROOT is required (set in .deploy.env)" >&2
  exit 2
fi

if [[ -z "$WEBSERVER_DIR" || -z "$NGINX_CONFD_DIR" || -z "$SITE_ROOT_DIR" ]]; then
  echo "ERROR: WEBSERVER_DIR/NGINX_CONFD_DIR/SITE_ROOT_DIR are required (set in .deploy.env)" >&2
  exit 2
fi

if [[ -z "$EMAIL" ]]; then
  echo "ERROR: EMAIL is required for certbot (set in .deploy.env or pass --email)" >&2
  exit 2
fi

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_OPTS=(
  -p "$DEPLOY_SSH_PORT"
  -o BatchMode=yes
  -o ConnectTimeout=10
)

remote_conf_path="$NGINX_CONFD_DIR/$DOMAIN.conf"
remote_site_dir="$SITE_ROOT_DIR/$DOMAIN"

render_bootstrap_conf() {
  if [[ -n "$PROXY_PASS" ]]; then
    cat <<EOF
server {
    listen 80;
    listen [::]:80;

    server_name $DOMAIN;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        proxy_pass $PROXY_PASS;

        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;

        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
EOF
  else
    cat <<EOF
server {
    listen 80;
    listen [::]:80;

    server_name $DOMAIN;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        default_type text/plain;
        return 200 "OK (HTTP bootstrap for $DOMAIN)\n";
    }
}
EOF
  fi
}

render_tls_conf() {
  if [[ -n "$PROXY_PASS" ]]; then
    cat <<EOF
server {
    listen 80;
    listen [::]:80;

    server_name $DOMAIN;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;

    http2 on;

    server_name $DOMAIN;

    access_log /var/log/nginx/$DOMAIN.access.log;
    error_log  /var/log/nginx/$DOMAIN.error.log;

    ssl_certificate /etc/nginx/certs/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/live/$DOMAIN/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        proxy_pass $PROXY_PASS;

        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;

        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
EOF
  else
    cat <<EOF
server {
    listen 80;
    listen [::]:80;

    server_name $DOMAIN;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;

    http2 on;

    server_name $DOMAIN;

    access_log /var/log/nginx/$DOMAIN.access.log;
    error_log  /var/log/nginx/$DOMAIN.error.log;

    ssl_certificate /etc/nginx/certs/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/live/$DOMAIN/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        default_type text/plain;
        return 200 "OK (HTTPS vhost for $DOMAIN)\n";
    }
}
EOF
  fi
}

echo "Connecting to $REMOTE ..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$NGINX_CONFD_DIR' '$remote_site_dir'"

echo "Installing HTTP bootstrap vhost: $remote_conf_path"
render_bootstrap_conf | ssh "${SSH_OPTS[@]}" "$REMOTE" "cat > '$remote_conf_path'"

echo "Reloading nginx ($NGINX_CONTAINER_NAME) ..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail; docker exec -i '$NGINX_CONTAINER_NAME' nginx -s reload"

echo "Preparing ACME webroot (certbot container) ..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail; docker exec -i '$CERTBOT_CONTAINER_NAME' sh -lc 'mkdir -p /var/www/certbot/.well-known/acme-challenge'"

echo "Issuing cert via certbot for $DOMAIN ..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail; docker exec -i '$CERTBOT_CONTAINER_NAME' certbot certonly --webroot -w /var/www/certbot -d '$DOMAIN' --cert-name '$DOMAIN' --email '$EMAIL' --agree-tos --no-eff-email --rsa-key-size 4096 --config-dir /etc/letsencrypt --work-dir /var/lib/letsencrypt --logs-dir /var/log/letsencrypt"

echo "Verifying nginx can see the cert ..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail; docker exec -i '$NGINX_CONTAINER_NAME' sh -lc 'test -f /etc/nginx/certs/live/$DOMAIN/fullchain.pem'"

echo "Installing HTTPS vhost: $remote_conf_path"
render_tls_conf | ssh "${SSH_OPTS[@]}" "$REMOTE" "cat > '$remote_conf_path'"

echo "Reloading nginx ($NGINX_CONTAINER_NAME) ..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail; docker exec -i '$NGINX_CONTAINER_NAME' nginx -s reload"

echo
printf 'OK: TLS enabled for https://%s\n' "$DOMAIN"
