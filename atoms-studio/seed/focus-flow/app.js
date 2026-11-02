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

const DEMO_TASKS = [
  { id: 't1', title: '整理本周的产品反馈，标出重复出现的问题', done: false, tag: '产品', createdAt: Date.now() - 7200000 },
  { id: 't2', title: '把首页的加载状态补上骨架屏', done: false, tag: '设计', createdAt: Date.now() - 5400000 },
  { id: 't3', title: '读完《深度工作》第 3 章', done: true, tag: '阅读', createdAt: Date.now() - 3600000, doneAt: Date.now() - 1800000 },
  { id: 't4', title: '回复两封不紧急但重要的邮件', done: false, tag: '沟通', createdAt: Date.now() - 1800000 },
];

const state = {
  tasks: [],
  filter: 'all',
  mode: 'focus',
  seconds: 25 * 60,
  running: false,
  sessions: [],
  timerId: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const taskList = $('#taskList');
const emptyState = $('#emptyState');
const taskInput = $('#taskInput');
const dateLabel = $('#dateLabel');
const clockLabel = $('#clockLabel');
const timerValue = $('#timerValue');
const timerLabel = $('#timerLabel');
const sessionHint = $('#sessionHint');
const orbit = $('#orbitValue');
const ring = $('#ringValue');
const startBtn = $('#startBtn');
const startLabel = $('#startLabel');
const toastEl = $('#toast');

const ORBIT_LENGTH = 2 * Math.PI * 118;
const RING_LENGTH = 2 * Math.PI * 20;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

function updateClock() {
  const now = new Date();
  dateLabel.textContent = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  clockLabel.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function filteredTasks() {
  if (state.filter === 'open') return state.tasks.filter((task) => !task.done);
  if (state.filter === 'done') return state.tasks.filter((task) => task.done);
  return state.tasks;
}

function render() {
  const items = filteredTasks();
  taskList.innerHTML = items
    .map(
      (task) => `
      <li class="task ${task.done ? 'done' : ''}" data-id="${task.id}">
        <button class="check" type="button" aria-label="${task.done ? '标记为未完成' : '标记为完成'}" aria-pressed="${task.done}">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="task-body">
          <p class="task-title">${escapeHtml(task.title)}</p>
          <p class="task-meta">${escapeHtml(task.tag || '今日')}${task.doneAt ? ` · 完成于 ${new Date(task.doneAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}</p>
        </div>
        <button class="task-del" type="button" aria-label="删除任务">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 6h10M8 6V4.5h4V6M6.5 6l.6 9h5.8l.6-9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </li>`,
    )
    .join('');
  emptyState.hidden = items.length > 0;
  taskList.hidden = items.length === 0;

  const done = state.tasks.filter((task) => task.done).length;
  $('#doneCount').textContent = done;
  $('#countAll').textContent = state.tasks.length;
  const rate = state.tasks.length ? Math.round((done / state.tasks.length) * 100) : 0;
  $('#ringText').textContent = `${rate}%`;
  ring.style.strokeDasharray = String(RING_LENGTH);
  ring.style.strokeDashoffset = String(RING_LENGTH - (RING_LENGTH * rate) / 100);
  $('#doneRate').textContent = rate;
  $('#focusMinutes').textContent = todaySessions() * 25;
  $('#sessionCount').textContent = todaySessions();
}

function todaySessions() {
  const key = todayKey();
  return state.sessions.filter((value) => todayKey(new Date(value)) === key).length;
}

function persistTasks() {
  store.set('ff_tasks', state.tasks);
  store.set('ff_sessions', state.sessions);
}

function addTask(title) {
  const clean = title.trim();
  if (clean.length < 2) {
    taskInput.focus();
    toast('再多写几个字，未来的你会感谢现在的你');
    return;
  }
  state.tasks.unshift({ id: 't' + Date.now(), title: clean, done: false, tag: '新任务', createdAt: Date.now() });
  persistTasks();
  state.filter = 'all';
  $$('.filter').forEach((button) => {
    const active = button.dataset.filter === 'all';
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  render();
  taskInput.value = '';
  toast('已加入今天的清单');
}

function markDone(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.done = !task.done;
  task.doneAt = task.done ? Date.now() : null;
  persistTasks();
  render();
  if (task.done) toast('完成一件，给自己一点掌声');
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((task) => task.id !== id);
  persistTasks();
  render();
  toast('已移除');
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateTimer() {
  timerValue.textContent = formatTime(state.seconds);
  timerValue.setAttribute('datetime', `PT${Math.max(1, Math.ceil(state.seconds / 60))}M`);
  const total = state.mode === 'focus' ? 25 * 60 : 5 * 60;
  orbit.style.strokeDasharray = String(ORBIT_LENGTH);
  orbit.style.strokeDashoffset = String(ORBIT_LENGTH * (1 - state.seconds / total));
  timerLabel.textContent = state.mode === 'focus' ? 'FOCUS' : 'BREAK';
  sessionHint.textContent = state.mode === 'focus' ? `第 ${todaySessions() + 1} 个专注段` : '起身走动，喝口水';
  startLabel.textContent = state.running ? '暂停' : state.mode === 'focus' ? '开始专注' : '开始休息';
  startBtn.classList.toggle('running', state.running);
  $$('.mode').forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setMode(mode) {
  stopTimer();
  state.mode = mode;
  state.seconds = mode === 'focus' ? 25 * 60 : 5 * 60;
  updateTimer();
}

function startTimer() {
  if (state.running) {
    stopTimer();
    toast('已暂停，随时可以继续');
    return;
  }
  state.running = true;
  updateTimer();
  state.timerId = setInterval(() => {
    state.seconds -= 1;
    if (state.seconds <= 0) {
      completeSegment();
      return;
    }
    updateTimer();
  }, 1000);
}

function stopTimer() {
  state.running = false;
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
  updateTimer();
}

function completeSegment() {
  stopTimer();
  if (state.mode === 'focus') {
    state.sessions.push(Date.now());
    persistTasks();
    toast('完成一个专注段，休息 5 分钟');
    state.mode = 'break';
    state.seconds = 5 * 60;
  } else {
    toast('休息结束，继续下一段专注');
    state.mode = 'focus';
    state.seconds = 25 * 60;
  }
  render();
  updateTimer();
}

async function init() {
  updateClock();
  setInterval(updateClock, 30000);
  const saved = await store.get('ff_tasks', null);
  state.tasks = Array.isArray(saved) && saved.length ? saved : DEMO_TASKS.slice();
  if (!Array.isArray(saved) || !saved.length) await store.set('ff_tasks', state.tasks);
  const sessions = await store.get('ff_sessions', null);
  state.sessions = Array.isArray(sessions) ? sessions : [Date.now() - 3600000, Date.now() - 9000000];
  if (!Array.isArray(sessions)) await store.set('ff_sessions', state.sessions);
  render();
  updateTimer();
}

$('#addForm').addEventListener('submit', (event) => {
  event.preventDefault();
  addTask(taskInput.value);
});
taskList.addEventListener('click', (event) => {
  const item = event.target.closest('.task');
  if (!item) return;
  if (event.target.closest('.check')) markDone(item.dataset.id);
  if (event.target.closest('.task-del')) deleteTask(item.dataset.id);
});
$$('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    $$('.filter').forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    render();
  });
});
$('#clearDone').addEventListener('click', () => {
  const count = state.tasks.filter((task) => task.done).length;
  if (!count) return toast('还没有已完成的任务');
  state.tasks = state.tasks.filter((task) => !task.done);
  persistTasks();
  render();
  toast(`清理了 ${count} 件已完成的任务`);
});
startBtn.addEventListener('click', startTimer);
$('#resetBtn').addEventListener('click', () => {
  stopTimer();
  state.seconds = state.mode === 'focus' ? 25 * 60 : 5 * 60;
  updateTimer();
  toast('计时已重置');
});
$$('.mode').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});
$('#resetDemo').addEventListener('click', async () => {
  state.tasks = DEMO_TASKS.slice();
  state.sessions = [Date.now() - 3600000, Date.now() - 9000000];
  persistTasks();
  render();
  toast('示例数据已恢复');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && document.activeElement === taskInput) {
    event.preventDefault();
    addTask(taskInput.value);
  }
});
init();
