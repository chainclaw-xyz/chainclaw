#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.yml"
SERVICE="chainclaw"
HEALTH_URL="http://localhost:9090/health"
READY_URL="http://localhost:9090/ready"
WEBCHAT_URL="http://localhost:8080"
MAX_WAIT=90

cleanup() {
  echo "Tearing down..."
  docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

echo "=== ChainClaw Smoke Test ==="

# 1. Build and start
echo "Starting services..."
docker compose -f "$COMPOSE_FILE" up -d --build "$SERVICE"

# 2. Wait for health
echo "Waiting for health endpoint (max ${MAX_WAIT}s)..."
elapsed=0
until curl -sf "$HEALTH_URL" > /dev/null 2>&1; do
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "FAIL: Health endpoint did not respond within ${MAX_WAIT}s"
    docker compose -f "$COMPOSE_FILE" logs "$SERVICE"
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
echo "Health endpoint responding (${elapsed}s)"

# 3. Validate health response
echo "Validating health response..."
HEALTH_RESPONSE=$(curl -sf "$HEALTH_URL")
echo "$HEALTH_RESPONSE" | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
  if (data.status !== 'ok') { console.error('FAIL: status not ok'); process.exit(1); }
  if (typeof data.uptime !== 'number') { console.error('FAIL: missing uptime'); process.exit(1); }
  if (!Array.isArray(data.channels)) { console.error('FAIL: missing channels'); process.exit(1); }
  console.log('Health:', JSON.stringify(data));
"

# 4. Check ready endpoint
echo "Checking ready endpoint..."
READY_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$READY_URL" || echo "000")
echo "Ready status: $READY_STATUS"

# 5. Check web chat endpoint
echo "Checking web chat endpoint..."
WEBCHAT_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$WEBCHAT_URL" || echo "000")
echo "WebChat status: $WEBCHAT_STATUS"

echo ""
echo "=== Smoke Test PASSED ==="
