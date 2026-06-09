#!/usr/bin/env bash
# ============================================================
# Railway Full Deployment Script
# Run AFTER: railway login
# ============================================================
set -e

REPO="https://github.com/Karthik4093/payment-platform"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

log() { echo -e "${CYAN}==> $1${NC}"; }
ok()  { echo -e "${GREEN}    [OK] $1${NC}"; }

cd "$(dirname "$0")/.."

# ── 1. Create Railway project ──────────────────────────────
log "Creating Railway project..."
railway init --name "payment-platform" 2>/dev/null || true
ok "Project ready"

# ── 2. Add PostgreSQL ──────────────────────────────────────
log "Provisioning PostgreSQL..."
railway add --plugin postgresql 2>/dev/null || true
ok "PostgreSQL added"

# ── 3. Add Redis ───────────────────────────────────────────
log "Provisioning Redis..."
railway add --plugin redis 2>/dev/null || true
ok "Redis added"

# ── 4. Deploy Gateway Simulator ───────────────────────────
log "Deploying gateway-simulator..."
railway service create gateway-simulator 2>/dev/null || true
railway variables set \
  NODE_ENV=production \
  GATEWAY_PORT=3001 \
  LOG_LEVEL=info \
  --service gateway-simulator
railway up --service gateway-simulator --detach
ok "Gateway deployed"

GATEWAY_URL=$(railway domain --service gateway-simulator 2>/dev/null || echo "")
ok "Gateway URL: https://$GATEWAY_URL"

# ── 5. Deploy API ─────────────────────────────────────────
log "Deploying API service..."
railway service create payment-api 2>/dev/null || true
railway variables set \
  NODE_ENV=production \
  LOG_LEVEL=info \
  API_PORT=3000 \
  WEBHOOK_SECRET="$(openssl rand -hex 32)" \
  FRAUD_MAX_PAYMENTS_PER_MINUTE=10 \
  FRAUD_MAX_FAILURES_PER_5_MINUTES=5 \
  FRAUD_MAX_AMOUNT=100000 \
  RETRY_MAX_ATTEMPTS=5 \
  RETRY_BASE_DELAY_MS=1000 \
  GATEWAY_URL="https://$GATEWAY_URL" \
  INVENTORY_SERVICE_URL="https://$GATEWAY_URL/inventory" \
  SHIPPING_SERVICE_URL="https://$GATEWAY_URL/shipping" \
  RABBITMQ_URL="${CLOUDAMQP_URL:-amqp://guest:guest@localhost:5672}" \
  --service payment-api
railway up --service payment-api --detach
ok "API deployed"

API_URL=$(railway domain --service payment-api 2>/dev/null || echo "")
railway variables set WEBHOOK_URL="https://$API_URL/webhooks/payment" --service payment-api

# ── 6. Deploy Worker ──────────────────────────────────────
log "Deploying worker service..."
railway service create payment-worker 2>/dev/null || true
railway variables set \
  NODE_ENV=production \
  LOG_LEVEL=info \
  WORKER_CONCURRENCY=5 \
  RETRY_MAX_ATTEMPTS=5 \
  RETRY_BASE_DELAY_MS=1000 \
  GATEWAY_URL="https://$GATEWAY_URL" \
  WEBHOOK_URL="https://$API_URL/webhooks/payment" \
  INVENTORY_SERVICE_URL="https://$GATEWAY_URL/inventory" \
  SHIPPING_SERVICE_URL="https://$GATEWAY_URL/shipping" \
  RABBITMQ_URL="${CLOUDAMQP_URL:-amqp://guest:guest@localhost:5672}" \
  --service payment-worker
railway up --service payment-worker --detach
ok "Worker deployed"

# ── 7. Print summary ─────────────────────────────────────
echo ""
echo "=============================================="
echo "  DEPLOYMENT COMPLETE"
echo "=============================================="
echo ""
echo "  Dashboard:    https://$API_URL"
echo "  API:          https://$API_URL/api"
echo "  Swagger Docs: https://$API_URL/docs"
echo "  Health:       https://$API_URL/health"
echo "  Gateway:      https://$GATEWAY_URL"
echo ""
echo "  RabbitMQ:     Add CloudAMQP free tier:"
echo "    https://www.cloudamqp.com/plans.html (Lemur plan - free)"
echo "    Then: railway variables set RABBITMQ_URL=amqps://... --service payment-api"
echo ""
echo "  GitHub repo:  $REPO"
echo ""
