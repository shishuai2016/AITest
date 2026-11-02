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
  habitList: $('#habitList'),
  emptyState: $('#emptyState'),
  todayRing: $('#todayRing'),
  todayPercent: $('#todayPercent'),
  todayDone: $('#todayDone'),
  todayTotal: $('#todayTotal'),
  todayHint: $('#todayHint'),
  bestStreak: $('#bestStreak'),
  weekRange: $('#weekRange'),
  heatmap: $('#heatmap'),
  heatmapTotal: $('#heatmapTotal'),
  dailyQuote: $('#dailyQuote'),
  quoteDots: $('#quoteDots'),
  addPanel: $('#addPanel'),
  habitName: $('#habitName'),
  formError: $('#formError'),
  toast: $('#toast'),
};
const RING = 2 * Math.PI * 52;
const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const QUOTES = [
  '你不需要每天都很厉害，你只需要每天都出现。',
  '先做五分钟。开始本身，就是最难的部分。',
  '别小看一次打卡，它是在给未来的自己投票。',
  '中断不可怕，第二天回来就好。',
];
const state = { habits: [], checks: {}, emoji: '📖', color: '#2f6f5e', quoteIndex: 0, quoteTimer: null };

const DEMO_HABITS = [
  { id: 'h-read', name: '睡前读 10 页书', emoji: '📖', color: '#2f6f5e', createdAt: Date.now() - 21 * 86400000 },
  { id: 'h-run', name: '下班后走 6000 步', emoji: '🏃', color: '#3a6ea5', createdAt: Date.now() - 18 * 86400000 },
  { id: 'h-water', name: '喝够 2L 水', emoji: '💧', color: '#3a6ea5', createdAt: Date.now() - 14 * 86400000 },
  { id: 'h-meditate', name: '闭眼呼吸 5 分钟', emoji: '🧘', color: '#8a6fa8', createdAt: Date.now() - 9 * 86400000 },
];

function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => els.toast.classList.remove('show'), 2000);
}

function seedChecks(habits) {
  const checks = {};
  habits.forEach((habit, habitIndex) => {
    checks[habit.id] = {};
    for (let offset = 1; offset <= 20; offset += 1) {
      const pattern = (offset * 7 + habitIndex * 5) % 10;
      if (pattern < (habitIndex === 0 ? 7 : 5)) {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        checks[habit.id][dayKey(date)] = true;
      }
    }
  });
  const today = new Date();
  checks['h-read'][dayKey(today)] = true;
  checks['h-water'][dayKey(today)] = true;
  return checks;
}

function lastDays(count) {
  const days = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    days.push(date);
  }
  return days;
}

function isChecked(habitId, date) {
  return Boolean(state.checks[habitId]?.[dayKey(date)]);
}

function streakOf(habitId) {
  let streak = 0;
  const cursor = new Date();
  if (!isChecked(habitId, cursor)) cursor.setDate(cursor.getDate() - 1);
  while (isChecked(habitId, cursor)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
    if (streak > 3650) break;
  }
  return streak;
}

function render() {
  const week = lastDays(7);
  const today = new Date();
  const checkedToday = state.habits.filter((habit) => isChecked(habit.id, today)).length;
  const total = state.habits.length;
  const percent = total ? Math.round((checkedToday / total) * 100) : 0;
  els.todayRing.style.strokeDasharray = String(RING);
  els.todayRing.style.strokeDashoffset = String(RING - (RING * percent) / 100);
  els.todayPercent.textContent = `${percent}%`;
  els.todayDone.textContent = checkedToday;
  els.todayTotal.textContent = `/ ${total}`;
  els.todayHint.textContent = checkedToday === 0 ? '今天还没有打卡' : checkedToday === total && total > 0 ? '今天全部完成，了不起' : `还差 ${total - checkedToday} 个，慢慢来`;
  const best = state.habits.reduce((max, habit) => Math.max(max, streakOf(habit.id)), 0);
  els.bestStreak.textContent = `最长连续 ${best} 天`;

  const first = week[0];
  const last = week[week.length - 1];
  els.weekRange.textContent = `${first.getMonth() + 1}月${first.getDate()}日 — ${last.getMonth() + 1}月${last.getDate()}日`;
  els.habitList.innerHTML = state.habits
    .map((habit) => {
      const days = week
        .map((date) => {
          const done = isChecked(habit.id, date);
          const isToday = dayKey(date) === dayKey(today);
          return `<button class="day ${done ? 'done' : ''} ${isToday ? 'today' : ''}" type="button"
            data-habit="${habit.id}" data-day="${dayKey(date)}"
            aria-label="${date.getMonth() + 1}月${date.getDate()}日 ${escapeHtml(habit.name)} ${done ? '已打卡' : '未打卡'}"
            aria-pressed="${done}">
            <span class="day-label">${isToday ? '今' : DAY_LABELS[date.getDay()]}</span>
            <span class="day-dot"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.4l3.1 3L13 4.6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </button>`;
        })
        .join('');
      const streak = streakOf(habit.id);
      const weekDone = week.filter((date) => isChecked(habit.id, date)).length;
      return `<article class="habit" data-id="${habit.id}" style="--habit:${habit.color}">
        <div class="habit-id">
          <span class="habit-emoji" style="background:color-mix(in srgb, ${habit.color} 14%, #fff);" aria-hidden="true">${habit.emoji}</span>
          <div>
            <p class="habit-name">${escapeHtml(habit.name)}</p>
            <p class="habit-sub">本周 ${weekDone}/7 · 已坚持 ${streak} 天</p>
          </div>
        </div>
        <div class="days" role="group" aria-label="${escapeHtml(habit.name)} 本周打卡">${days}</div>
        <div class="habit-stat"><span class="streak-num">${streak}<small>天</small></span><span class="streak-label">连续</span></div>
        <button class="habit-del" type="button" aria-label="删除习惯">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 6.5h8M8 6.5V5h4v1.5M7 6.5l.4 7h5.2l.4-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
      </article>`;
    })
    .join('');
  els.emptyState.hidden = state.habits.length > 0;
  els.habitList.hidden = state.habits.length === 0;

  const heatDays = lastDays(28);
  const counts = heatDays.map((date) => state.habits.filter((habit) => isChecked(habit.id, date)).length);
  const max = Math.max(1, total);
  els.heatmap.innerHTML = heatDays
    .map((date, index) => {
      const count = counts[index];
      const level = count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4));
      return `<div class="heat-cell l${level}" data-tip="${date.getMonth() + 1}/${date.getDate()} · ${count} 项"></div>`;
    })
    .join('');
  els.heatmapTotal.textContent = `${counts.reduce((sum, count) => sum + count, 0)} 次打卡`;

  els.quoteDots.innerHTML = QUOTES.map((_, index) => `<i class="${index === state.quoteIndex ? 'active' : ''}"></i>`).join('');
}

async function persist() {
  await store.set('hl_habits', state.habits);
  await store.set('hl_checks', state.checks);
}

async function toggleDay(habitId, key) {
  const date = new Date();
  const parsed = key.split('-').map(Number);
  const target = new Date(parsed[0], parsed[1] - 1, parsed[2]);
  if (target > date) return;
  state.checks[habitId] = state.checks[habitId] || {};
  const wasDone = Boolean(state.checks[habitId][key]);
  if (wasDone) delete state.checks[habitId][key];
  else state.checks[habitId][key] = true;
  await persist();
  render();
  toast(wasDone ? '已取消今天的打卡' : '打卡成功，明天见');
}

function openAddPanel() {
  els.addPanel.hidden = false;
  els.formError.textContent = '';
  els.habitName.value = '';
  els.habitName.focus();
}

function closeAddPanel() {
  els.addPanel.hidden = true;
}

async function addHabit() {
  const name = els.habitName.value.trim();
  if (name.length < 2) {
    els.formError.textContent = '给习惯起个具体的名字，比如「读 10 页书」。';
    els.habitName.focus();
    return;
  }
  const id = 'h' + Date.now();
  state.habits.push({ id, name, emoji: state.emoji, color: state.color, createdAt: Date.now() });
  state.checks[id] = {};
  await persist();
  render();
  closeAddPanel();
  toast('新习惯已加入，从今天开始');
}

async function init() {
  const habits = await store.get('hl_habits', null);
  if (Array.isArray(habits) && habits.length) {
    state.habits = habits;
    state.checks = (await store.get('hl_checks', {})) || {};
  } else {
    state.habits = DEMO_HABITS.slice();
    state.checks = seedChecks(state.habits);
    await persist();
  }
  render();
  state.quoteTimer = setInterval(() => {
    state.quoteIndex = (state.quoteIndex + 1) % QUOTES.length;
    els.dailyQuote.textContent = `“${QUOTES[state.quoteIndex]}”`;
    els.quoteDots.innerHTML = QUOTES.map((_, index) => `<i class="${index === state.quoteIndex ? 'active' : ''}"></i>`).join('');
  }, 9000);
}

$('#addToggle').addEventListener('click', openAddPanel);
$('#emptyAdd').addEventListener('click', openAddPanel);
$('#addClose').addEventListener('click', closeAddPanel);
els.addPanel.addEventListener('click', (event) => {
  if (event.target === els.addPanel) closeAddPanel();
});
els.habitList.addEventListener('click', async (event) => {
  const day = event.target.closest('.day');
  if (day) {
    await toggleDay(day.dataset.habit, day.dataset.day);
    return;
  }
  const del = event.target.closest('.habit-del');
  if (del) {
    const card = del.closest('.habit');
    const habit = state.habits.find((item) => item.id === card.dataset.id);
    state.habits = state.habits.filter((item) => item.id !== card.dataset.id);
    await persist();
    render();
    toast(`已删除「${habit?.name || '这个习惯'}」`);
  }
});
$('#emojiRow').addEventListener('click', (event) => {
  const button = event.target.closest('.emoji');
  if (!button) return;
  state.emoji = button.dataset.emoji;
  $$('#emojiRow .emoji').forEach((item) => item.classList.toggle('active', item === button));
});
$('#colorRow').addEventListener('click', (event) => {
  const button = event.target.closest('.color');
  if (!button) return;
  state.color = button.dataset.color;
  $$('#colorRow .color').forEach((item) => item.classList.toggle('active', item === button));
});
$('#habitForm').addEventListener('submit', (event) => {
  event.preventDefault();
  addHabit();
});
els.quoteDots.addEventListener('click', () => {
  state.quoteIndex = (state.quoteIndex + 1) % QUOTES.length;
  els.dailyQuote.textContent = `“${QUOTES[state.quoteIndex]}”`;
  render();
});
$('#resetDemo').addEventListener('click', async () => {
  state.habits = DEMO_HABITS.slice();
  state.checks = seedChecks(state.habits);
  await persist();
  render();
  toast('示例数据已恢复');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.addPanel.hidden) closeAddPanel();
});
init();
