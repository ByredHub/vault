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
  const uid = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || '';
  return apiRequest(`/api/orders/my${uid ? `?user_id=${uid}` : ''}`);
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

export async function purchaseItem(itemId, onProgress) {
  // Get user_id from Telegram or API
  let userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (!userId) {
    try {
      const me = await fetch('/api/me').then(r => r.json());
      userId = me.user_id;
    } catch { /* ignore */ }
  }

  const initData = window.Telegram?.WebApp?.initData || '';
  const res = await fetch('/api/purchase', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
    },
    body: JSON.stringify({ item_id: itemId, user_id: userId }),
  });

  // Parse NDJSON lines from response
  function parseLine(line, result) {
    if (!line.trim()) return result;
    try {
      const data = JSON.parse(line);
      if (data.step === 'result') return data;
      if (data.step === 'error') throw new Error(data.message);
      if (data.step && onProgress) onProgress(data);
    } catch (e) {
      if (e.message && !e.message.includes('JSON')) throw e;
    }
    return result;
  }

  let finalResult = null;

  // Try streaming first, fallback to full text read
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        finalResult = parseLine(line, finalResult);
      }
    }
    // Process any remaining buffer
    if (buffer.trim()) {
      finalResult = parseLine(buffer, finalResult);
    }
  } else {
    // Fallback: read entire response as text
    const text = await res.text();
    const lines = text.split('\n');
    for (const line of lines) {
      finalResult = parseLine(line, finalResult);
    }
  }

  if (!finalResult) throw new Error('Не получен результат покупки');
  return finalResult;
}
