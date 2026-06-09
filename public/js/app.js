'use strict';

const API = '';  // same origin

// ── Toast ────────────────────────────────────────────────────
function toast(title, body = '', type = 'info', duration = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="toast-title">${title}</div>${body ? `<div class="toast-body">${body}</div>` : ''}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Status Badge ─────────────────────────────────────────────
function badge(status) {
  const s = String(status).toLowerCase();
  return `<span class="badge badge-${s}">${status}</span>`;
}

// ── Amount formatting ─────────────────────────────────────────
function fmtAmount(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

// ── Date formatting ───────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Short ID ──────────────────────────────────────────────────
function shortId(id) {
  if (!id) return '—';
  return `<span class="mono truncate" title="${id}">${id.slice(0, 8)}…</span>`;
}

// ── Fetch wrapper ─────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message ?? 'Request failed'), { status: res.status, data });
  return data;
}

// ── Health check ──────────────────────────────────────────────
async function checkHealth() {
  const ind = document.getElementById('health-indicator');
  try {
    const data = await apiFetch('/health');
    ind.className = `health-indicator ${data.status === 'healthy' ? 'healthy' : 'degraded'}`;
    const checks = data.checks ?? {};
    ind.innerHTML = `<span class="dot"></span> ${data.status} · PG:${checks.postgres} · Redis:${checks.redis} · MQ:${checks.rabbitmq}`;
  } catch {
    ind.className = 'health-indicator degraded';
    ind.innerHTML = '<span class="dot"></span> offline';
  }
}

// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const data = await apiFetch('/api/payments?merchantId=merchant_1&limit=50');
    const payments = data.data ?? [];

    document.getElementById('stat-total').textContent = payments.length;
    document.getElementById('stat-success').textContent = payments.filter(p => p.status === 'SUCCESS').length;
    document.getElementById('stat-failed').textContent = payments.filter(p => p.status === 'FAILED').length;
    document.getElementById('stat-processing').textContent =
      payments.filter(p => ['PENDING','PROCESSING','RETRYING'].includes(p.status)).length;

    const recent = payments.slice(0, 10);
    document.getElementById('recent-payments').innerHTML = recent.length === 0
      ? '<div class="empty">No payments yet — create one above</div>'
      : renderPaymentsTable(recent);
  } catch (e) {
    document.getElementById('recent-payments').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function renderPaymentsTable(payments) {
  const rows = payments.map(p => `
    <tr>
      <td>${shortId(p.paymentId)}</td>
      <td class="mono">${p.merchantId}</td>
      <td>${fmtAmount(p.amount, p.currency)}</td>
      <td>${badge(p.status)}</td>
      <td class="mono">${p.retryCount}</td>
      <td>${shortId(p.gatewayRef)}</td>
      <td>${fmtDate(p.createdAt)}</td>
      <td>
        <button class="btn btn-sm" onclick="quickRefund('${p.paymentId}', '${p.status}')">Refund</button>
      </td>
    </tr>
  `).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>ID</th><th>Merchant</th><th>Amount</th><th>Status</th>
          <th>Retries</th><th>Gateway Ref</th><th>Created</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function quickRefund(paymentId, status) {
  if (status !== 'SUCCESS') {
    toast('Cannot Refund', `Payment status is ${status} (must be SUCCESS)`, 'error');
    return;
  }
  document.getElementById('rf-payment-id').value = paymentId;
  switchTab('refunds');
}

// ── Payments Tab ──────────────────────────────────────────────
async function loadPayments() {
  const merchantId = document.getElementById('pay-merchant-filter').value.trim();
  if (!merchantId) { toast('Validation', 'Enter a merchant ID', 'error'); return; }

  document.getElementById('payments-table').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const data = await apiFetch(`/api/payments?merchantId=${encodeURIComponent(merchantId)}&limit=100`);
    const payments = data.data ?? [];
    document.getElementById('payments-table').innerHTML = payments.length === 0
      ? '<div class="empty">No payments found</div>'
      : renderPaymentsTable(payments);
  } catch (e) {
    document.getElementById('payments-table').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

// ── Create Payment ────────────────────────────────────────────
document.getElementById('create-payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const merchantId = document.getElementById('cp-merchant').value.trim();
    const amount = parseInt(document.getElementById('cp-amount').value, 10);
    const currency = document.getElementById('cp-currency').value;

    const data = await apiFetch('/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ merchantId, amount, currency }),
    });

    toast('Payment Created', `ID: ${data.paymentId} · Status: ${data.status}`, 'success');
    await loadDashboard();
  } catch (e) {
    toast('Error', e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Payment';
  }
});

// ── Refund Form ───────────────────────────────────────────────
document.getElementById('refund-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Processing…';

  try {
    const paymentId = document.getElementById('rf-payment-id').value.trim();
    const reason = document.getElementById('rf-reason').value.trim() || undefined;

    if (!paymentId) { toast('Validation', 'Payment ID is required', 'error'); return; }

    const data = await apiFetch(`/api/payments/${paymentId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });

    toast('Refund Initiated', `Refund ID: ${data.refundId} · Status: ${data.status}`, 'success');

    // Auto-populate lookup
    document.getElementById('rf-lookup-payment').value = paymentId;
    await loadRefundsForPayment();
  } catch (e) {
    toast('Refund Failed', e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Initiate Refund';
  }
});

async function loadRefundsForPayment() {
  const paymentId = document.getElementById('rf-lookup-payment').value.trim();
  if (!paymentId) { toast('Validation', 'Enter a payment ID', 'error'); return; }

  document.getElementById('refunds-table').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const data = await apiFetch(`/api/payments/${paymentId}/refunds`);
    const refunds = data.data ?? [];

    if (refunds.length === 0) {
      document.getElementById('refunds-table').innerHTML = '<div class="empty">No refunds for this payment</div>';
      return;
    }

    const rows = refunds.map(r => `
      <tr>
        <td>${shortId(r.refundId)}</td>
        <td>${fmtAmount(r.amount, 'USD')}</td>
        <td>${badge(r.status)}</td>
        <td>${r.reason ?? '—'}</td>
        <td>${shortId(r.gatewayRef)}</td>
        <td>${fmtDate(r.createdAt)}</td>
      </tr>
    `).join('');

    document.getElementById('refunds-table').innerHTML = `
      <table>
        <thead><tr><th>ID</th><th>Amount</th><th>Status</th><th>Reason</th><th>Gateway Ref</th><th>Created</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (e) {
    document.getElementById('refunds-table').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

// ── Webhook Events ────────────────────────────────────────────
async function loadWebhookEvents() {
  const paymentId = document.getElementById('wh-payment-id').value.trim();
  if (!paymentId) { toast('Validation', 'Enter a payment ID', 'error'); return; }

  document.getElementById('webhook-events-table').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const data = await apiFetch(`/api/payments/${paymentId}/webhook-events`);
    const events = data.data ?? [];

    if (events.length === 0) {
      document.getElementById('webhook-events-table').innerHTML = '<div class="empty">No webhook events for this payment</div>';
      return;
    }

    const rows = events.map(ev => `
      <tr>
        <td class="mono">${ev.eventId?.slice(0, 12)}…</td>
        <td><code>${ev.eventType}</code></td>
        <td>${badge(ev.status)}</td>
        <td>${fmtDate(ev.createdAt)}</td>
        <td>${fmtDate(ev.processedAt)}</td>
      </tr>
    `).join('');

    document.getElementById('webhook-events-table').innerHTML = `
      <table>
        <thead><tr><th>Event ID</th><th>Type</th><th>Status</th><th>Received</th><th>Processed</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (e) {
    document.getElementById('webhook-events-table').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

// ── Saga Status ───────────────────────────────────────────────
async function loadSagaStatus() {
  const paymentId = document.getElementById('saga-payment-id').value.trim();
  if (!paymentId) { toast('Validation', 'Enter a payment ID', 'error'); return; }

  document.getElementById('saga-status-container').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const data = await apiFetch(`/api/payments/${paymentId}/saga`);

    if (!data || !data.sagaId) {
      document.getElementById('saga-status-container').innerHTML = '<div class="empty">No saga found for this payment</div>';
      return;
    }

    const steps = Array.isArray(data.steps) ? data.steps : [];
    const stepHtml = steps.map(s => `
      <div class="saga-step ${s.status.toLowerCase()}">
        <div class="saga-step-name">${s.step}</div>
        ${badge(s.status)}
        <div class="saga-step-meta">${fmtDate(s.executedAt)}${s.error ? ` · Error: ${s.error}` : ''}</div>
      </div>
    `).join('');

    document.getElementById('saga-status-container').innerHTML = `
      <div style="padding:16px 20px;border-bottom:1px solid var(--border)">
        <strong>Saga ID:</strong> <span class="mono">${data.sagaId}</span> &nbsp;
        <strong>Status:</strong> ${badge(data.status)} &nbsp;
        <strong>Current Step:</strong> <code>${data.currentStep}</code>
      </div>
      <div class="saga-flow">${stepHtml || '<div class="empty">No steps recorded</div>'}</div>
    `;
  } catch (e) {
    document.getElementById('saga-status-container').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

// ── Ledger ────────────────────────────────────────────────────
async function loadLedgerEntries() {
  const paymentId = document.getElementById('ledger-payment-id').value.trim();
  if (!paymentId) { toast('Validation', 'Enter a payment ID', 'error'); return; }

  document.getElementById('ledger-table').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const data = await apiFetch(`/api/payments/${paymentId}/ledger`);
    const entries = data.data ?? [];

    if (entries.length === 0) {
      document.getElementById('ledger-table').innerHTML = '<div class="empty">No ledger entries for this payment</div>';
      return;
    }

    const rows = entries.map(e => `
      <tr>
        <td class="mono">${e.transactionId?.slice(0, 16)}…</td>
        <td>${e.debitAccount?.name ?? shortId(e.debitAccountId)}</td>
        <td>${e.creditAccount?.name ?? shortId(e.creditAccountId)}</td>
        <td>${fmtAmount(Number(e.amount), e.currency)}</td>
        <td>${e.description}</td>
        <td>${fmtDate(e.createdAt)}</td>
      </tr>
    `).join('');

    document.getElementById('ledger-table').innerHTML = `
      <table>
        <thead><tr><th>Transaction ID</th><th>Debit Account</th><th>Credit Account</th><th>Amount</th><th>Description</th><th>Date</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (e) {
    document.getElementById('ledger-table').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

async function loadMerchantBalance() {
  const merchantId = document.getElementById('balance-merchant-id').value.trim();
  if (!merchantId) { toast('Validation', 'Enter a merchant ID', 'error'); return; }

  document.getElementById('balance-container').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const data = await apiFetch(`/api/merchants/${merchantId}/balance`);
    document.getElementById('balance-container').innerHTML = `
      <div class="balance-card">
        <div class="balance-amount">${fmtAmount(Number(data.balance ?? 0), data.currency ?? 'USD')}</div>
        <div class="balance-label">Merchant Balance · ${merchantId} · ${data.currency ?? 'USD'}</div>
      </div>
    `;
  } catch (e) {
    document.getElementById('balance-container').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

// ── Tab switching ─────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  document.getElementById(`tab-${name}`)?.classList.add('active');
  document.querySelector(`[data-tab="${name}"]`)?.classList.add('active');

  const titles = { dashboard: 'Dashboard', payments: 'Payments', refunds: 'Refunds', webhooks: 'Webhooks', saga: 'Saga', ledger: 'Ledger' };
  document.getElementById('page-title').textContent = titles[name] ?? name;
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = item.dataset.tab;
    switchTab(tab);
    if (tab === 'dashboard') loadDashboard();
  });
});

// ── Init ──────────────────────────────────────────────────────
checkHealth();
loadDashboard();
setInterval(checkHealth, 30000);
