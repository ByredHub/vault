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
// Demo Data
// ═══════════════════════════════════════

const USE_DEMO = false;

const DEMO_ITEMS = {
  steam: [
    { item_id: 1001, title: 'Steam · 247 игр · Level 56 · CS2 Prime', price: 2450, description: 'Инвентарь CS2, PUBG, чистый аккаунт' },
    { item_id: 1002, title: 'Steam · 89 игр · GTA V · RDR2 · Rust', price: 890, description: 'Без VAC бана, чистый акк' },
    { item_id: 1003, title: 'Steam · 15 игр · Level 12 · Faceit Lvl 7', price: 350, description: 'CS2, Faceit подключен' },
    { item_id: 1004, title: 'Steam · 420 игр · Level 100+ · Коллекция', price: 5200, description: 'Редкие значки, инвентарь 50000₽' },
    { item_id: 1005, title: 'Steam · 32 игры · Rust 3000h · ARK', price: 1100, description: 'Большой наигрыш в Rust' },
    { item_id: 1006, title: 'Steam · 5 игр · CS2 · Faceit Lvl 10', price: 4800, description: 'Faceit Level 10, 2.1 K/D' },
  ],
  fortnite: [
    { item_id: 2001, title: 'Fortnite · 156 скинов · OG аккаунт 2017', price: 3200, description: 'Renegade Raider, Black Knight' },
    { item_id: 2002, title: 'Fortnite · 78 скинов · Galaxy · STW', price: 1500, description: 'Galaxy Skin, Save the World доступ' },
    { item_id: 2003, title: 'Fortnite · 45 скинов · 2400 V-Bucks', price: 650, description: 'Season 5+, Battle Pass' },
    { item_id: 2004, title: 'Fortnite · 200+ скинов · Full Stack', price: 5500, description: 'Travis Scott, все BP с Season 2' },
  ],
  mihoyo: [
    { item_id: 3001, title: 'Genshin · AR 58 · Нахида · Ху Тао · Аято', price: 2800, description: '12 пятизвёздочных персонажей' },
    { item_id: 3002, title: 'Genshin · AR 55 · Райдэн · Кадзуха', price: 1900, description: 'Все архонты, хорошие артефакты' },
    { item_id: 3003, title: 'Genshin · AR 45 · Стартер Аято + Мона', price: 450, description: 'Хороший старт, много примогемов' },
    { item_id: 3004, title: 'Honkai: Star Rail · TL 65 · Кафка · Цзин Юань', price: 2100, description: 'Топ персонажи, все светоконусы' },
  ],
  riot: [
    { item_id: 4001, title: 'Valorant · Diamond 3 · 45 скинов · All agents', price: 3400, description: 'Champions Vandal, Protocol Phantom' },
    { item_id: 4002, title: 'Valorant · Gold 2 · 20 скинов · Full agents', price: 800, description: 'Все агенты, хорошие скины' },
    { item_id: 4003, title: 'LoL · Diamond · 150 чемпионов · 200 скинов', price: 2200, description: 'Все чемпионы, редкие скины' },
    { item_id: 4004, title: 'Valorant · Immortal · 80 скинов · Stacked', price: 8500, description: 'Иммортал, топ коллекция' },
  ],
  telegram: [
    { item_id: 5001, title: 'Telegram Premium · 12 месяцев подписка', price: 1200, description: 'Годовая Премиум подписка' },
    { item_id: 5002, title: 'Telegram · Старый аккаунт 2017 · Чистый', price: 350, description: 'Без ограничений, без спам-бана' },
    { item_id: 5003, title: 'Telegram · Аккаунт с 5000 подписчиков', price: 2800, description: 'Канал с подписчиками' },
  ],
  discord: [
    { item_id: 6001, title: 'Discord Nitro · 12 месяцев · 2 буста', price: 1800, description: 'Годовая Nitro подписка + бусты' },
    { item_id: 6002, title: 'Discord · 2018 · Early Supporter Badge', price: 600, description: 'OG аккаунт с бейджем' },
    { item_id: 6003, title: 'Discord · HypeSquad · Rare Badge Collection', price: 900, description: 'Редкие бейджи, чистый аккаунт' },
  ],
  spotify: [
    { item_id: 7001, title: 'Spotify Premium · 12 месяцев · Семейный', price: 800, description: 'Family план на год' },
    { item_id: 7002, title: 'Spotify Premium · Индивидуальный · 6 мес', price: 400, description: 'Полгода премиума' },
  ],
  instagram: [
    { item_id: 8001, title: 'Instagram · 10K подписчиков · Автор', price: 3500, description: 'Живые подписчики, активность' },
    { item_id: 8002, title: 'Instagram · Чистый аккаунт · 2019', price: 250, description: 'Старый аккаунт без банов' },
  ],
  tiktok: [
    { item_id: 9001, title: 'TikTok · 50K подписчиков · Монетизация', price: 5000, description: 'Монетизация включена' },
    { item_id: 9002, title: 'TikTok · 5K подписчиков · Живой акк', price: 900, description: 'Активный аккаунт' },
  ],
  vpn: [
    { item_id: 10001, title: 'NordVPN · 2 года подписка · Premium', price: 600, description: '730 дней подписки' },
    { item_id: 10002, title: 'Surfshark · 1 год · Unlimited devices', price: 400, description: 'Безлимит устройств' },
  ],
};

const DEMO_ORDERS = [
  { id: 147, item_title: 'Steam · 247 игр · Level 56 · CS2', sell_price: 2450, status: 'completed', created_at: Math.floor(Date.now()/1000) - 3600 },
  { id: 146, item_title: 'Fortnite · 156 скинов · OG акк', sell_price: 3200, status: 'completed', created_at: Math.floor(Date.now()/1000) - 86400 },
  { id: 145, item_title: 'Valorant · Diamond 3 · 45 скинов', sell_price: 3400, status: 'awaiting_payment', created_at: Math.floor(Date.now()/1000) - 7200 },
  { id: 144, item_title: 'Genshin · AR 58 · Нахида', sell_price: 2800, status: 'error', created_at: Math.floor(Date.now()/1000) - 172800 },
  { id: 143, item_title: 'Discord Nitro · 12 мес', sell_price: 1800, status: 'completed', created_at: Math.floor(Date.now()/1000) - 259200 },
];

const DEMO_STATS = {
  total_profit: 48500, total_revenue: 312000, completed_orders: 156, total_orders: 189,
  total_users: 1247, lzt_balance: 2100, today_orders: 12, today_profit: 3400,
};

// ═══════════════════════════════════════
// Telegram
// ═══════════════════════════════════════

const tg = window.Telegram?.WebApp;
let isAdmin = true;

function initTelegram() {
  if (tg) { tg.ready(); tg.expand(); tg.enableClosingConfirmation(); }
  document.getElementById('admin-tab').style.display = '';
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
  if (USE_DEMO) {
    items = DEMO_ITEMS[selectedCategory] || [];
    if (searchQuery) items = items.filter(i => i.title.toLowerCase().includes(searchQuery.toLowerCase()));
  } else {
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

  const orders = USE_DEMO ? DEMO_ORDERS : (await getMyOrders().catch(() => ({}))).orders || [];

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

const DEMO_ADMIN_ORDERS = [
  { id: 147, item_title: 'Steam · 247 игр', user_id: 123456, username: 'ivan_gamer', sell_price: 2450, profit: 367, status: 'completed', created_at: Math.floor(Date.now()/1000) - 1800 },
  { id: 146, item_title: 'Fortnite · 156 скинов', user_id: 789012, username: 'pro_player', sell_price: 3200, profit: 480, status: 'completed', created_at: Math.floor(Date.now()/1000) - 7200 },
  { id: 145, item_title: 'Valorant · Diamond 3', user_id: 345678, username: 'dark_knight', sell_price: 3400, profit: 510, status: 'paid', created_at: Math.floor(Date.now()/1000) - 3600 },
  { id: 144, item_title: 'Genshin · AR 58', user_id: 901234, username: 'anime_fan', sell_price: 2800, profit: 420, status: 'pending', created_at: Math.floor(Date.now()/1000) - 86400 },
  { id: 143, item_title: 'Discord Nitro · 12 мес', user_id: 567890, username: 'nitro_guy', sell_price: 1800, profit: 270, status: 'error', created_at: Math.floor(Date.now()/1000) - 172800 },
];

const DEMO_ADMIN_USERS = [
  { user_id: 123456, username: 'ivan_gamer', total_orders: 23, total_spent: 45000, last_active: Math.floor(Date.now()/1000) - 600, is_blocked: false },
  { user_id: 789012, username: 'pro_player', total_orders: 15, total_spent: 28000, last_active: Math.floor(Date.now()/1000) - 3600, is_blocked: false },
  { user_id: 345678, username: 'dark_knight', total_orders: 8, total_spent: 12500, last_active: Math.floor(Date.now()/1000) - 86400, is_blocked: false },
  { user_id: 901234, username: 'anime_fan', total_orders: 5, total_spent: 7800, last_active: Math.floor(Date.now()/1000) - 259200, is_blocked: true },
];

async function renderAdmin() {
  const statsEl = document.getElementById('admin-stats-container');
  const actionsEl = document.getElementById('admin-actions');
  const contentEl = document.getElementById('admin-content');
  const s = USE_DEMO ? DEMO_STATS : await getAdminStats().catch(() => ({}));

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

function renderAdminOrders(el) {
  const statusMap = { completed: 'badge-done', paid: 'badge-pay', pending: 'badge-wait', error: 'badge-err' };
  const statusLabel = { completed: 'Готово', paid: 'Оплачен', pending: 'Ожидание', error: 'Ошибка' };

  el.innerHTML = DEMO_ADMIN_ORDERS.map(o => `
    <div class="arow">
      <span class="arow-id">#${o.id}</span>
      <div class="arow-body">
        <div class="arow-name">${esc(o.item_title)}</div>
        <div class="arow-meta">@${esc(o.username)} · ${fmtPrice(o.sell_price)}₽ · +${fmtPrice(o.profit)}₽ · ${timeAgo(o.created_at)}</div>
      </div>
      <span class="badge ${statusMap[o.status] || 'badge-wait'}">${statusLabel[o.status] || o.status}</span>
      <div class="arow-actions">
        ${o.status === 'paid' ? `<button class="arow-btn ab-green" data-complete="${o.id}" title="Выдать"><i class="bi bi-check-lg"></i></button>` : ''}
        ${o.status !== 'completed' && o.status !== 'error' ? `<button class="arow-btn ab-red" data-cancel="${o.id}" title="Отменить"><i class="bi bi-x-lg"></i></button>` : ''}
        <button class="arow-btn ab-blue" data-copy-order="${o.id}" title="Копировать ID"><i class="bi bi-clipboard"></i></button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-complete]').forEach(btn => {
    btn.addEventListener('click', () => { haptic('heavy'); toast(`✅ Заказ #${btn.dataset.complete} выдан!`); });
  });
  el.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', () => { haptic('heavy'); toast(`❌ Заказ #${btn.dataset.cancel} отменён`); });
  });
  el.querySelectorAll('[data-copy-order]').forEach(btn => {
    btn.addEventListener('click', () => { navigator.clipboard?.writeText(btn.dataset.copyOrder); haptic(); toast('📋 ID скопирован'); });
  });
}

function renderAdminUsers(el) {
  el.innerHTML = DEMO_ADMIN_USERS.map(u => `
    <div class="arow">
      <span class="arow-id">${u.user_id}</span>
      <div class="arow-body">
        <div class="arow-name">@${esc(u.username)} ${u.is_blocked ? '<span class="badge badge-err">BAN</span>' : ''}</div>
        <div class="arow-meta">Заказов: ${u.total_orders} · ${fmtPrice(u.total_spent)}₽ · ${timeAgo(u.last_active)}</div>
      </div>
      <div class="arow-actions">
        <button class="arow-btn ab-blue" data-msg-user="${u.user_id}" title="Написать"><i class="bi bi-chat-dots"></i></button>
        <button class="arow-btn ${u.is_blocked ? 'ab-green' : 'ab-red'}" data-toggle-ban="${u.user_id}" data-blocked="${u.is_blocked}" title="${u.is_blocked ? 'Разбанить' : 'Забанить'}">
          <i class="bi ${u.is_blocked ? 'bi-unlock' : 'bi-lock'}"></i>
        </button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-toggle-ban]').forEach(btn => {
    btn.addEventListener('click', () => {
      const blocked = btn.dataset.blocked === 'true';
      haptic('heavy');
      toast(blocked ? `🔓 Пользователь ${btn.dataset.toggleBan} разбанен` : `🔒 Пользователь ${btn.dataset.toggleBan} забанен`);
    });
  });
  el.querySelectorAll('[data-msg-user]').forEach(btn => {
    btn.addEventListener('click', () => { haptic(); toast(`💬 Открываю чат с ${btn.dataset.msgUser}...`); });
  });
}

function renderAdminItems(el) {
  // Flatten all demo items
  const allItems = [];
  for (const [cat, items] of Object.entries(DEMO_ITEMS)) {
    items.forEach(item => allItems.push({ ...item, category: cat }));
  }

  el.innerHTML = allItems.slice(0, 15).map(item => {
    const catName = CATEGORIES.find(c => c.slug === item.category)?.name || item.category;
    return `
      <div class="arow">
        <span class="arow-id">${item.item_id}</span>
        <div class="arow-body">
          <div class="arow-name">${esc(item.title)}</div>
          <div class="arow-meta">${esc(catName)} · ${fmtPrice(item.price)}₽</div>
        </div>
        <div class="arow-actions">
          <button class="arow-btn ab-amber" data-edit-item="${item.item_id}" title="Редактировать"><i class="bi bi-pencil"></i></button>
          <button class="arow-btn ab-red" data-del-item="${item.item_id}" title="Удалить"><i class="bi bi-trash3"></i></button>
        </div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-edit-item]').forEach(btn => {
    btn.addEventListener('click', () => { haptic(); toast(`✏️ Редактирование #${btn.dataset.editItem}...`); });
  });
  el.querySelectorAll('[data-del-item]').forEach(btn => {
    btn.addEventListener('click', () => { haptic('heavy'); toast(`🗑️ Товар #${btn.dataset.delItem} удалён (демо)`); });
  });
}

// ═══════════════════════════════════════
// Profile
// ═══════════════════════════════════════

const DEMO_PROFILE = {
  user_id: 487291053,
  first_name: 'Иса',
  username: 'isa_dev',
  photo_url: null,
  total_orders: 23,
  total_spent: 38500,
  member_since: '2024-08-15',
  referral_code: 'LZT-7K2M9X',
  referral_count: 7,
  is_premium: true,
};

function renderProfile() {
  const container = document.getElementById('profile-container');
  const p = DEMO_PROFILE;

  // Try to get data from Telegram
  const tgUser = tg?.initDataUnsafe?.user;
  const firstName = tgUser?.first_name || p.first_name;
  const username = tgUser?.username || p.username;
  const userId = tgUser?.id || p.user_id;
  const photoUrl = tgUser?.photo_url || p.photo_url;
  const initial = firstName.charAt(0).toUpperCase();

  const memberDate = new Date(p.member_since);
  const memberStr = memberDate.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' });

  const menuItems = [
    { icon: 'bi-headset', color: 'pmi-blue', label: 'Поддержка', desc: 'Помощь и вопросы' },
    { icon: 'bi-gift', color: 'pmi-purple', label: 'Реферальная программа', desc: `${p.referral_count} приглашённых` },
    { icon: 'bi-bell', color: 'pmi-amber', label: 'Уведомления', desc: 'Статус заказов, акции' },
    { icon: 'bi-palette', color: 'pmi-green', label: 'Внешний вид', desc: 'Тема, язык' },
    { icon: 'bi-shield-check', color: 'pmi-blue', label: 'Правила и гарантии', desc: 'Условия использования' },
    { icon: 'bi-box-arrow-right', color: 'pmi-red', label: 'Выйти', desc: 'Закрыть приложение' },
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
      <div class="profile-status ${p.is_premium ? 'ps-premium' : 'ps-active'}">
        <i class="bi ${p.is_premium ? 'bi-gem' : 'bi-check-circle-fill'}"></i>
        ${p.is_premium ? 'Premium' : 'Активен'}
      </div>
    </div>

    <div class="profile-stats">
      <div class="profile-stat">
        <div class="profile-stat-val">${p.total_orders}</div>
        <div class="profile-stat-label">Заказов</div>
      </div>
      <div class="profile-stat">
        <div class="profile-stat-val">${fmtPrice(p.total_spent)}₽</div>
        <div class="profile-stat-label">Потрачено</div>
      </div>
      <div class="profile-stat">
        <div class="profile-stat-val">${memberStr}</div>
        <div class="profile-stat-label">С нами с</div>
      </div>
    </div>

    <div class="profile-referral">
      <div class="profile-referral-title"><i class="bi bi-link-45deg" style="opacity:.5;margin-right:4px"></i>Реферальный код</div>
      <div class="profile-referral-row">
        <div class="profile-referral-code">${p.referral_code}</div>
        <button class="profile-referral-copy" id="copy-ref"><i class="bi bi-copy"></i></button>
      </div>
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

    <div class="profile-footer">LZT Store · v1.0.0</div>
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
  initTelegram();
  document.querySelectorAll('.bnav-tab').forEach(t => t.addEventListener('click', () => navigateTo(t.dataset.page)));
  let timer;
  document.getElementById('catalog-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchQuery = e.target.value.trim(); loadItems(); }, 400);
  });
  initFilters();
  navigateTo('catalog');
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
