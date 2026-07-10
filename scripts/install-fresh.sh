#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

ENV_FILE=".env.production"
COMPOSE_FILES=(-f compose.yaml -f compose.fresh.yaml)

compose() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "${COMPOSE_FILES[@]}" "$@"
  else
    docker compose "${COMPOSE_FILES[@]}" "$@"
  fi
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64
  fi
}

server_ip() {
  hostname -I 2>/dev/null | awk '{print $1}'
}

env_quote() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\$/\\$/g; s/`/\\`/g')"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required" >&2
  exit 1
fi

if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker-compose or docker compose plugin is required" >&2
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  echo "$ENV_FILE already exists; refusing to overwrite it."
  echo "Edit it manually or move it away before running fresh install again."
  exit 1
fi

read -r -p "Server IP or domain [$(server_ip)]: " PUBLIC_HOST
PUBLIC_HOST="${PUBLIC_HOST:-$(server_ip)}"
read -r -p "Web port [18080]: " WEB_PORT
WEB_PORT="${WEB_PORT:-18080}"
read -r -p "Initial admin username [admin]: " ADMIN_USER
ADMIN_USER="${ADMIN_USER:-admin}"

while true; do
  read -r -s -p "Initial admin password (min 12 chars): " ADMIN_PASSWORD
  echo
  if [ "${#ADMIN_PASSWORD}" -ge 12 ]; then
    break
  fi
  echo "Password is too short."
done

POSTGRES_PASSWORD="$(random_secret)"
JWT_SECRET="$(random_secret)"
OPS_AGENT_TOKEN_PEPPER="$(random_secret)"
CREDENTIAL_ENCRYPTION_KEY="$(random_secret)"
ADMIN_USER_ENV="$(env_quote "$ADMIN_USER")"
ADMIN_PASSWORD_ENV="$(env_quote "$ADMIN_PASSWORD")"

cat > "$ENV_FILE" <<EOF_ENV
NODE_ENV=production
PORT=3001

POSTGRES_DB=ops_platform
POSTGRES_USER=ops_platform
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_PORT=5432
DATABASE_URL="postgresql://ops_platform:$POSTGRES_PASSWORD@127.0.0.1:5432/ops_platform?schema=public"

WEB_PORT=$WEB_PORT
CORS_ORIGINS=http://$PUBLIC_HOST:$WEB_PORT

JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=2h
OPS_AGENT_TOKEN_PEPPER=$OPS_AGENT_TOKEN_PEPPER
CREDENTIAL_ENCRYPTION_KEY=$CREDENTIAL_ENCRYPTION_KEY
LEGACY_CREDENTIAL_ENCRYPTION_KEYS=
LEGACY_AGENT_TOKEN_PEPPERS=

INITIAL_ADMIN_USERNAME=$ADMIN_USER_ENV
INITIAL_ADMIN_PASSWORD=$ADMIN_PASSWORD_ENV
INITIAL_ADMIN_DISPLAY_NAME=平台管理员

# Optional. By default, Agent installs use detected NIC IP + PORT.
# OPS_AGENT_PUBLIC_URL=http://$PUBLIC_HOST:3001
OPS_AGENT_METRICS_INTERVAL_SECONDS=60
OPS_AGENT_METRICS_RETENTION_POINTS=288

GENERIC_WEBHOOK_TOKEN=$(random_secret)
PROMETHEUS_WEBHOOK_TOKEN=$(random_secret)
ZABBIX_WEBHOOK_TOKEN=$(random_secret)
GRAFANA_WEBHOOK_TOKEN=$(random_secret)

HEALTH_REPORT_SCHEDULER_ENABLED=true
HEALTH_REPORT_SCHEDULER_INTERVAL_MS=3600000
HEALTH_REPORT_WEEKLY_DAY=1
HEALTH_REPORT_WEEKLY_HOUR=9
HEALTH_REPORT_WEEKLY_MINUTE=0
LOG_MONITOR_EVALUATOR_INTERVAL_MS=60000
LOG_RETENTION_CLEANUP_INTERVAL_MS=3600000
CGI_MONITOR_EVALUATOR_INTERVAL_MS=60000
SELF_HEALING_EVALUATOR_INTERVAL_MS=60000
ALERT_AUTO_SUPPRESS_ENABLED=false
SEED_DEMO_DATA=false
EOF_ENV

chmod 600 "$ENV_FILE"
mkdir -p storage/batch-files

echo "Building and starting services..."
compose build
compose up -d

echo "Applying database migrations..."
compose exec -T api npm run db:deploy

echo "Creating initial admin account..."
compose exec -T api npm run db:seed

echo "Waiting for API health..."
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:3001/api/health" >/dev/null 2>&1; then
    echo "Install completed."
    echo "Open: http://$PUBLIC_HOST:$WEB_PORT/"
    echo "Login: $ADMIN_USER / <password you entered>"
    exit 0
  fi
  sleep 3
done

echo "Services started, but health check did not pass in time. Check logs:"
echo "  docker-compose -f compose.yaml -f compose.fresh.yaml logs -f api"
exit 1
