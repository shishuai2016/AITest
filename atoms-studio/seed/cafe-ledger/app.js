const store = window.atomsStore || {
  get: async (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set: async (key, value) => localStorage.setItem(key, JSON.stringify(value)),
  del: async (key) => localStorage.removeItem(key),
  list: async () => ({}),
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const els = {
  todayRevenue: $('#todayRevenue'),
  revenueDelta: $('#revenueDelta'),
  heroNote: $('#heroNote'),
  orderCount: $('#orderCount'),
  avgTicket: $('#avgTicket'),
  avgFoot: $('#avgFoot'),
  topItem: $('#topItem'),
  topItemFoot: $('#topItemFoot'),
  weekRevenue: $('#weekRevenue'),
  weekFoot: $('#weekFoot'),
  orderList: $('#orderList'),
  ordersEmpty: $('#ordersEmpty'),
  barChart: $('#barChart'),
  chartTotal: $('#chartTotal'),
  sparkLine: $('#sparkLine'),
  sparkArea: $('#sparkArea'),
  todayDate: $('#todayDate'),
  formError: $('#formError'),
  savedHint: $('#savedHint'),
  toast: $('#toast'),
};

const CATEGORIES = ['咖啡', '茶饮', '烘焙', '周边'];
const PRODUCTS = [
  ['美式', 18, '咖啡'],
  ['燕麦拿铁', 28, '咖啡'],
  ['手冲耶加雪菲', 36, '咖啡'],
  ['海盐焦糖拿铁', 32, '咖啡'],
  ['冷萃', 26, '咖啡'],
  ['抹茶拿铁', 30, '茶饮'],
  ['栀子乌龙', 24, '茶饮'],
  ['柠檬气泡水', 22, '茶饮'],
  ['可颂', 16, '烘焙'],
  ['巴斯克', 28, '烘焙'],
  ['肉桂卷', 20, '烘焙'],
  ['挂耳礼盒', 68, '周边'],
  ['随行杯', 89, '周边'],
];

const state = { orders: [], filter: 'all', chartDays: 7 };
let saveTimer = null;

function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function startOfDay(date = new Date()) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function fmtMoney(value) {
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: Number.isInteger(value) ? 0 : 1, maximumFractionDigits: 2 });
}

function todayOrders() {
  const key = dayKey();
  return state.orders.filter((order) => dayKey(new Date(order.at)) === key);
}

function ordersOnOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  const key = dayKey(date);
  return state.orders.filter((order) => dayKey(new Date(order.at)) === key);
}

function seedOrders() {
  const orders = [];
  let cursor = 0;
  for (let offset = 6; offset >= 0; offset -= 1) {
    const count = offset === 0 ? 7 : 5 + (offset % 4);
    for (let index = 0; index < count; index += 1) {
      const [name, price, category] = PRODUCTS[(cursor * 5 + offset * 3 + index * 2) % PRODUCTS.length];
      const date = new Date();
      date.setDate(date.getDate() - offset);
      date.setHours(8 + ((cursor * 3 + index * 2 + offset) % 11), ((cursor * 7 + index * 13) % 60), 0, 0);
      orders.push({
        id: 'seed-' + cursor,
        item: name,
        amount: price,
        category,
        at: date.getTime(),
      });
      cursor += 1;
    }
  }
  // 让今天有一笔几分钟前的订单，页面打开时更有现场感。
  orders.push({ id: 'seed-now', item: '燕麦拿铁', amount: 28, category: '咖啡', at: Date.now() - 6 * 60 * 1000 });
  return orders;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => els.toast.classList.remove('show'), 2000);
}

function markSaving() {
  els.savedHint.textContent = '同步中…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    els.savedHint.textContent = '数据已同步';
  }, 900);
}

async function persist() {
  markSaving();
  await store.set('cl_orders', state.orders);
}

function renderStats() {
  const today = todayOrders();
  const yesterday = ordersOnOffset(1);
  const revenue = today.reduce((sum, order) => sum + order.amount, 0);
  const yesterdayRevenue = yesterday.reduce((sum, order) => sum + order.amount, 0);
  const count = today.length;
  const avg = count ? revenue / count : 0;
  const counts = new Map();
  today.forEach((order) => counts.set(order.item, (counts.get(order.item) || 0) + 1));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const week = ordersOnOffset(0).concat(ordersOnOffset(1), ordersOnOffset(2), ordersOnOffset(3), ordersOnOffset(4), ordersOnOffset(5), ordersOnOffset(6));
  const weekTotal = week.reduce((sum, order) => sum + order.amount, 0);
  const weekCount = week.length;

  els.todayRevenue.textContent = fmtMoney(revenue);
  els.orderCount.textContent = count;
  els.avgTicket.textContent = fmtMoney(Math.round(avg * 10) / 10);
  els.avgFoot.textContent = count ? `较昨日 ${yesterdayRevenue ? (revenue >= yesterdayRevenue ? '+' : '') + Math.round(((revenue - yesterdayRevenue) / yesterdayRevenue) * 100) + '%' : '首单已记录'}` : '等待第一单';
  els.topItem.textContent = top ? top[0] : '—';
  els.topItemFoot.textContent = top ? `今日卖出 ${top[1]} 杯` : '等待第一杯';
  els.weekRevenue.textContent = fmtMoney(weekTotal);
  els.weekFoot.textContent = `${weekCount} 单 · 近 7 天`;

  if (yesterdayRevenue) {
    const delta = Math.round(((revenue - yesterdayRevenue) / yesterdayRevenue) * 100);
    els.revenueDelta.textContent = `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% 较昨日`;
    els.revenueDelta.classList.toggle('down', delta < 0);
  } else {
    els.revenueDelta.textContent = '今日新开始';
    els.revenueDelta.classList.remove('down');
  }
  els.heroNote.textContent = count
    ? `今天已经卖出 ${count} 单，最受欢迎的是${top ? top[0] : '第一杯咖啡'}。`
    : '今天还没有开张，先记下第一杯吧。';

  els.todayDate.textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

function renderChart() {
  const days = [];
  for (let offset = state.chartDays - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const revenue = ordersOnOffset(offset).reduce((sum, order) => sum + order.amount, 0);
    days.push({ date, revenue, offset });
  }
  const max = Math.max(...days.map((day) => day.revenue), 1);
  els.barChart.innerHTML = days
    .map((day) => {
      const height = Math.max(2, Math.round((day.revenue / max) * 100));
      const label = day.offset === 0 ? '今天' : `${day.date.getMonth() + 1}/${day.date.getDate()}`;
      return `<div class="bar-col ${day.offset === 0 ? 'is-today' : ''}" title="${label} · ¥${fmtMoney(day.revenue)}">
        <span class="bar-value">¥${Math.round(day.revenue)}</span>
        <div class="bar" style="height:${height}%"></div>
        <span class="bar-label">${label}</span>
      </div>`;
    })
    .join('');
  const total = days.reduce((sum, day) => sum + day.revenue, 0);
  els.chartTotal.textContent = `合计 ¥${fmtMoney(total)}`;

  const points = days.map((day, index) => {
    const x = (index / Math.max(days.length - 1, 1)) * 360;
    const y = 112 - (day.revenue / max) * 88;
    return [x, y];
  });
  if (!points.length) return;
  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  els.sparkLine.setAttribute('d', line);
  els.sparkArea.setAttribute('d', `${line} L360,120 L0,120 Z`);
}

function renderOrders() {
  const today = todayOrders().sort((a, b) => b.at - a.at);
  const filtered = state.filter === 'all' ? today : today.filter((order) => order.category === state.filter);
  els.orderList.innerHTML = filtered
    .map(
      (order) => `<li class="order-row" data-id="${order.id}">
        <span class="order-time">${new Date(order.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
        <span class="order-item">${escapeHtml(order.item)}</span>
        <span class="order-cat">${escapeHtml(order.category || '其他')}</span>
        <span class="order-amount">¥${fmtMoney(order.amount)}</span>
        <button class="order-del" type="button" aria-label="删除这笔订单">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 6.5h8M8 6.5V5h4v1.5M7 6.5l.4 7h5.2l.4-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
      </li>`,
    )
    .join('');
  els.ordersEmpty.hidden = filtered.length > 0;
}

function render() {
  renderStats();
  renderChart();
  renderOrders();
}

async function addOrder(item, amount, category) {
  state.orders.push({ id: 'o' + Date.now(), item, amount, category, at: Date.now() });
  await persist();
  render();
  toast(`已记入：${item} ¥${fmtMoney(amount)}`);
}

function exportCsv() {
  const header = '时间,商品,分类,金额\n';
  const rows = state.orders
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((order) => `${new Date(order.at).toLocaleString('zh-CN')},${order.item},${order.category},${order.amount}`)
    .join('\n');
  const blob = new Blob(['\ufeff' + header + rows], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `拾光咖啡-流水-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast('CSV 已导出');
}

async function init() {
  const saved = await store.get('cl_orders', null);
  if (Array.isArray(saved) && saved.length) {
    state.orders = saved;
  } else {
    state.orders = seedOrders();
    await store.set('cl_orders', state.orders);
  }
  render();
}

$('#orderForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const item = $('#itemInput').value.trim();
  const amount = Number($('#amountInput').value);
  const category = $('#categoryInput').value;
  if (item.length < 1) {
    els.formError.textContent = '写一下卖了什么，方便月底复盘。';
    $('#itemInput').focus();
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    els.formError.textContent = '金额要大于 0。';
    $('#amountInput').focus();
    return;
  }
  els.formError.textContent = '';
  await addOrder(item, Math.round(amount * 100) / 100, category);
  $('#itemInput').value = '';
  $('#amountInput').value = '';
  $('#itemInput').focus();
});
$('#exportBtn').addEventListener('click', exportCsv);
$('#filters').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip || chip.id === 'resetDemo') return;
  state.filter = chip.dataset.cat;
  $$('#filters .chip').forEach((item) => item.classList.toggle('active', item === chip));
  renderOrders();
});
els.orderList.addEventListener('click', async (event) => {
  const button = event.target.closest('.order-del');
  if (!button) return;
  const id = button.closest('.order-row').dataset.id;
  state.orders = state.orders.filter((order) => order.id !== id);
  await persist();
  render();
  toast('已删除这笔流水');
});
$$('.seg').forEach((button) => {
  button.addEventListener('click', () => {
    state.chartDays = Number(button.dataset.days);
    $$('.seg').forEach((item) => item.classList.toggle('active', item === button));
    renderChart();
  });
});
$('#resetDemo').addEventListener('click', async () => {
  state.orders = seedOrders();
  await persist();
  render();
  toast('演示数据已恢复');
});
init();
