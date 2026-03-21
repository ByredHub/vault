/**
 * API client for the Mini App — talks to the bot's web API.
 * Sends Telegram init data for authentication.
 */

const API_BASE = '';

function getInitData() {
  if (window.Telegram?.WebApp?.initData) {
    return window.Telegram.WebApp.initData;
  }
  // Dev fallback
  return '';
}

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': getInitData(),
    ...options.headers,
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ═══════════════════════════════════════
// Catalog
// ═══════════════════════════════════════

export function getCatalog(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  });
  return apiRequest(`/api/catalog?${qs}`);
}

export function getItemDetail(itemId) {
  return apiRequest(`/api/catalog/${itemId}`);
}

export function getCategories() {
  return apiRequest('/api/categories');
}

// ═══════════════════════════════════════
// Orders
// ═══════════════════════════════════════

export function createOrder(itemId, paymentMethod) {
  return apiRequest('/api/orders', {
    method: 'POST',
    body: { item_id: itemId, payment_method: paymentMethod },
  });
}

export function checkOrder(orderId) {
  return apiRequest(`/api/orders/${orderId}/check`);
}

export function getMyOrders() {
  return apiRequest('/api/orders/my');
}

// ═══════════════════════════════════════
// Payments
// ═══════════════════════════════════════

export function getPaymentMethods() {
  return apiRequest('/api/payments/methods');
}

// ═══════════════════════════════════════
// Admin
// ═══════════════════════════════════════

export function getAdminStats() {
  return apiRequest('/api/admin/stats');
}

export function getAdminOrders(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.set(k, v);
  });
  return apiRequest(`/api/admin/orders?${qs}`);
}

export function getAdminUsers(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.set(k, v);
  });
  return apiRequest(`/api/admin/users?${qs}`);
}

export function blockUser(userId, blocked) {
  return apiRequest('/api/admin/users/block', {
    method: 'POST',
    body: { user_id: userId, blocked },
  });
}

export async function purchaseItem(itemId) {
  // Get user_id from Telegram or API
  let userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (!userId) {
    try {
      const me = await fetch('/api/me').then(r => r.json());
      userId = me.user_id;
    } catch { /* ignore */ }
  }
  return apiRequest('/api/purchase', {
    method: 'POST',
    body: { item_id: itemId, user_id: userId },
  });
}
