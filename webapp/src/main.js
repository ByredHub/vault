/**
 * LZT Store — Mini App with Demo Data
 * Bootstrap Icons + polished rendering
 */
import './style.css';
import { CATEGORIES, getCategoryIcon, getCategoryChipIcon } from './icons.js';
import {
  getCatalog, getMyOrders, getPaymentMethods,
  createOrder, checkOrder, purchaseItem,
  getAdminStats, getAdminOrders, getAdminUsers, blockUser,
} from './api.js';

// ═══════════════════════════════════════
// Telegram
// ═══════════════════════════════════════

const tg = window.Telegram?.WebApp;
let isAdmin = false;

async function initTelegram() {
  // Check admin status from server
  try {
    const uid = tg?.initDataUnsafe?.user?.id || '';
    const res = await fetch(`/api/me?user_id=${uid}`);
    if (res.ok) {
      const data = await res.json();
      isAdmin = data.is_admin || false;
    }
  } catch { /* ignore */ }
  document.getElementById('admin-tab').style.display = isAdmin ? '' : 'none';
}

function haptic(t = 'light') { tg?.HapticFeedback?.impactOccurred?.(t); }

// ═══════════════════════════════════════
// Router
// ═══════════════════════════════════════

let currentPage = 'catalog';
let catalogRefreshInterval = null;
const CATALOG_REFRESH_MS = 60_000; // auto-refresh every 60s

function navigateTo(page) {
  if (!page) return;
  currentPage = page;
  haptic();
  document.querySelectorAll('.bnav-tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => {
    const isActive = p.id === `page-${page}`;
    p.style.display = isActive ? 'block' : 'none';
    p.classList.toggle('active', isActive);
  });
  document.querySelector('.page-container')?.scrollTo(0, 0);
  window.scrollTo(0, 0);
  ({ catalog: renderCatalog, orders: renderOrders, profile: renderProfile, admin: renderAdmin })[page]?.();

  // Auto-refresh catalog only while on catalog page
  clearInterval(catalogRefreshInterval);
  catalogRefreshInterval = null;
  if (page === 'catalog') {
    catalogRefreshInterval = setInterval(() => {
      if (currentPage === 'catalog') loadItems(true);
    }, CATALOG_REFRESH_MS);
  }
}

// ═══════════════════════════════════════
// Catalog
// ═══════════════════════════════════════

let selectedCategory = 'telegram';
let searchQuery = '';
let sortBy = 'default';
let priceMin = null;
let priceMax = null;

function renderCategories() {
  const el = document.getElementById('categories-container');
  el.innerHTML = `
    <div class="cat-scroll">
      ${CATEGORIES.map(c => `
        <button class="cat-chip ${c.slug === selectedCategory ? 'active' : ''}" data-cat="${c.slug}">
          ${getCategoryChipIcon(c.slug)}
          <span>${c.name}</span>
        </button>
      `).join('')}
    </div>
  `;
  el.querySelectorAll('.cat-chip').forEach(ch => {
    ch.addEventListener('click', () => {
      selectedCategory = ch.dataset.cat;
      haptic('medium');
      renderCategories();
      loadItems();
    });
  });
}

async function loadItems(silent = false) {
  const container = document.getElementById('items-container');
  const titleEl = document.getElementById('catalog-title');
  const countEl = document.getElementById('catalog-count');
  const catName = CATEGORIES.find(c => c.slug === selectedCategory)?.name || selectedCategory;
  titleEl.textContent = searchQuery ? `Поиск: ${searchQuery}` : catName;

  // Skeletons only on non-silent load
  if (!silent) {
    container.innerHTML = `<div class="items-grid">${Array(6).fill(`
      <div class="icard" style="pointer-events:none">
        <div class="icard-banner"><div class="skel" style="width:100%;height:100%"></div></div>
        <div class="icard-body">
          <div class="skel" style="height:12px;width:85%;margin-bottom:4px"></div>
          <div class="skel" style="height:10px;width:55%;margin-bottom:10px"></div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="skel" style="height:16px;width:50px"></div>
            <div class="skel" style="height:28px;width:28px;border-radius:7px"></div>
          </div>
        </div>
      </div>
    `).join('')}</div>`;
    await new Promise(r => setTimeout(r, 500));
  }

  let items = [];
  try {
    const params = { category: selectedCategory };
    if (searchQuery) params.title = searchQuery;
    if (priceMin != null) params.pmin = priceMin;
    if (priceMax != null) params.pmax = priceMax;
    if (sortBy === 'price_asc') params.order_by = 'price';
    else if (sortBy === 'price_desc') params.order_by = 'price';
    const data = await getCatalog(params);
    items = data.items || [];
  } catch (err) {
    container.innerHTML = `<div class="empty"><div class="empty-icon"><i class="bi bi-exclamation-triangle"></i></div><div class="empty-title">Ошибка загрузки</div><div class="empty-desc">${esc(err.message)}</div></div>`;
    return;
  }

  // Client-side price filter (backup for API items with markup)
  if (priceMin != null) items = items.filter(i => i.price >= priceMin);
  if (priceMax != null) items = items.filter(i => i.price <= priceMax);

  // Client-side sorting
  if (sortBy === 'price_asc') items = [...items].sort((a, b) => a.price - b.price);
  else if (sortBy === 'price_desc') items = [...items].sort((a, b) => b.price - a.price);

  countEl.textContent = items.length ? `${items.length} шт.` : '';

  if (!items.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon"><i class="bi bi-search"></i></div><div class="empty-title">Ничего не нашлось</div><div class="empty-desc">Попробуйте изменить фильтры</div></div>`;
    return;
  }

  const cat = CATEGORIES.find(c => c.slug === selectedCategory);

  // Strip BBCode tags from description
  function stripBB(str, maxLen = 80) {
    if (!str) return '';
    return str
      .replace(/\[URL[^\]]*\][^\[]*\[\/URL\]/gi, '')
      .replace(/\[IMG[^\]]*\][^\[]*\[\/IMG\]/gi, '')
      .replace(/\[tooltip=[^\]]*\]([^\[]*)\[\/tooltip\]/gi, '$1')
      .replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi, '')
      .replace(/\[\/?(B|I|U|S|SIZE|COLOR|FONT|CENTER|LEFT|RIGHT|LIST|INDENT|HEADING|PLAIN|CODE|ICODE|HR)[^\]]*\]/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  container.innerHTML = `<div class="items-grid">${items.map(item => {
    const title = item.title || 'Аккаунт';
    const price = item.price || 0;

    return `
      <div class="icard" data-item='${JSON.stringify({
        id: item.item_id, title, price, desc: stripBB(item.description || '', 300),
        country: item.telegram_country || '', phone: item.telegram_phone || '',
        dc: item.telegram_dc_id || '', premium: item.telegram_premium || 0,
        login: item.login || '',
      }).replace(/'/g, '&#39;')}' style="cursor:pointer">
        <div class="icard-banner" style="background:${cat?.gradient || 'var(--raised-2)'}">
          <div class="icard-banner-icon">${getCategoryIcon(selectedCategory, 20)}</div>
          <span class="icard-banner-label">${esc(cat?.name || '')}</span>
        </div>
        <div class="icard-body">
          <div class="icard-title">${esc(title)}</div>
          <div class="icard-bottom">
            <div class="icard-price">⭐ ${fmtPrice(price)}</div>
            <button class="btn-buy-sm" data-buy="${item.item_id}" data-price="${price}" data-name="${esc(title)}">
              <i class="bi bi-bag-plus"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('')}</div>`;

  // Stagger animation
  container.querySelectorAll('.icard').forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(8px)';
    setTimeout(() => {
      card.style.transition = 'all 0.3s cubic-bezier(0.16,1,0.3,1)';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, i * 40);
  });

  // Card click → detail modal
  container.querySelectorAll('.icard[data-item]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('[data-buy]')) return; // Don't trigger if buy button clicked
      haptic('light');
      try {
        const item = JSON.parse(card.dataset.item);
        showItemDetail(item);
      } catch { /* ignore */ }
    });
  });

  container.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      haptic('medium');
      showPayment(btn.dataset.buy, btn.dataset.price, btn.dataset.name);
    });
  });
}

function showItemDetail(item) {
  const root = document.getElementById('modal-root');
  const cat = CATEGORIES.find(c => c.slug === selectedCategory);

  // Build info rows
  const rows = [];
  if (item.country) rows.push(['🌍 Страна', item.country]);
  if (item.phone) rows.push(['📱 Телефон', item.phone]);
  if (item.dc) rows.push(['🏠 Дата-центр', `DC${item.dc}`]);
  if (item.premium) rows.push(['⭐ Premium', 'Да']);
  if (item.login) rows.push(['👤 Логин', item.login]);

  root.innerHTML = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal-panel">
        <div class="modal-grip"></div>

        <div class="pay-header" style="background:${cat?.gradient || 'var(--raised-2)'}">
          <div style="display:flex;align-items:center;gap:8px">
            ${getCategoryIcon(selectedCategory, 22)}
            <div class="pay-title" style="font-size:.8125rem">${esc(cat?.name || 'Аккаунт')}</div>
          </div>
          <div class="pay-name" style="margin-top:4px;font-size:.75rem;opacity:.7">#${item.id}</div>
        </div>

        <div style="padding:16px">
          <div style="font-size:.9375rem;font-weight:700;color:var(--t1);margin-bottom:12px;line-height:1.4">${esc(item.title)}</div>

          ${item.desc ? `<div style="font-size:.75rem;color:var(--t3);line-height:1.5;margin-bottom:14px;padding:10px;background:var(--bg2);border-radius:10px">${esc(item.desc)}</div>` : ''}

          ${rows.length ? `
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
              ${rows.map(([label, value]) => `
                <div class="pay-detail">
                  <span class="pay-detail-label">${label}</span>
                  <span class="pay-detail-value">${esc(value)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <div class="pay-amount" style="margin-bottom:16px">
            <div class="pay-amount-value">⭐ ${fmtPrice(item.price)}</div>
          </div>

          <button class="btn-cta cta-stars" id="detail-buy-btn">
            <i class="bi bi-bag-plus"></i> Купить за ⭐ ${fmtPrice(item.price)}
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { root.innerHTML = ''; haptic(); }
  });

  document.getElementById('detail-buy-btn')?.addEventListener('click', () => {
    root.innerHTML = '';
    showPayment(item.id, item.price, item.title);
  });
}

function renderCatalog() { renderCategories(); loadItems(); }

// ═══════════════════════════════════════
// Payment Modal
// ═══════════════════════════════════════

function showPayment(itemId, price, title) {
  const root = document.getElementById('modal-root');
  const starsPrice = price; // Already in Stars from backend
  const cat = CATEGORIES.find(c => c.slug === selectedCategory);

  root.innerHTML = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal-panel">
        <div class="modal-grip"></div>

        <div class="pay-header">
          <div class="pay-title">Оплата</div>
          <div class="pay-name">${esc(title || 'Аккаунт')}</div>
        </div>

        <div class="pay-amount">
          <div class="pay-amount-value">⭐ ${fmtPrice(starsPrice)}</div>
        </div>

        <div class="pay-divider"></div>

        <div class="pay-detail">
          <span class="pay-detail-label">Товар</span>
          <span class="pay-detail-value">${esc(cat?.name || '')} #${itemId}</span>
        </div>
        <div class="pay-detail">
          <span class="pay-detail-label">Способ оплаты</span>
          <span class="pay-detail-value">Telegram Stars</span>
        </div>

        <button class="btn-cta cta-stars" id="pay-stars-btn">
          Оплатить ⭐ ${fmtPrice(starsPrice)}
        </button>
      </div>
    </div>
  `;

  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { root.innerHTML = ''; haptic(); }
  });

  document.getElementById('pay-stars-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('pay-stars-btn');
    const panel = root.querySelector('.modal-panel');
    btn.disabled = true;
    btn.innerHTML = '<div class="spin" style="width:16px;height:16px;margin:0"></div> Покупаем...';
    haptic('heavy');

    // Simulated progress (works on all devices)
    const t1 = setTimeout(() => {
      btn.innerHTML = '<div class="spin" style="width:14px;height:14px;margin:0"></div> 🔍 Проверяем аккаунт...';
    }, 2000);
    const t2 = setTimeout(() => {
      btn.innerHTML = '<div class="spin" style="width:14px;height:14px;margin:0"></div> 💰 Оформляем покупку...';
    }, 5000);

    try {
      const result = await purchaseItem(itemId);
      clearTimeout(t1); clearTimeout(t2);

      if (result.status === 'completed') {
        haptic('success');
        // Show success screen in modal
        if (panel) {
          panel.innerHTML = `
            <div class="modal-grip"></div>
            <div style="text-align:center;padding:32px 16px">
              <div style="font-size:3rem;margin-bottom:16px">🎉</div>
              <div style="font-size:1.1rem;font-weight:700;color:var(--t1);margin-bottom:8px">Спасибо за покупку!</div>
              <div style="font-size:.8125rem;color:var(--t3);margin-bottom:20px">Аккаунт доступен в ваших заказах</div>
              <button class="btn-cta cta-stars" id="go-to-order" style="margin-bottom:8px">📦 Открыть заказ</button>
              <button class="btn-cta" id="close-success" style="background:var(--bg3);color:var(--t2)">Закрыть</button>
            </div>`;
          document.getElementById('go-to-order')?.addEventListener('click', () => {
            root.innerHTML = '';
            if (result.order_id) showOrderDetail(result.order_id);
          });
          document.getElementById('close-success')?.addEventListener('click', () => {
            root.innerHTML = '';
          });
        }
        loadBalance();
      } else {
        root.innerHTML = '';
        toast('Статус: ' + (result.status || 'unknown'));
      }
    } catch (err) {
      clearTimeout(t1); clearTimeout(t2);
      const msg = err.message || 'Неизвестная ошибка';
      haptic('error');
      if (panel) {
        panel.innerHTML = `
          <div class="modal-grip"></div>
          <div style="text-align:center;padding:24px 16px">
            <div style="font-size:2.5rem;margin-bottom:12px">😔</div>
            <div style="font-size:.9375rem;font-weight:700;color:var(--t1);margin-bottom:8px">Не удалось купить</div>
            <div style="font-size:.75rem;color:var(--t3);line-height:1.5;margin-bottom:16px">${esc(msg)}</div>
            <div style="font-size:.625rem;color:var(--t4)">⭐ Stars возвращены на баланс</div>
          </div>`;
        setTimeout(() => { root.innerHTML = ''; }, 4000);
      } else {
        toast('❌ ' + msg);
      }
      loadBalance();
      if (msg.includes('продан') || msg.includes('не найден') || msg.includes('404')) {
        loadItems();
      }
    }
  });
}
// ═══════════════════════════════════════
// Orders
// ═══════════════════════════════════════

async function renderOrders() {
  const container = document.getElementById('orders-container');
  container.innerHTML = '<div class="spin"></div>';
  await new Promise(r => setTimeout(r, 300));

  const orders = (await getMyOrders().catch(() => ({}))).orders || [];

  if (!orders.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon"><i class="bi bi-bag"></i></div><div class="empty-title">Пока пусто</div><div class="empty-desc">Ваши покупки появятся здесь</div></div>`;
    return;
  }

  const sm = {
    pending:          { i: 'bi-clock',       l: 'Ожидание',  c: 's-wait' },
    awaiting_payment: { i: 'bi-credit-card', l: 'К оплате',  c: 's-wait' },
    paid:             { i: 'bi-check-circle',l: 'Оплачен',   c: 's-pay'  },
    completed:        { i: 'bi-check-lg',    l: 'Готово',     c: 's-done' },
    error:            { i: 'bi-x-circle',    l: 'Ошибка',    c: 's-err'  },
  };

  container.innerHTML = orders.map(o => {
    const s = sm[o.status] || sm.pending;
    return `
      <div class="ocard" data-order-id="${o.id}" style="cursor:pointer">
        <div class="ocard-icon ${s.c}"><i class="bi ${s.i}"></i></div>
        <div class="ocard-info">
          <div class="ocard-title">${esc(o.item_title)}</div>
          <div class="ocard-meta">
            <span>#${o.id}</span><span class="sep"></span>
            <span>${s.l}</span><span class="sep"></span>
            <span>${timeAgo(o.created_at)}</span>
          </div>
        </div>
        <div class="ocard-price">${fmtPrice(o.sell_price)} ₽</div>
        <i class="bi bi-chevron-right" style="color:var(--t4);font-size:.75rem;margin-left:4px"></i>
      </div>`;
  }).join('');

  container.querySelectorAll('.ocard').forEach((c, i) => {
    c.style.opacity = '0';
    setTimeout(() => { c.style.transition = 'opacity .3s'; c.style.opacity = '1'; }, i * 50);
    c.addEventListener('click', () => {
      haptic('medium');
      showOrderDetail(c.dataset.orderId);
    });
  });
}

async function showOrderDetail(orderId) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal-panel">
        <div class="modal-grip"></div>
        <div class="pay-header">
          <div class="pay-title">📦 Заказ #${orderId}</div>
          <div class="pay-name">Загрузка...</div>
        </div>
      </div>
    </div>`;

  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { root.innerHTML = ''; haptic(); }
  });

  try {
    const res = await fetch(`/api/orders/${orderId}`);
    if (!res.ok) throw new Error('Не удалось загрузить заказ');
    const { order } = await res.json();
    const ad = order.account_data || {};

    const statusLabels = {
      completed: { icon: '✅', text: 'Завершён' },
      paid: { icon: '💳', text: 'Оплачен' },
      pending: { icon: '⏳', text: 'Ожидание' },
      error: { icon: '❌', text: 'Ошибка' },
    };
    const st = statusLabels[order.status] || statusLabels.pending;

    // Build credential rows — skip duplicates and encoded variants
    const creds = [];
    const loginData = ad.loginData || {};
    const skipKeys = new Set(['raw', 'encodedRaw', 'encodedPassword', 'encodedOldPassword']);

    // Main credentials
    const login = loginData.login || ad.account || '';
    const password = loginData.password || ad.password || '';
    const email = loginData.email || ad.email || '';
    const emailPwd = loginData.emailPassword || ad.emailPassword || '';

    // Detect if this is a Telegram account (has telegram_phone or long hex login)
    const isTelegram = ad.telegram_phone || (login.length > 100 && /^[a-f0-9]+$/i.test(login));

    if (isTelegram) {
      // Telegram account format (like LZT shows)
      if (ad.telegram_phone) creds.push({ label: 'Номер телефона', value: String(ad.telegram_phone), icon: 'bi-phone', long: false });
      if (login) creds.push({ label: 'Auth Key (HEX)', value: login, icon: 'bi-key', long: true });
      if (ad.telegram_dc_id) creds.push({ label: 'DC ID', value: String(ad.telegram_dc_id), icon: 'bi-hdd-network', long: false });
      if (ad.telegram_id) creds.push({ label: 'User ID', value: String(ad.telegram_id), icon: 'bi-person-badge', long: false });
      if (ad.telegram_country) creds.push({ label: 'Страна', value: String(ad.telegram_country), icon: 'bi-globe', long: false });
    } else {
      // Standard account format
      if (login) creds.push({ label: 'Логин', value: login, icon: 'bi-person', long: false });
      if (password) creds.push({ label: 'Пароль', value: password, icon: 'bi-key', long: false });
      if (email) creds.push({ label: 'Email', value: email, icon: 'bi-envelope', long: false });
      if (emailPwd) creds.push({ label: 'Пароль Email', value: emailPwd, icon: 'bi-shield-lock', long: false });
    }

    // Extra fields from loginData (skip known + duplicates)
    const knownKeys = new Set(['login', 'password', 'email', 'emailPassword', ...skipKeys]);
    for (const [key, val] of Object.entries(loginData)) {
      if (!knownKeys.has(key) && val && String(val) !== '?') {
        creds.push({ label: key, value: String(val), icon: 'bi-info-circle', long: String(val).length > 100 });
      }
    }

    const panel = root.querySelector('.modal-panel');
    panel.innerHTML = `
      <div class="modal-grip"></div>
      <div class="pay-header">
        <div class="pay-title">${st.icon} Заказ #${order.id}</div>
        <div class="pay-name">${esc(order.item_title)}</div>
      </div>

      <div class="order-detail-status">${st.text} · ${fmtPrice(order.sell_price)} ₽</div>

      ${creds.length ? `
        <div class="order-creds-title">🔑 Данные аккаунта</div>
        <div class="order-creds">
          ${creds.map((c, i) => `
            <div class="order-cred-row">
              <div class="order-cred-label"><i class="bi ${c.icon}"></i> ${esc(c.label)}</div>
              <div class="order-cred-value">
                <span class="order-cred-text ${c.long ? 'cred-truncated' : ''}" id="cred-text-${i}">${c.long ? esc(c.value.slice(0, 80)) + '…' : esc(c.value)}</span>
                ${c.long ? `<button class="order-cred-expand" data-full="${esc(c.value)}" data-idx="${i}"><i class="bi bi-arrows-angle-expand"></i></button>` : ''}
                <button class="order-cred-copy" data-copy="${esc(c.value)}"><i class="bi bi-copy"></i></button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : order.status === 'completed' ? '<div class="order-no-creds">Данные аккаунта недоступны</div>' : '<div class="order-no-creds">Заказ ещё не завершён</div>'}

      ${order.error_message ? `<div class="order-error">⚠️ ${esc(order.error_message)}</div>` : ''}

      ${isTelegram && order.status === 'completed' && order.lzt_item_id ? `
        <div class="order-creds-title" style="margin-top:16px">📲 Действия с аккаунтом</div>
        <div class="order-tg-actions">
          <button class="order-tg-btn tg-btn-code" data-item="${order.lzt_item_id}">
            <i class="bi bi-key"></i> Получить код
          </button>
          <button class="order-tg-btn tg-btn-reset" data-item="${order.lzt_item_id}">
            <i class="bi bi-arrow-counterclockwise"></i> Сбросить авторизации
          </button>
        </div>
      ` : ''}
    `;

    // Copy buttons
    panel.querySelectorAll('.order-cred-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(btn.dataset.copy);
        toast('📋 Скопировано!');
        haptic('medium');
      });
    });

    // Expand buttons for long values
    panel.querySelectorAll('.order-cred-expand').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = btn.dataset.idx;
        const text = document.getElementById(`cred-text-${idx}`);
        if (text.classList.contains('cred-truncated')) {
          text.textContent = btn.dataset.full;
          text.classList.remove('cred-truncated');
          btn.innerHTML = '<i class="bi bi-arrows-angle-contract"></i>';
        } else {
          text.textContent = btn.dataset.full.slice(0, 80) + '…';
          text.classList.add('cred-truncated');
          btn.innerHTML = '<i class="bi bi-arrows-angle-expand"></i>';
        }
      });
    });

    // Telegram action buttons
    panel.querySelector('.tg-btn-code')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const itemId = btn.dataset.item;
      btn.disabled = true;
      btn.innerHTML = '<div class="spin" style="width:14px;height:14px;margin:0"></div> Запрос...';
      haptic('medium');
      try {
        const res = await fetch(`/api/telegram-code/${itemId}`);
        const data = await res.json();
        if (!res.ok) {
          // Parse LZT error
          const errMsg = data.error || '';
          if (errMsg.includes('недействительна') || errMsg.includes('заблокирован')) {
            throw new Error('Сессия недействительна — аккаунт заблокирован или деавторизован');
          }
          throw new Error(errMsg || 'Ошибка получения кода');
        }
        // Show codes in modal
        showTelegramCodeModal(data, itemId);
      } catch (err) {
        toast('❌ ' + err.message);
      }
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-key"></i> Получить код';
    });

    panel.querySelector('.tg-btn-reset')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const itemId = btn.dataset.item;
      btn.disabled = true;
      btn.innerHTML = '<div class="spin" style="width:14px;height:14px;margin:0"></div> Сброс...';
      haptic('heavy');
      try {
        const res = await fetch(`/api/telegram-reset/${itemId}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          const errMsg = data.error || '';
          if (errMsg.includes('недействительна') || errMsg.includes('заблокирован')) {
            throw new Error('Сессия недействительна — аккаунт заблокирован или деавторизован');
          }
          throw new Error(errMsg || 'Ошибка');
        }
        toast('🔄 Другие авторизации сброшены!');
      } catch (err) {
        toast('❌ ' + err.message);
      }
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i> Сбросить авторизации';
    });
  } catch (err) {
    root.querySelector('.pay-name').textContent = err.message;
  }
}

function showTelegramCodeModal(data, itemId) {
  const root = document.getElementById('modal-root');

  // Parse codes from LZT response
  let codes = [];
  if (data.codes) codes = Array.isArray(data.codes) ? data.codes : [data.codes];
  else if (data.loginCodes) codes = Array.isArray(data.loginCodes) ? data.loginCodes : [data.loginCodes];
  else if (data.code) codes = [{ code: data.code }];
  else if (data.item?.loginCodes) codes = data.item.loginCodes;

  if (!codes.length) {
    const json = JSON.stringify(data);
    const found = json.match(/\b\d{5}\b/g);
    if (found) codes = found.map(c => ({ code: c }));
  }

  const phone = data.phone || data.telegram_phone || '';

  root.innerHTML = `
    <div class="modal-bg" id="code-modal-bg">
      <div class="modal-panel">
        <div class="modal-grip"></div>

        <div class="code-modal-header">
          <div class="code-modal-icon"><i class="bi bi-shield-lock"></i></div>
          <div class="code-modal-title">Код подтверждения</div>
          ${phone ? `<div class="code-modal-phone">+${esc(String(phone))}</div>` : ''}
        </div>

        <div class="tg-code-display" id="tg-codes-list">
          ${codes.length ? codes.map((c, i) => `
            <div class="tg-code-item${i === 0 ? ' tg-code-latest' : ''}">
              <div class="tg-code-time">${c.date || c.time ? esc(String(c.date || c.time)) : i === 0 ? 'Только что' : ''}</div>
              <div class="tg-code-row">
                <div class="tg-code-digits">${esc(String(c.code || c))}</div>
                <button class="tg-code-copy" data-code="${esc(String(c.code || c))}"><i class="bi bi-copy"></i></button>
              </div>
            </div>
          `).join('') : '<div class="tg-code-empty"><i class="bi bi-exclamation-triangle"></i> Код не получен</div>'}
        </div>

        ${itemId ? `
          <button class="order-tg-btn tg-btn-code tg-btn-refresh" id="tg-refresh-code" data-item="${itemId}" style="width:100%;margin-bottom:12px">
            <i class="bi bi-arrow-repeat"></i> Получить новый код
          </button>
        ` : ''}

        <div class="tg-code-note">
          <i class="bi bi-info-circle"></i> Код действителен несколько минут. Используйте последний.
        </div>
      </div>
    </div>`;

  document.getElementById('code-modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { root.innerHTML = ''; haptic(); }
  });

  root.querySelectorAll('.tg-code-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard?.writeText(btn.dataset.code);
      toast('📋 Код скопирован!');
      haptic('medium');
    });
  });

  // Refresh button
  document.getElementById('tg-refresh-code')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const id = btn.dataset.item;
    btn.disabled = true;
    btn.innerHTML = '<div class="spin" style="width:14px;height:14px;margin:0"></div> Запрос...';
    haptic('medium');
    try {
      const res = await fetch(`/api/telegram-code/${id}`);
      const newData = await res.json();
      if (!res.ok) {
        const errMsg = newData.error || '';
        if (errMsg.includes('недействительна') || errMsg.includes('заблокирован')) {
          toast('❌ Сессия недействительна — аккаунт заблокирован');
        } else if (errMsg.includes('429') || errMsg.includes('подождите') || errMsg.includes('Too many')) {
          toast('⏳ Слишком часто. Подождите пару минут.');
        } else {
          toast('❌ ' + (errMsg || 'Ошибка'));
        }
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Получить новый код';
        return;
      }
      // Re-render modal with new data
      showTelegramCodeModal(newData, id);
      toast('✅ Новый код получен!');
    } catch (err) {
      toast('❌ ' + err.message);
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Получить новый код';
    }
  });
}

// ═══════════════════════════════════════
// Admin
// ═══════════════════════════════════════

let adminTab = 'orders';

async function renderAdmin() {
  const statsEl = document.getElementById('admin-stats-container');
  const actionsEl = document.getElementById('admin-actions');
  const contentEl = document.getElementById('admin-content');
  const s = await getAdminStats().catch(() => ({}));

  // Stats with two balance sections
  statsEl.innerHTML = `
    <div class="stats-grid">
      <div class="scard sc-green"><div class="scard-label">Профит</div><div class="scard-value">${fmtPrice(s.total_profit)} ₽</div></div>
      <div class="scard sc-blue"><div class="scard-label">Оборот</div><div class="scard-value">${fmtPrice(s.total_revenue)} ₽</div></div>
    </div>
    <div class="stats-grid">
      <div class="scard sc-amber"><div class="scard-label">Заказы</div><div class="scard-value">${s.completed_orders}/${s.total_orders}</div></div>
      <div class="scard"><div class="scard-label">Пользователи</div><div class="scard-value">${s.total_users}</div></div>
    </div>

    <div class="admin-balance-section">
      <div class="admin-balance-title">🏦 Балансы</div>
      <div class="stats-grid">
        <div class="scard sc-green">
          <div class="scard-label">💰 Маркет</div>
          <div class="scard-value">${fmtPrice(s.lzt_balance)} ₽</div>
          <div class="scard-sub">Покупки: ${fmtPrice(s.lzt_purchase_balance)} ₽</div>
        </div>
        <div class="scard sc-blue">
          <div class="scard-label">⭐ Stars (юзеры)</div>
          <div class="scard-value">${fmtPrice(s.total_stars || 0)} ⭐</div>
          <div class="scard-sub">~${fmtPrice(Math.round((s.total_stars || 0) * 1.6))} ₽</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="scard sc-amber"><div class="scard-label">Сегодня</div><div class="scard-value">${s.today_orders} · ${fmtPrice(s.today_profit)}₽</div></div>
        <div class="scard"><div class="scard-label">Холд</div><div class="scard-value">${fmtPrice(s.lzt_hold || 0)} ₽</div></div>
      </div>
    </div>`;

  // Quick actions with working deposit
  actionsEl.innerHTML = `
    <button class="admin-act act-blue" id="admin-deposit-btn"><i class="bi bi-plus-circle"></i>Пополнить Stars</button>
    <button class="admin-act act-green" data-action="sync"><i class="bi bi-arrow-repeat"></i>Синхронизация</button>
    <button class="admin-act act-amber" data-action="export"><i class="bi bi-download"></i>Экспорт</button>
    <button class="admin-act act-red" data-action="cache"><i class="bi bi-trash3"></i>Очистить кэш</button>
  `;

  // Deposit button
  document.getElementById('admin-deposit-btn')?.addEventListener('click', () => {
    haptic('medium');
    showDepositModal();
  });

  actionsEl.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      haptic('medium');
      const labels = { sync: '🔄 Синхронизация запущена', export: '📦 Экспорт данных...', cache: '🗑️ Кэш очищен!' };
      toast(labels[btn.dataset.action] || 'Действие');
    });
  });

  // Sub-tabs
  document.querySelectorAll('.atab').forEach(tab => {
    tab.addEventListener('click', () => {
      adminTab = tab.dataset.atab;
      document.querySelectorAll('.atab').forEach(t => t.classList.toggle('active', t.dataset.atab === adminTab));
      haptic();
      renderAdminContent();
    });
  });

  renderAdminContent();
}

function showDepositModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal-panel">
        <div class="modal-grip"></div>
        <div class="pay-header">
          <div class="pay-title">⭐ Пополнить Stars</div>
          <div class="pay-name">Зачислить Stars на баланс пользователя</div>
        </div>
        <div class="deposit-form">
          <input type="number" id="deposit-uid" placeholder="User ID" class="deposit-input" />
          <input type="number" id="deposit-amount" placeholder="Кол-во Stars" class="deposit-input" min="1" />
          <button class="btn-cta cta-stars" id="deposit-submit">Зачислить ⭐</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { root.innerHTML = ''; haptic(); }
  });

  document.getElementById('deposit-submit')?.addEventListener('click', async () => {
    const uid = parseInt(document.getElementById('deposit-uid')?.value);
    const amount = parseInt(document.getElementById('deposit-amount')?.value);
    if (!uid || !amount || amount <= 0) {
      toast('❌ Укажите User ID и сумму');
      return;
    }
    const btn = document.getElementById('deposit-submit');
    btn.disabled = true;
    btn.textContent = 'Зачисляем...';
    try {
      const res = await fetch('/api/admin/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: uid, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      root.innerHTML = '';
      toast(`✅ Зачислено ${amount} ⭐ → User ${uid} (баланс: ${data.new_balance}⭐)`);
      renderAdmin(); // Refresh stats
    } catch (err) {
      toast('❌ ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Зачислить ⭐';
    }
  });
}

function renderAdminContent() {
  const el = document.getElementById('admin-content');
  if (adminTab === 'orders') renderAdminOrders(el);
  else if (adminTab === 'users') renderAdminUsers(el);
  else if (adminTab === 'items') renderAdminItems(el);
}

async function renderAdminOrders(el) {
  const statusMap = { completed: 'badge-done', paid: 'badge-pay', pending: 'badge-wait', error: 'badge-err' };
  const statusLabel = { completed: 'Готово', paid: 'Оплачен', pending: 'Ожидание', error: 'Ошибка' };
  const adminOrders = (await getAdminOrders().catch(() => ({}))).orders || [];
  if (!adminOrders.length) { el.innerHTML = '<div class="empty"><div class="empty-title">Нет заказов</div></div>'; return; }

  el.innerHTML = adminOrders.map(o => `
    <div class="arow">
      <span class="arow-id">#${o.id}</span>
      <div class="arow-body">
        <div class="arow-name">${esc(o.item_title || '')}</div>
        <div class="arow-meta">${fmtPrice(o.sell_price || 0)}₽ · ${timeAgo(o.created_at)}</div>
      </div>
      <span class="badge ${statusMap[o.status] || 'badge-wait'}">${statusLabel[o.status] || o.status}</span>
    </div>
  `).join('');
}

async function renderAdminUsers(el) {
  const adminUsers = (await getAdminUsers().catch(() => ({}))).users || [];
  if (!adminUsers.length) { el.innerHTML = '<div class="empty"><div class="empty-title">Нет пользователей</div></div>'; return; }

  el.innerHTML = adminUsers.map(u => `
    <div class="arow">
      <span class="arow-id">${u.user_id}</span>
      <div class="arow-body">
        <div class="arow-name">@${esc(u.username || 'unknown')} ${u.is_blocked ? '<span class="badge badge-err">BAN</span>' : ''}</div>
        <div class="arow-meta">Заказов: ${u.total_orders || 0} · ${fmtPrice(u.total_spent || 0)}₽</div>
      </div>
    </div>
  `).join('');
}

function renderAdminItems(el) {
  el.innerHTML = '<div class="empty"><div class="empty-title">Товары загружаются из LZT</div><div class="empty-desc">Управление через LZT Market</div></div>';
}

// ═══════════════════════════════════════
// Profile
// ═══════════════════════════════════════

async function renderProfile() {
  const container = document.getElementById('profile-container');
  let tgUser = tg?.initDataUnsafe?.user;

  // Fallback: get user info from API when Telegram SDK not available
  if (!tgUser) {
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        const data = await res.json();
        tgUser = { id: data.user_id, first_name: 'User', username: `id${data.user_id}`, photo_url: null };
      }
    } catch { /* ignore */ }
  }

  const firstName = tgUser?.first_name || 'User';
  const username = tgUser?.username || 'unknown';
  const userId = tgUser?.id || '—';
  const photoUrl = tgUser?.photo_url || null;
  const initial = firstName.charAt(0).toUpperCase();

  // Get Stars balance
  let starsBalance = 0;
  try {
    const balUrl = userId && userId !== '—' ? `/api/user/balance?user_id=${userId}` : '/api/user/balance';
    const res = await fetch(balUrl);
    if (res.ok) {
      const data = await res.json();
      starsBalance = data.stars_balance || 0;
    }
  } catch { /* ignore */ }

  const menuItems = [
    { icon: 'bi-headset', color: 'pmi-blue', label: 'Поддержка', desc: 'Помощь и вопросы' },
    { icon: 'bi-bell', color: 'pmi-amber', label: 'Уведомления', desc: 'Статус заказов' },
    { icon: 'bi-shield-check', color: 'pmi-green', label: 'Правила и гарантии', desc: 'Условия использования' },
  ];

  container.innerHTML = `
    <div class="profile-card">
      <div class="profile-avatar">
        ${photoUrl
          ? `<img class="profile-avatar-img" src="${esc(photoUrl)}" alt="${esc(firstName)}" />`
          : `<div class="profile-avatar-placeholder">${initial}</div>`
        }
      </div>
      <div class="profile-name">${esc(firstName)}</div>
      <div class="profile-username">@${esc(username)}</div>
      <div class="profile-id">ID: ${userId}</div>
      <div class="profile-status ps-active">⭐ ${starsBalance} Stars</div>
    </div>

    <div class="profile-menu">
      ${menuItems.map(m => `
        <div class="profile-menu-item">
          <div class="profile-menu-icon ${m.color}"><i class="bi ${m.icon}"></i></div>
          <div class="profile-menu-body">
            <div class="profile-menu-label">${m.label}</div>
            <div class="profile-menu-desc">${m.desc}</div>
          </div>
          <i class="bi bi-chevron-right profile-menu-chevron"></i>
        </div>
      `).join('')}
    </div>

    <div class="profile-footer">VAULT · v1.0.0</div>
  `;

  document.getElementById('copy-ref')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(p.referral_code).then(() => {
      toast('📋 Код скопирован!');
      haptic('medium');
    }).catch(() => toast('Не удалось скопировать'));
  });
}

// ═══════════════════════════════════════
// Utils
// ═══════════════════════════════════════

function esc(t) { if (!t) return ''; const e = document.createElement('span'); e.textContent = String(t); return e.innerHTML; }
function fmtPrice(n) { return n == null ? '0' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 }); }

function timeAgo(ts) {
  if (!ts) return '';
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return 'сейчас';
  if (d < 3600) return `${Math.floor(d / 60)} мин`;
  if (d < 86400) return `${Math.floor(d / 3600)} ч назад`;
  return `${Math.floor(d / 86400)} дн назад`;
}

function toast(msg) {
  document.querySelector('.toast-msg')?.remove();
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// ═══════════════════════════════════════
// Init
// ═══════════════════════════════════════

function initFilters() {
  const toggle = document.getElementById('filter-toggle');
  const panel = document.getElementById('filter-panel');

  toggle?.addEventListener('click', () => {
    toggle.classList.toggle('active');
    panel?.classList.toggle('open');
    haptic();
  });

  // Sort chips
  document.querySelectorAll('[data-sort]').forEach(chip => {
    chip.addEventListener('click', () => {
      sortBy = chip.dataset.sort;
      document.querySelectorAll('[data-sort]').forEach(c => c.classList.toggle('active', c.dataset.sort === sortBy));
      haptic();
      loadItems();
    });
  });

  // Price apply
  document.getElementById('filter-apply')?.addEventListener('click', () => {
    const minVal = document.getElementById('price-min')?.value;
    const maxVal = document.getElementById('price-max')?.value;
    priceMin = minVal ? parseInt(minVal, 10) : null;
    priceMax = maxVal ? parseInt(maxVal, 10) : null;
    haptic('medium');
    loadItems();
    toast(`Фильтр: ${priceMin || 0}₽ — ${priceMax || '∞'}₽`);
  });
}

function init() {
  // Fire telegram check in background — don't block UI
  if (tg) { tg.ready(); tg.expand(); tg.enableClosingConfirmation(); }
  initTelegram(); // async, non-blocking
  document.querySelectorAll('.bnav-tab').forEach(t => t.addEventListener('click', () => navigateTo(t.dataset.page)));
  let timer;
  document.getElementById('catalog-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchQuery = e.target.value.trim(); loadItems(); }, 400);
  });
  initFilters();
  navigateTo('catalog');
  loadBalance();

  // Manual refresh button
  document.getElementById('catalog-refresh')?.addEventListener('click', () => {
    haptic('medium');
    const icon = document.querySelector('#catalog-refresh i');
    icon?.classList.add('spinning');
    loadItems().finally(() => icon?.classList.remove('spinning'));
  });
}

async function loadBalance() {
  const pill = document.getElementById('balance-pill');
  const amount = document.getElementById('balance-amount');
  const icon = document.getElementById('balance-icon');
  if (!pill || !amount || !icon) return;

  try {
    // Get user ID from Telegram or API
    const tgUser = tg?.initDataUnsafe?.user;
    let uid = tgUser?.id || '';
    if (!uid) {
      try {
        const meRes = await fetch('/api/me');
        if (meRes.ok) { const me = await meRes.json(); uid = me.user_id || ''; }
      } catch { /* ignore */ }
    }

    const url = uid ? `/api/user/balance?user_id=${uid}` : '/api/user/balance';
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    icon.textContent = '⭐';
    amount.textContent = data.stars_balance || 0;
    pill.style.display = '';
  } catch { /* ignore */ }
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
