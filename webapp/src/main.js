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

function openModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = html;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  document.body.style.overflow = '';
}

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

  // Clean description — remove BBCode leftovers, :emoji:, URLs
  let desc = (item.desc || '')
    .replace(/:[a-zA-Z0-9_]+:/g, '')  // :righthand: etc
    .replace(/https?:\/\/\S+/g, '')
    .replace(/ЖМИ СЮДА/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (desc.length < 5) desc = '';

  // Build info chips
  const chips = [];
  if (item.country) chips.push({ icon: 'bi-globe-americas', label: item.country });
  if (item.dc) chips.push({ icon: 'bi-hdd-rack', label: `DC${item.dc}` });
  if (item.premium) chips.push({ icon: 'bi-star-fill', label: 'Premium' });
  if (item.phone) chips.push({ icon: 'bi-phone', label: item.phone });

  openModal(`
    <div class="modal-bg" id="modal-bg">
      <div class="modal-panel">
        <div class="modal-grip"></div>

        <div style="padding:20px 16px 0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
            <div style="width:36px;height:36px;border-radius:10px;background:${cat?.gradient || 'var(--raised-2)'};display:flex;align-items:center;justify-content:center">
              ${getCategoryIcon(selectedCategory, 18)}
            </div>
            <div>
              <div style="font-size:.6875rem;color:var(--t4);text-transform:uppercase;letter-spacing:.5px">${esc(cat?.name || 'Аккаунт')} · #${item.id}</div>
            </div>
          </div>

          <div style="font-size:.9375rem;font-weight:700;color:var(--t1);line-height:1.4;margin-bottom:12px">${esc(item.title)}</div>

          ${desc ? `<div style="font-size:.75rem;color:var(--t3);line-height:1.5;margin-bottom:14px">${esc(desc)}</div>` : ''}

          ${chips.length ? `
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
              ${chips.map(c => `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--bg2);border-radius:8px;font-size:.6875rem;color:var(--t2)"><i class="bi ${c.icon}" style="font-size:.625rem;opacity:.6"></i>${esc(c.label)}</span>`).join('')}
            </div>
          ` : ''}

          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--border);margin-bottom:16px">
            <span style="font-size:.75rem;color:var(--t3)">Стоимость</span>
            <span style="font-size:1.125rem;font-weight:800;color:var(--accent)">⭐ ${fmtPrice(item.price)}</span>
          </div>

          <button class="btn-cta cta-stars" id="detail-buy-btn" style="margin-bottom:16px">
            Купить за ⭐ ${fmtPrice(item.price)}
          </button>
        </div>
      </div>
    </div>
  `);

  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { closeModal(); haptic(); }
  });

  document.getElementById('detail-buy-btn')?.addEventListener('click', () => {
    closeModal();
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

  openModal(`
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
  `);

  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { closeModal(); haptic(); }
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
            closeModal();
            if (result.order_id) showOrderDetail(result.order_id);
          });
          document.getElementById('close-success')?.addEventListener('click', () => {
            closeModal();
          });
        }
        loadBalance();
      } else {
        closeModal();
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
        setTimeout(() => { closeModal(); }, 4000);
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
  openModal(`
    <div class="modal-bg" id="modal-bg">
      <div class="modal-panel">
        <div class="modal-grip"></div>
        <div class="pay-header">
          <div class="pay-title">📦 Заказ #${orderId}</div>
          <div class="pay-name">Загрузка...</div>
        </div>
      </div>
    </div>`);

  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { closeModal(); haptic(); }
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
        <div class="order-creds-title" style="margin-top:14px">⬇️ Скачать как:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 6px">
          <button class="tg-dl-btn" data-fmt="tdata" data-oid="${order.id}" style="flex:1;padding:8px 4px;background:linear-gradient(135deg,#22c55e,#16a34a);border:none;border-radius:8px;color:#fff;font-size:.6875rem;font-weight:600;cursor:pointer">TData</button>
          <button class="tg-dl-btn" data-fmt="telethon" data-oid="${order.id}" style="flex:1;padding:8px 4px;background:linear-gradient(135deg,#22c55e,#16a34a);border:none;border-radius:8px;color:#fff;font-size:.6875rem;font-weight:600;cursor:pointer">.session Telethon</button>
          <button class="tg-dl-btn" data-fmt="pyrogram" data-oid="${order.id}" style="flex:1;padding:8px 4px;background:linear-gradient(135deg,#22c55e,#16a34a);border:none;border-radius:8px;color:#fff;font-size:.6875rem;font-weight:600;cursor:pointer">.session Pyrogram</button>
          <button class="tg-dl-btn" data-fmt="json" data-oid="${order.id}" style="flex:1;padding:8px 4px;background:linear-gradient(135deg,#22c55e,#16a34a);border:none;border-radius:8px;color:#fff;font-size:.6875rem;font-weight:600;cursor:pointer">.json</button>
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

    // Download / Send to Telegram buttons
    panel.querySelectorAll('.tg-dl-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fmt = btn.dataset.fmt;
        const oid = btn.dataset.oid;
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '⏳';
        try {
          const uid = tg?.initDataUnsafe?.user?.id || '';
          const res = await fetch(`/api/orders/${oid}/send-tg`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ format: fmt, user_id: uid }),
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error || 'Ошибка');
          }
          btn.textContent = '✅';
          toast('📨 Отправлено в Telegram!');
          haptic('success');
          setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
        } catch (err) {
          btn.textContent = origText;
          btn.disabled = false;
          toast('❌ ' + err.message);
        }
      });
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

  openModal(`
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
    </div>`);

  document.getElementById('code-modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { closeModal(); haptic(); }
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
  const tabsEl = document.getElementById('admin-tabs');
  const s = await getAdminStats().catch(() => ({}));

  // Stats — top cards
  statsEl.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
      <div style="background:linear-gradient(135deg,rgba(34,197,94,.12),rgba(34,197,94,.04));border:1px solid rgba(34,197,94,.15);border-radius:14px;padding:14px">
        <div style="font-size:.625rem;color:#22c55e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Профит</div>
        <div style="font-size:1.25rem;font-weight:800;color:#22c55e">${fmtPrice(s.total_profit || 0)} ₽</div>
      </div>
      <div style="background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(99,102,241,.04));border:1px solid rgba(99,102,241,.15);border-radius:14px;padding:14px">
        <div style="font-size:.625rem;color:#818cf8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Оборот</div>
        <div style="font-size:1.25rem;font-weight:800;color:#818cf8">${fmtPrice(s.total_revenue || 0)} ₽</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px">
      <div style="background:var(--raised);border-radius:10px;padding:10px 8px;text-align:center">
        <div style="font-size:1rem;font-weight:800;color:var(--t1)">${s.completed_orders || 0}</div>
        <div style="font-size:.5625rem;color:var(--t4)">Заказы</div>
      </div>
      <div style="background:var(--raised);border-radius:10px;padding:10px 8px;text-align:center">
        <div style="font-size:1rem;font-weight:800;color:var(--t1)">${s.total_users || 0}</div>
        <div style="font-size:.5625rem;color:var(--t4)">Юзеры</div>
      </div>
      <div style="background:var(--raised);border-radius:10px;padding:10px 8px;text-align:center">
        <div style="font-size:1rem;font-weight:800;color:var(--accent)">${fmtPrice(s.total_stars || 0)}</div>
        <div style="font-size:.5625rem;color:var(--t4)">Stars ⭐</div>
      </div>
      <div style="background:var(--raised);border-radius:10px;padding:10px 8px;text-align:center">
        <div style="font-size:1rem;font-weight:800;color:var(--t1)">${s.today_orders || 0}</div>
        <div style="font-size:.5625rem;color:var(--t4)">Сегодня</div>
      </div>
    </div>

    <!-- Balances -->
    <div style="background:var(--raised);border-radius:14px;padding:14px;margin-bottom:12px">
      <div style="font-size:.6875rem;color:var(--t4);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">💰 Балансы LZT</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:.75rem;color:var(--t3)">Маркет</span>
        <span style="font-size:.875rem;font-weight:700;color:var(--t1)">${fmtPrice(s.lzt_balance || 0)} ₽</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:.75rem;color:var(--t3)">Покупки</span>
        <span style="font-size:.875rem;font-weight:700;color:var(--t1)">${fmtPrice(s.lzt_purchase_balance || 0)} ₽</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:.75rem;color:var(--t3)">Холд</span>
        <span style="font-size:.875rem;font-weight:700;color:var(--t1)">${fmtPrice(s.lzt_hold || 0)} ₽</span>
      </div>
    </div>`;

  // Quick actions
  actionsEl.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px">
      <button id="admin-deposit-btn" style="display:flex;align-items:center;justify-content:center;gap:5px;padding:10px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;border-radius:10px;color:#fff;font-size:.75rem;font-weight:600;cursor:pointer">
        <i class="bi bi-plus-circle"></i> Пополнить ⭐
      </button>
      <button id="admin-cache-btn" style="display:flex;align-items:center;justify-content:center;gap:5px;padding:10px;background:var(--raised);border:1px solid var(--border);border-radius:10px;color:var(--t2);font-size:.75rem;font-weight:600;cursor:pointer">
        <i class="bi bi-trash3"></i> Очистить кэш
      </button>
    </div>`;

  // Deposit
  document.getElementById('admin-deposit-btn')?.addEventListener('click', () => {
    haptic('medium');
    showDepositModal();
  });

  // Clear cache
  document.getElementById('admin-cache-btn')?.addEventListener('click', () => {
    haptic('medium');
    toast('🗑️ Кэш очищен!');
  });

  // Tabs — pill style
  tabsEl.innerHTML = `
    <div style="display:flex;background:var(--bg2);border-radius:10px;padding:3px;gap:2px">
      <button class="adm-pill ${adminTab === 'orders' ? 'adm-pill-active' : ''}" data-atab="orders">Заказы</button>
      <button class="adm-pill ${adminTab === 'users' ? 'adm-pill-active' : ''}" data-atab="users">Юзеры</button>
      <button class="adm-pill ${adminTab === 'tickets' ? 'adm-pill-active' : ''}" data-atab="tickets">Тикеты</button>
      <button class="adm-pill ${adminTab === 'items' ? 'adm-pill-active' : ''}" data-atab="items">Товары</button>
    </div>`;

  tabsEl.querySelectorAll('.adm-pill').forEach(tab => {
    tab.addEventListener('click', () => {
      adminTab = tab.dataset.atab;
      tabsEl.querySelectorAll('.adm-pill').forEach(t => t.classList.toggle('adm-pill-active', t.dataset.atab === adminTab));
      haptic();
      renderAdminContent();
    });
  });

  renderAdminContent();
}

function showDepositModal() {
  openModal(`
    <div class="modal-bg" id="modal-bg">
      <div class="modal-panel">
        <div class="modal-grip"></div>
        <div style="padding:20px 16px">
          <div style="font-size:1rem;font-weight:700;color:var(--t1);margin-bottom:4px">⭐ Пополнить Stars</div>
          <div style="font-size:.6875rem;color:var(--t4);margin-bottom:16px">Зачислить Stars на баланс пользователя</div>
          <input type="number" id="deposit-uid" placeholder="User ID" style="width:100%;padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;color:var(--t1);font-size:.8125rem;margin-bottom:8px;box-sizing:border-box" />
          <input type="number" id="deposit-amount" placeholder="Кол-во Stars" min="1" style="width:100%;padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;color:var(--t1);font-size:.8125rem;margin-bottom:12px;box-sizing:border-box" />
          <button class="btn-cta cta-stars" id="deposit-submit">Зачислить ⭐</button>
        </div>
      </div>
    </div>
  `);

  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { closeModal(); haptic(); }
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
      closeModal();
      toast(`✅ Зачислено ${amount} ⭐ → User ${uid} (баланс: ${data.new_balance}⭐)`);
      renderAdmin();
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
  else if (adminTab === 'tickets') renderAdminTickets(el);
  else if (adminTab === 'items') renderAdminItems(el);
}

async function renderAdminOrders(el) {
  el.innerHTML = '<div class="spin"></div>';
  const adminOrders = (await getAdminOrders().catch(() => ({}))).orders || [];
  if (!adminOrders.length) {
    el.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--t4);font-size:.8125rem"><i class="bi bi-inbox" style="font-size:2rem;display:block;margin-bottom:8px;opacity:.3"></i>Нет заказов</div>';
    return;
  }

  const statusColor = { completed: '#22c55e', paid: '#3b82f6', pending: '#f59e0b', error: '#ef4444' };
  const statusLabel = { completed: 'Готово', paid: 'Оплачен', pending: 'Ожидание', error: 'Ошибка' };

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">${adminOrders.map(o => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--raised);border-radius:10px;cursor:pointer" onclick="this.querySelector('.ao-expand')?.classList.toggle('ao-show')">
      <div style="width:6px;height:6px;border-radius:50%;background:${statusColor[o.status] || '#888'};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.75rem;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.item_title || 'Без названия')}</div>
        <div style="font-size:.625rem;color:var(--t4);margin-top:2px">
          #${o.id} · ⭐${fmtPrice(o.sell_price || 0)} · ${timeAgo(o.created_at)}
        </div>
      </div>
      <span style="font-size:.5625rem;padding:3px 8px;border-radius:6px;background:${statusColor[o.status] || '#888'}20;color:${statusColor[o.status] || '#888'};font-weight:600">${statusLabel[o.status] || o.status}</span>
    </div>
  `).join('')}</div>`;
}

async function renderAdminUsers(el) {
  el.innerHTML = '<div class="spin"></div>';
  const adminUsers = (await getAdminUsers().catch(() => ({}))).users || [];
  if (!adminUsers.length) {
    el.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--t4);font-size:.8125rem"><i class="bi bi-people" style="font-size:2rem;display:block;margin-bottom:8px;opacity:.3"></i>Нет пользователей</div>';
    return;
  }

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">${adminUsers.map(u => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--raised);border-radius:10px">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:.6875rem;font-weight:700;color:var(--t3);flex-shrink:0">${(u.username || 'U').charAt(0).toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.75rem;font-weight:600;color:var(--t1)">
          @${esc(u.username || 'unknown')} ${u.is_blocked ? '<span style="font-size:.5625rem;padding:2px 6px;border-radius:4px;background:rgba(239,68,68,.15);color:#ef4444;margin-left:4px">BAN</span>' : ''}
        </div>
        <div style="font-size:.625rem;color:var(--t4);margin-top:2px">${u.user_id} · ${u.total_orders || 0} заказов · ⭐${fmtPrice(u.stars_balance || 0)}</div>
      </div>
    </div>
  `).join('')}</div>`;
}

function renderAdminItems(el) {
  el.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--t4);font-size:.8125rem"><i class="bi bi-box-seam" style="font-size:2rem;display:block;margin-bottom:8px;opacity:.3"></i>Товары загружаются из LZT<br><span style="font-size:.625rem">Управление через LZT Market</span></div>';
}

async function renderAdminTickets(el) {
  el.innerHTML = '<div class="spin"></div>';
  const res = await fetch('/api/admin/tickets').catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  const tickets = data.tickets || [];

  if (!tickets.length) {
    el.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--t4);font-size:.8125rem"><i class="bi bi-chat-square-text" style="font-size:2rem;display:block;margin-bottom:8px;opacity:.3"></i>Нет тикетов</div>';
    return;
  }

  const statusColor = { open: '#3b82f6', closed: '#22c55e' };
  const statusLabel = { open: 'Открыт', closed: 'Закрыт' };

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">${tickets.map(t => `
    <div class="admin-ticket-row" data-tid="${t.id}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--raised);border-radius:10px;cursor:pointer">
      <div style="width:6px;height:6px;border-radius:50%;background:${statusColor[t.status] || '#888'};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.75rem;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.subject)}</div>
        <div style="font-size:.625rem;color:var(--t4);margin-top:2px">#${t.id} · User ${t.user_id} · ${timeAgo(t.updated_at)}</div>
      </div>
      <span style="font-size:.5625rem;padding:3px 8px;border-radius:6px;background:${statusColor[t.status] || '#888'}20;color:${statusColor[t.status] || '#888'};font-weight:600">${statusLabel[t.status] || t.status}</span>
    </div>
  `).join('')}</div>`;

  el.querySelectorAll('.admin-ticket-row').forEach(row => {
    row.addEventListener('click', () => {
      showAdminTicketChat(parseInt(row.dataset.tid));
    });
  });
}

async function showAdminTicketChat(ticketId) {
  openModal(`
    <div class="modal-bg" id="modal-bg">
      <div class="modal-panel" style="max-height:85vh;display:flex;flex-direction:column">
        <div class="modal-grip"></div>
        <div id="atchat-header" style="padding:12px 16px;border-bottom:1px solid var(--border)"></div>
        <div id="atchat-messages" style="flex:1;overflow-y:auto;padding:12px 16px"><div class="spin"></div></div>
        <div id="atchat-input" style="padding:10px 16px;border-top:1px solid var(--border)"></div>
      </div>
    </div>
  `);
  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { closeModal(); haptic(); }
  });

  try {
    const res = await fetch(`/api/tickets/${ticketId}`);
    const ticket = await res.json();
    if (!ticket || ticket.error) { toast('Тикет не найден'); closeModal(); return; }

    const statusColor = { open: '#3b82f6', closed: '#22c55e' };
    const statusLabel = { open: 'Открыт', closed: 'Закрыт' };

    document.getElementById('atchat-header').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:.8125rem;font-weight:700;color:var(--t1)">${esc(ticket.subject)}</div>
          <div style="font-size:.625rem;color:var(--t4)">#${ticket.id} · User ${ticket.user_id} · ${timeAgo(ticket.created_at)}</div>
        </div>
        <div style="display:flex;gap:4px">
          ${ticket.status === 'open' ? `<button id="atchat-close" style="padding:4px 10px;background:rgba(239,68,68,.15);border:none;border-radius:6px;color:#ef4444;font-size:.625rem;font-weight:600;cursor:pointer">Закрыть</button>` : ''}
          <span style="font-size:.5625rem;padding:3px 8px;border-radius:6px;background:${statusColor[ticket.status] || '#888'}20;color:${statusColor[ticket.status] || '#888'};font-weight:600">${statusLabel[ticket.status] || ticket.status}</span>
        </div>
      </div>`;

    document.getElementById('atchat-close')?.addEventListener('click', async () => {
      await fetch(`/api/tickets/${ticketId}/close`, { method: 'POST' });
      toast('Тикет закрыт');
      closeModal();
      renderAdminContent();
    });

    const msgs = ticket.messages || [];
    document.getElementById('atchat-messages').innerHTML = msgs.map(m => {
      const isAdmin = m.sender === 'admin';
      let attachHtml = '';
      if (m.attachments) {
        try {
          const imgs = JSON.parse(m.attachments);
          if (Array.isArray(imgs)) {
            attachHtml = `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">${imgs.map(src => `<img src="${src}" style="width:60px;height:60px;border-radius:6px;object-fit:cover;cursor:pointer" onclick="window.open(this.src)" />`).join('')}</div>`;
          }
        } catch {}
      }
      return `
        <div style="display:flex;${isAdmin ? 'justify-content:flex-end;' : ''}margin-bottom:8px">
          <div style="max-width:80%;padding:10px 12px;border-radius:12px;${isAdmin
            ? 'background:rgba(99,102,241,.15);border-bottom-right-radius:4px'
            : 'background:var(--bg2);border-bottom-left-radius:4px'}">
            <div style="font-size:.5625rem;color:var(--t4);margin-bottom:4px">${isAdmin ? '🛡️ Вы (админ)' : '👤 Пользователь'} · ${timeAgo(m.created_at)}</div>
            <div style="font-size:.75rem;color:var(--t1);line-height:1.5;word-break:break-word">${esc(m.message)}</div>
            ${attachHtml}
          </div>
        </div>`;
    }).join('');

    const mc = document.getElementById('atchat-messages');
    if (mc) mc.scrollTop = mc.scrollHeight;

    if (ticket.status !== 'closed') {
      document.getElementById('atchat-input').innerHTML = `
        <div style="display:flex;gap:6px">
          <input id="atchat-reply" type="text" placeholder="Ответ от поддержки..." style="flex:1;padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;color:var(--t1);font-size:.8125rem;box-sizing:border-box" />
          <button id="atchat-send" style="padding:10px 14px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;border-radius:10px;color:#fff;cursor:pointer"><i class="bi bi-send"></i></button>
        </div>`;
      document.getElementById('atchat-send')?.addEventListener('click', async () => {
        const reply = document.getElementById('atchat-reply')?.value?.trim();
        if (!reply) return;
        document.getElementById('atchat-send').disabled = true;
        await fetch(`/api/tickets/${ticketId}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: 'admin', message: reply }),
        });
        closeModal();
        showAdminTicketChat(ticketId);
      });
      document.getElementById('atchat-reply')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('atchat-send')?.click();
      });
    } else {
      document.getElementById('atchat-input').innerHTML = '<div style="text-align:center;font-size:.6875rem;color:var(--t4);padding:4px 0">Тикет закрыт</div>';
    }
  } catch {
    toast('Ошибка загрузки');
    closeModal();
  }
}

// ═══════════════════════════════════════
// Ticket System
// ═══════════════════════════════════════

async function showTicketsList() {
  const uid = tg?.initDataUnsafe?.user?.id || '';
  openModal(`
    <div class="modal-bg" id="modal-bg">
      <div class="modal-panel" style="max-height:85vh;display:flex;flex-direction:column">
        <div class="modal-grip"></div>
        <div style="padding:16px 16px 0;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:1rem;font-weight:700;color:var(--t1)">💬 Поддержка</div>
          <button id="ticket-create-btn" style="padding:6px 14px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;border-radius:8px;color:#fff;font-size:.6875rem;font-weight:600;cursor:pointer">+ Новый тикет</button>
        </div>
        <div id="tickets-body" style="flex:1;overflow-y:auto;padding:12px 16px">
          <div class="spin"></div>
        </div>
      </div>
    </div>
  `);
  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { closeModal(); haptic(); }
  });
  document.getElementById('ticket-create-btn')?.addEventListener('click', () => {
    closeModal();
    showCreateTicket();
  });

  // Load tickets
  try {
    const res = await fetch(`/api/tickets?user_id=${uid}`);
    const data = await res.json();
    const tickets = data.tickets || [];
    const body = document.getElementById('tickets-body');
    if (!body) return;

    if (!tickets.length) {
      body.innerHTML = `<div style="text-align:center;padding:32px 0;color:var(--t4)">
        <i class="bi bi-chat-square-text" style="font-size:2rem;display:block;margin-bottom:8px;opacity:.3"></i>
        <div style="font-size:.8125rem">Нет обращений</div>
        <div style="font-size:.6875rem;margin-top:4px">Нажмите «+ Новый тикет» чтобы создать</div>
      </div>`;
      return;
    }

    const statusColor = { open: '#3b82f6', closed: '#22c55e', pending: '#f59e0b' };
    const statusLabel = { open: 'Открыт', closed: 'Закрыт', pending: 'Ожидание' };

    body.innerHTML = tickets.map(t => `
      <div class="ticket-row" data-tid="${t.id}" style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg2);border-radius:10px;margin-bottom:6px;cursor:pointer">
        <div style="width:6px;height:6px;border-radius:50%;background:${statusColor[t.status] || '#888'};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.8125rem;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.subject)}</div>
          <div style="font-size:.625rem;color:var(--t4);margin-top:2px">#${t.id} · ${timeAgo(t.updated_at)}</div>
        </div>
        <span style="font-size:.5625rem;padding:3px 8px;border-radius:6px;background:${statusColor[t.status] || '#888'}20;color:${statusColor[t.status] || '#888'};font-weight:600">${statusLabel[t.status] || t.status}</span>
      </div>
    `).join('');

    body.querySelectorAll('.ticket-row').forEach(row => {
      row.addEventListener('click', () => {
        closeModal();
        showTicketChat(parseInt(row.dataset.tid));
      });
    });
  } catch {
    const body = document.getElementById('tickets-body');
    if (body) body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t4);font-size:.75rem">Ошибка загрузки</div>';
  }
}

function showCreateTicket() {
  let selectedPhotos = []; // {name, base64}[]

  openModal(`
    <div class="modal-bg" id="modal-bg">
      <div class="modal-panel">
        <div class="modal-grip"></div>
        <div style="padding:20px 16px">
          <div style="font-size:1rem;font-weight:700;color:var(--t1);margin-bottom:4px">📝 Новый тикет</div>
          <div style="font-size:.6875rem;color:var(--t4);margin-bottom:14px">Опишите проблему — ответим в Telegram</div>
          <input id="ticket-subject" type="text" placeholder="Тема обращения" maxlength="200" style="width:100%;padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;color:var(--t1);font-size:.8125rem;margin-bottom:8px;box-sizing:border-box" />
          <textarea id="ticket-msg" rows="4" placeholder="Опишите проблему подробнее..." style="width:100%;padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;color:var(--t1);font-size:.8125rem;resize:none;font-family:inherit;box-sizing:border-box"></textarea>
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
            <label id="ticket-photo-label" style="display:flex;align-items:center;gap:4px;padding:6px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;font-size:.6875rem;color:var(--t3);cursor:pointer">
              <i class="bi bi-image"></i> Фото (0/3)
              <input type="file" id="ticket-photos" accept="image/*" multiple style="display:none" />
            </label>
            <div id="ticket-photo-previews" style="display:flex;gap:4px"></div>
          </div>
          <button class="btn-cta cta-stars" id="ticket-submit" style="margin-top:12px">
            <i class="bi bi-send"></i> Отправить
          </button>
        </div>
      </div>
    </div>
  `);

  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { closeModal(); haptic(); }
  });

  // Photo upload
  document.getElementById('ticket-photos')?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3 - selectedPhotos.length);
    files.forEach(file => {
      if (selectedPhotos.length >= 3) return;
      const reader = new FileReader();
      reader.onload = () => {
        selectedPhotos.push({ name: file.name, base64: reader.result });
        updatePhotoUI();
      };
      reader.readAsDataURL(file);
    });
  });

  function updatePhotoUI() {
    const label = document.getElementById('ticket-photo-label');
    const previews = document.getElementById('ticket-photo-previews');
    if (label) label.querySelector('i + span') || (label.childNodes[1].textContent = ` Фото (${selectedPhotos.length}/3)`);
    if (label) label.innerHTML = `<i class="bi bi-image"></i> Фото (${selectedPhotos.length}/3)<input type="file" id="ticket-photos" accept="image/*" multiple style="display:none" />`;
    if (previews) {
      previews.innerHTML = selectedPhotos.map((p, i) => `
        <div style="position:relative;width:36px;height:36px;border-radius:6px;overflow:hidden;border:1px solid var(--border)">
          <img src="${p.base64}" style="width:100%;height:100%;object-fit:cover" />
          <div data-rm="${i}" style="position:absolute;top:-2px;right:-2px;width:14px;height:14px;background:#ef4444;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:8px;color:#fff">×</div>
        </div>
      `).join('');
      previews.querySelectorAll('[data-rm]').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedPhotos.splice(parseInt(btn.dataset.rm), 1);
          updatePhotoUI();
        });
      });
    }
    // Re-attach file input
    document.getElementById('ticket-photos')?.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []).slice(0, 3 - selectedPhotos.length);
      files.forEach(file => {
        if (selectedPhotos.length >= 3) return;
        const reader = new FileReader();
        reader.onload = () => {
          selectedPhotos.push({ name: file.name, base64: reader.result });
          updatePhotoUI();
        };
        reader.readAsDataURL(file);
      });
    });
  }

  // Submit
  document.getElementById('ticket-submit')?.addEventListener('click', async () => {
    const subject = document.getElementById('ticket-subject')?.value?.trim();
    const msg = document.getElementById('ticket-msg')?.value?.trim();
    if (!msg) { toast('Напишите сообщение'); return; }
    const btn = document.getElementById('ticket-submit');
    btn.disabled = true;
    btn.textContent = 'Отправка...';
    let success = false;
    try {
      const uid = tg?.initDataUnsafe?.user?.id || '';
      const attachments = selectedPhotos.length ? JSON.stringify(selectedPhotos.map(p => p.base64)) : null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: uid, subject: subject || 'Обращение', message: msg, attachments }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('Ошибка сервера');
      success = true;
    } catch (err) {
      toast('❌ ' + (err.name === 'AbortError' ? 'Таймаут' : (err.message || 'Ошибка')));
    } finally {
      if (success) {
        closeModal();
        toast('✅ Тикет создан!');
        try { haptic('success'); } catch {}
        setTimeout(() => showTicketsList(), 300);
      } else {
        const b = document.getElementById('ticket-submit');
        if (b) { b.disabled = false; b.innerHTML = '<i class="bi bi-send"></i> Отправить'; }
        try { haptic('error'); } catch {}
      }
    }
  });
}

async function showTicketChat(ticketId) {
  openModal(`
    <div class="modal-bg" id="modal-bg">
      <div class="modal-panel" style="max-height:85vh;display:flex;flex-direction:column">
        <div class="modal-grip"></div>
        <div id="tchat-header" style="padding:12px 16px;border-bottom:1px solid var(--border)"></div>
        <div id="tchat-messages" style="flex:1;overflow-y:auto;padding:12px 16px"><div class="spin"></div></div>
        <div id="tchat-input" style="padding:10px 16px;border-top:1px solid var(--border)"></div>
      </div>
    </div>
  `);
  document.getElementById('modal-bg')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) { closeModal(); haptic(); }
  });

  try {
    const res = await fetch(`/api/tickets/${ticketId}`);
    const ticket = await res.json();
    if (!ticket || ticket.error) { toast('Тикет не найден'); closeModal(); return; }

    const statusColor = { open: '#3b82f6', closed: '#22c55e' };
    const statusLabel = { open: 'Открыт', closed: 'Закрыт' };

    // Header
    document.getElementById('tchat-header').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:.8125rem;font-weight:700;color:var(--t1)">${esc(ticket.subject)}</div>
          <div style="font-size:.625rem;color:var(--t4)">#${ticket.id} · ${timeAgo(ticket.created_at)}</div>
        </div>
        <span style="font-size:.5625rem;padding:3px 8px;border-radius:6px;background:${statusColor[ticket.status] || '#888'}20;color:${statusColor[ticket.status] || '#888'};font-weight:600">${statusLabel[ticket.status] || ticket.status}</span>
      </div>`;

    // Messages — chat bubbles
    const msgs = ticket.messages || [];
    document.getElementById('tchat-messages').innerHTML = msgs.map(m => {
      const isAdmin = m.sender === 'admin';
      let attachHtml = '';
      if (m.attachments) {
        try {
          const imgs = JSON.parse(m.attachments);
          if (Array.isArray(imgs)) {
            attachHtml = `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">${imgs.map(src => `<img src="${src}" style="width:60px;height:60px;border-radius:6px;object-fit:cover;cursor:pointer" onclick="window.open(this.src)" />`).join('')}</div>`;
          }
        } catch {}
      }
      return `
        <div style="display:flex;${isAdmin ? '' : 'justify-content:flex-end;'}margin-bottom:8px">
          <div style="max-width:80%;padding:10px 12px;border-radius:12px;${isAdmin
            ? 'background:var(--bg2);border-bottom-left-radius:4px'
            : 'background:rgba(99,102,241,.15);border-bottom-right-radius:4px'}">
            <div style="font-size:.5625rem;color:var(--t4);margin-bottom:4px">${isAdmin ? '🛡️ Поддержка' : 'Вы'} · ${timeAgo(m.created_at)}</div>
            <div style="font-size:.75rem;color:var(--t1);line-height:1.5;word-break:break-word">${esc(m.message)}</div>
            ${attachHtml}
          </div>
        </div>`;
    }).join('');

    // Scroll to bottom
    const msgContainer = document.getElementById('tchat-messages');
    if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;

    // Input
    if (ticket.status === 'closed') {
      document.getElementById('tchat-input').innerHTML = `
        <div style="text-align:center;font-size:.6875rem;color:var(--t4);padding:4px 0">Тикет закрыт</div>`;
    } else {
      document.getElementById('tchat-input').innerHTML = `
        <div style="display:flex;gap:6px">
          <input id="tchat-reply" type="text" placeholder="Сообщение..." style="flex:1;padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;color:var(--t1);font-size:.8125rem;box-sizing:border-box" />
          <button id="tchat-send" style="padding:10px 14px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;border-radius:10px;color:#fff;cursor:pointer">
            <i class="bi bi-send"></i>
          </button>
        </div>`;
      document.getElementById('tchat-send')?.addEventListener('click', async () => {
        const reply = document.getElementById('tchat-reply')?.value?.trim();
        if (!reply) return;
        const btn = document.getElementById('tchat-send');
        btn.disabled = true;
        try {
          await fetch(`/api/tickets/${ticketId}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender: 'user', message: reply }),
          });
          closeModal();
          showTicketChat(ticketId);
        } catch {
          btn.disabled = false;
          toast('Ошибка отправки');
        }
      });
      // Enter to send
      document.getElementById('tchat-reply')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('tchat-send')?.click();
      });
    }
  } catch {
    toast('Ошибка загрузки тикета');
    closeModal();
  }
}

// ═══════════════════════════════════════
// Profile
// ═══════════════════════════════════════

async function renderProfile() {
  const container = document.getElementById('profile-container');
  let tgUser = tg?.initDataUnsafe?.user;

  // Fallback: get user info from API
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
  const lastName = tgUser?.last_name || '';
  const fullName = lastName ? `${firstName} ${lastName}` : firstName;
  const username = tgUser?.username || '';
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

  // Get orders count
  let ordersCount = 0;
  try {
    const orders = await getMyOrders();
    if (Array.isArray(orders)) ordersCount = orders.length;
    else if (orders?.orders) ordersCount = orders.orders.length;
  } catch { /* ignore */ }

  container.innerHTML = `
    <div style="padding:8px 0 24px">

      <!-- User Card -->
      <div style="background:var(--raised);border-radius:16px;padding:24px 16px 20px;text-align:center;margin-bottom:12px;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:80px;background:linear-gradient(135deg,rgba(99,102,241,.15),rgba(168,85,247,.1));pointer-events:none"></div>

        <div style="width:72px;height:72px;border-radius:50%;margin:0 auto 12px;position:relative;background:linear-gradient(135deg,#6366f1,#a855f7);padding:3px">
          <div style="width:100%;height:100%;border-radius:50%;overflow:hidden;background:var(--bg1);display:flex;align-items:center;justify-content:center">
            ${photoUrl
              ? `<img src="${esc(photoUrl)}" alt="" style="width:100%;height:100%;object-fit:cover" />`
              : `<span style="font-size:1.5rem;font-weight:800;color:var(--t2)">${initial}</span>`
            }
          </div>
        </div>

        <div style="font-size:1.0625rem;font-weight:700;color:var(--t1);margin-bottom:2px">${esc(fullName)}</div>
        ${username ? `<div style="font-size:.75rem;color:var(--t3);margin-bottom:8px">@${esc(username)}</div>` : ''}

        <!-- Stats Row -->
        <div style="display:flex;justify-content:center;gap:24px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <div style="text-align:center">
            <div style="font-size:1.125rem;font-weight:800;color:var(--accent)">⭐ ${fmtPrice(starsBalance)}</div>
            <div style="font-size:.625rem;color:var(--t4);margin-top:2px">Баланс</div>
          </div>
          <div style="width:1px;background:var(--border)"></div>
          <div style="text-align:center">
            <div style="font-size:1.125rem;font-weight:800;color:var(--t1)">${ordersCount}</div>
            <div style="font-size:.625rem;color:var(--t4);margin-top:2px">Покупок</div>
          </div>
          <div style="width:1px;background:var(--border)"></div>
          <div style="text-align:center">
            <div style="font-size:1.125rem;font-weight:800;color:var(--t1)">${userId}</div>
            <div style="font-size:.625rem;color:var(--t4);margin-top:2px">ID</div>
          </div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <button id="prof-topup" style="display:flex;align-items:center;justify-content:center;gap:6px;padding:12px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;border-radius:12px;color:#fff;font-size:.8125rem;font-weight:600;cursor:pointer">
          <i class="bi bi-plus-circle"></i> Пополнить
        </button>
        <button id="prof-orders" style="display:flex;align-items:center;justify-content:center;gap:6px;padding:12px;background:var(--raised);border:1px solid var(--border);border-radius:12px;color:var(--t1);font-size:.8125rem;font-weight:600;cursor:pointer">
          <i class="bi bi-bag-check"></i> Мои заказы
        </button>
      </div>

      <!-- Menu -->
      <div style="background:var(--raised);border-radius:14px;overflow:hidden">
        <div class="prof-row" id="prof-copy-id" style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;border-bottom:1px solid var(--border)">
          <div style="width:34px;height:34px;border-radius:10px;background:rgba(99,102,241,.12);display:flex;align-items:center;justify-content:center"><i class="bi bi-copy" style="color:#818cf8;font-size:.875rem"></i></div>
          <div style="flex:1"><div style="font-size:.8125rem;font-weight:600;color:var(--t1)">Скопировать ID</div><div style="font-size:.6875rem;color:var(--t4)">${userId}</div></div>
          <i class="bi bi-chevron-right" style="color:var(--t4);font-size:.75rem"></i>
        </div>
        <div class="prof-row" id="prof-support" style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;border-bottom:1px solid var(--border)">
          <div style="width:34px;height:34px;border-radius:10px;background:rgba(34,197,94,.12);display:flex;align-items:center;justify-content:center"><i class="bi bi-headset" style="color:#22c55e;font-size:.875rem"></i></div>
          <div style="flex:1"><div style="font-size:.8125rem;font-weight:600;color:var(--t1)">Поддержка</div><div style="font-size:.6875rem;color:var(--t4)">Помощь и вопросы</div></div>
          <i class="bi bi-chevron-right" style="color:var(--t4);font-size:.75rem"></i>
        </div>
        <div class="prof-row" id="prof-rules" style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer">
          <div style="width:34px;height:34px;border-radius:10px;background:rgba(251,191,36,.12);display:flex;align-items:center;justify-content:center"><i class="bi bi-shield-check" style="color:#fbbf24;font-size:.875rem"></i></div>
          <div style="flex:1"><div style="font-size:.8125rem;font-weight:600;color:var(--t1)">Правила и гарантии</div><div style="font-size:.6875rem;color:var(--t4)">Условия использования</div></div>
          <i class="bi bi-chevron-right" style="color:var(--t4);font-size:.75rem"></i>
        </div>
      </div>

      <div style="text-align:center;padding:20px 0 0;font-size:.625rem;color:var(--t4);letter-spacing:.5px">VAULT · v1.0.0</div>
    </div>
  `;

  // === Event Handlers ===

  // Top Up — open Telegram Stars payment
  document.getElementById('prof-topup')?.addEventListener('click', () => {
    haptic('medium');
    // Navigate to catalog to buy stars
    toast('⭐ Пополнение баланса — через покупку Stars в боте');
  });

  // My Orders — switch to orders tab
  document.getElementById('prof-orders')?.addEventListener('click', () => {
    haptic('light');
    navigateTo('orders');
  });

  // Copy ID
  document.getElementById('prof-copy-id')?.addEventListener('click', () => {
    haptic('medium');
    navigator.clipboard?.writeText(String(userId))
      .then(() => toast('📋 ID скопирован!'))
      .catch(() => toast('ID: ' + userId));
  });

  // Support — ticket system
  document.getElementById('prof-support')?.addEventListener('click', () => {
    haptic('light');
    showTicketsList();
  });

  // Rules
  document.getElementById('prof-rules')?.addEventListener('click', () => {
    haptic('light');
    openModal(`
      <div class="modal-bg" id="modal-bg">
        <div class="modal-panel">
          <div class="modal-grip"></div>
          <div style="padding:20px 16px">
            <div style="font-size:1rem;font-weight:700;color:var(--t1);margin-bottom:14px">📋 Правила и гарантии</div>
            <div style="font-size:.75rem;color:var(--t3);line-height:1.7">
              <p style="margin-bottom:10px"><b style="color:var(--t1)">1. Гарантия</b><br>На все аккаунты действует гарантия замены в течение 24 часов после покупки при условии невалидности данных.</p>
              <p style="margin-bottom:10px"><b style="color:var(--t1)">2. Возврат</b><br>Возврат Stars возможен, если аккаунт не был получен или оказался невалидным.</p>
              <p style="margin-bottom:10px"><b style="color:var(--t1)">3. Использование</b><br>Покупатель несёт ответственность за использование аккаунта согласно правилам площадки.</p>
              <p><b style="color:var(--t1)">4. Поддержка</b><br>По всем вопросам обращайтесь в поддержку через бота.</p>
            </div>
          </div>
        </div>
      </div>
    `);
    document.getElementById('modal-bg')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) { closeModal(); haptic(); }
    });
  });

  // Hover effects
  container.querySelectorAll('.prof-row, #prof-topup, #prof-orders').forEach(el => {
    el.addEventListener('touchstart', () => el.style.opacity = '.7', { passive: true });
    el.addEventListener('touchend', () => el.style.opacity = '1', { passive: true });
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
