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
  if (tg) { tg.ready(); tg.expand(); tg.enableClosingConfirmation(); }
  // Check admin status from server
  try {
    const res = await fetch('/api/me');
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

function navigateTo(page) {
  if (!page) return;
  currentPage = page;
  haptic();
  document.querySelectorAll('.bnav-tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  ({ catalog: renderCatalog, orders: renderOrders, profile: renderProfile, admin: renderAdmin })[page]?.();
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

async function loadItems() {
  const container = document.getElementById('items-container');
  const titleEl = document.getElementById('catalog-title');
  const countEl = document.getElementById('catalog-count');
  const catName = CATEGORIES.find(c => c.slug === selectedCategory)?.name || selectedCategory;
  titleEl.textContent = searchQuery ? `Поиск: ${searchQuery}` : catName;

  // Skeletons
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
  function stripBB(str) {
    if (!str) return '';
    return str
      .replace(/\[URL[^\]]*\][^\[]*\[\/URL\]/gi, '')
      .replace(/\[IMG[^\]]*\][^\[]*\[\/IMG\]/gi, '')
      .replace(/\[tooltip=[^\]]*\]([^\[]*)\[\/tooltip\]/gi, '$1')
      .replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi, '')
      .replace(/\[\/?[A-Z][^\]]*\]/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 80);
  }

  container.innerHTML = `<div class="items-grid">${items.map(item => {
    const title = item.title || 'Аккаунт';
    const price = item.price || 0;
    const desc = stripBB(item.description || '');
    const tags = desc ? desc.split(/[,·|]/).map(t => t.trim()).filter(t => t.length > 2).slice(0, 2) : [];

    return `
      <div class="icard">
        <div class="icard-banner" style="background:${cat?.gradient || 'var(--raised-2)'}">
          <div class="icard-banner-icon">${getCategoryIcon(selectedCategory, 20)}</div>
          <span class="icard-banner-label">${esc(cat?.name || '')}</span>
        </div>
        <div class="icard-body">
          <div class="icard-title">${esc(title)}</div>
          ${tags.length ? `<div class="icard-tags">${tags.map((t, i) => `<span class="icard-tag ${i === 0 ? 'tag-green' : 'tag-blue'}">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="icard-bottom">
            <div class="icard-price">${fmtPrice(price)}<small>₽</small></div>
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

  container.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      haptic('medium');
      showPayment(btn.dataset.buy, btn.dataset.price, btn.dataset.name);
    });
  });
}

function renderCatalog() { renderCategories(); loadItems(); }

// ═══════════════════════════════════════
// Payment Modal
// ═══════════════════════════════════════

function showPayment(itemId, price, title) {
  const root = document.getElementById('modal-root');
  const starsPrice = Math.ceil(price / 1.6);
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
          <div class="pay-amount-convert">${fmtPrice(price)} ₽</div>
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
        <div class="pay-detail">
          <span class="pay-detail-label">Курс</span>
          <span class="pay-detail-value">1 ⭐ = 1.6 ₽</span>
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
    btn.disabled = true;
    btn.innerHTML = '<div class="spin" style="width:16px;height:16px;margin:0"></div> Покупаем...';
    haptic('heavy');

    try {
      const result = await purchaseItem(itemId);
      root.innerHTML = '';
      if (result.status === 'completed') {
        toast('Покупка успешна!');
        // Show account data
        const ad = result.account_data || {};
        const dataLines = Object.entries(ad)
          .filter(([k]) => !['item_id','title'].includes(k))
          .map(([k,v]) => typeof v === 'object' ? `${k}: ${JSON.stringify(v)}` : `${k}: ${v}`)
          .join('\n');
        alert('Данные аккаунта:\n\n' + dataLines);
      } else {
        toast('Статус: ' + (result.status || 'unknown'));
      }
    } catch (err) {
      root.innerHTML = '';
      toast('Ошибка: ' + err.message);
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
      <div class="ocard">
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
      </div>`;
  }).join('');

  container.querySelectorAll('.ocard').forEach((c, i) => {
    c.style.opacity = '0';
    setTimeout(() => { c.style.transition = 'opacity .3s'; c.style.opacity = '1'; }, i * 50);
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

  // Stats
  statsEl.innerHTML = `
    <div class="stats-grid">
      <div class="scard sc-green"><div class="scard-label">Профит</div><div class="scard-value">${fmtPrice(s.total_profit)} ₽</div></div>
      <div class="scard sc-blue"><div class="scard-label">Оборот</div><div class="scard-value">${fmtPrice(s.total_revenue)} ₽</div></div>
    </div>
    <div class="stats-grid">
      <div class="scard sc-amber"><div class="scard-label">Заказы</div><div class="scard-value">${s.completed_orders}/${s.total_orders}</div></div>
      <div class="scard"><div class="scard-label">Пользователи</div><div class="scard-value">${s.total_users}</div></div>
    </div>
    <div class="stats-grid">
      <div class="scard sc-green"><div class="scard-label">Баланс LZT</div><div class="scard-value">$${fmtPrice(s.lzt_balance)}</div></div>
      <div class="scard sc-amber"><div class="scard-label">Сегодня</div><div class="scard-value">${s.today_orders} · ${fmtPrice(s.today_profit)}₽</div></div>
    </div>`;

  // Quick actions
  actionsEl.innerHTML = `
    <button class="admin-act act-blue" data-action="add-item"><i class="bi bi-plus-circle"></i>Добавить товар</button>
    <button class="admin-act act-green" data-action="sync"><i class="bi bi-arrow-repeat"></i>Синхронизация</button>
    <button class="admin-act act-amber" data-action="export"><i class="bi bi-download"></i>Экспорт</button>
    <button class="admin-act act-red" data-action="cache"><i class="bi bi-trash3"></i>Очистить кэш</button>
  `;

  actionsEl.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      haptic('medium');
      const labels = { 'add-item': '➕ Открываю форму добавления...', sync: '🔄 Синхронизация запущена', export: '📦 Экспорт данных...', cache: '🗑️ Кэш очищен!' };
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

function renderProfile() {
  const container = document.getElementById('profile-container');
  const tgUser = tg?.initDataUnsafe?.user;
  const firstName = tgUser?.first_name || 'User';
  const username = tgUser?.username || 'unknown';
  const userId = tgUser?.id || '—';
  const photoUrl = tgUser?.photo_url || null;
  const initial = firstName.charAt(0).toUpperCase();

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

async function init() {
  await initTelegram();
  document.querySelectorAll('.bnav-tab').forEach(t => t.addEventListener('click', () => navigateTo(t.dataset.page)));
  let timer;
  document.getElementById('catalog-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchQuery = e.target.value.trim(); loadItems(); }, 400);
  });
  initFilters();
  navigateTo('catalog');
  loadBalance();
}

async function loadBalance() {
  const pill = document.getElementById('balance-pill');
  const amount = document.getElementById('balance-amount');
  const icon = document.getElementById('balance-icon');
  if (!pill || !amount || !icon) return;

  try {
    if (isAdmin) {
      const res = await fetch('/api/balance');
      if (!res.ok) return;
      const data = await res.json();
      icon.textContent = '💲';
      amount.textContent = (parseFloat(data.balance) || 0).toFixed(2);
    } else {
      const res = await fetch('/api/user/balance');
      if (!res.ok) return;
      const data = await res.json();
      icon.textContent = '⭐';
      amount.textContent = data.stars_balance || 0;
    }
    pill.style.display = '';
  } catch { /* ignore */ }
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
