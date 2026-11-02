import fs from 'node:fs';
import path from 'node:path';

const SEED_DIR = path.resolve('seed');

const MINIMAL_FALLBACK = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>灵感收集器</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="topbar">
  <div class="brand"><span class="spark">✦</span><span>灵感收集器</span></div>
  <span class="hint">想法先记下来，之后再整理</span>
</header>
<main class="board">
  <section class="composer">
    <label for="idea">此刻的灵感</label>
    <textarea id="idea" rows="3" placeholder="写下一句话、一个问题、一个画面…"></textarea>
    <div class="composer-row">
      <div class="tags" id="tags"></div>
      <button id="add" class="primary">收进灵感库</button>
    </div>
    <p class="form-error" id="formError" role="alert"></p>
  </section>
  <section class="list-wrap">
    <div class="list-head"><h2>灵感库</h2><span id="count" class="count"></span></div>
    <div id="list" class="list"></div>
    <div id="empty" class="empty" hidden>还没有灵感，写下第一条吧。</div>
  </section>
</main>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script src="app.js" defer></script>
</body>
</html>`;

const MINIMAL_CSS = `:root{--paper:#f6f2e9;--ink:#1d1b17;--muted:#6f6a5f;--line:#ded6c7;--accent:#0f766e;--card:#fffdf8}*{box-sizing:border-box}body{margin:0;background:radial-gradient(1200px 600px at 85% -10%,#e7f2ee,transparent),var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;min-height:100vh}.topbar{display:flex;justify-content:space-between;align-items:center;padding:22px clamp(18px,4vw,56px);border-bottom:1px solid var(--line)}.brand{display:flex;gap:10px;align-items:center;font-weight:700;letter-spacing:.02em}.spark{color:var(--accent);font-size:20px}.hint{color:var(--muted);font-size:13px}.board{max-width:1080px;margin:0 auto;padding:clamp(20px,4vw,48px) clamp(16px,4vw,40px);display:grid;gap:28px}.composer{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 18px 40px -30px rgba(29,27,23,.5)}label{display:block;font-size:13px;color:var(--muted);margin-bottom:10px;letter-spacing:.08em;text-transform:uppercase}textarea{width:100%;border:0;background:transparent;resize:vertical;font:inherit;font-size:18px;line-height:1.6;color:var(--ink);outline:none;min-height:84px}.composer-row{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:14px}.tags{display:flex;gap:8px}.tag{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:6px 12px;font-size:12px;cursor:pointer}.tag.active{border-color:var(--accent);color:var(--accent);background:#eef7f4}button{font:inherit;cursor:pointer}.primary{border:0;background:var(--ink);color:#fff;border-radius:10px;padding:11px 20px;font-weight:600}.primary:hover{background:var(--accent)}.form-error{color:#b42318;font-size:13px;min-height:18px;margin:8px 0 0}.list-head{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}.list-head h2{font-size:16px;margin:0;letter-spacing:.04em}.count{color:var(--muted);font-size:13px}.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;position:relative;animation:in .3s ease both}.card:hover{transform:translateY(-2px);transition:transform .2s}.card p{margin:0 0 16px;line-height:1.6;font-size:15px}.card footer{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:12px}.delete{border:1px solid var(--line);background:transparent;border-radius:8px;padding:5px 10px;color:var(--muted)}.delete:hover{color:#b42318;border-color:#e5b4ae}.empty{border:1px dashed var(--line);border-radius:14px;padding:44px;text-align:center;color:var(--muted)}.toast{position:fixed;right:24px;bottom:24px;background:var(--ink);color:#fff;padding:11px 18px;border-radius:10px;font-size:13px;opacity:0;transform:translateY(10px);transition:.25s;pointer-events:none}.toast.show{opacity:1;transform:none}@keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@media(max-width:520px){.hint{display:none}.composer-row{align-items:flex-start;flex-direction:column}.primary{width:100%}}`;

const MINIMAL_JS = `const store = window.atomsStore || {
  get: async (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } },
  set: async (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: async (k) => localStorage.removeItem(k),
  list: async () => ({}),
};
const state = { items: [], tag: '全部' };
const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const inputEl = document.getElementById('idea');
const errorEl = document.getElementById('formError');
const toastEl = document.getElementById('toast');
const tags = ['全部', '产品', '设计', '生活', '技术'];
document.getElementById('tags').innerHTML = tags.map((t) => '<button class="tag' + (t === state.tag ? ' active' : '') + '" data-tag="' + t + '">' + t + '</button>').join('');
function toast(message) { toastEl.textContent = message; toastEl.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.classList.remove('show'), 1800); }
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function render() {
  const items = state.tag === '全部' ? state.items : state.items.filter((i) => i.tag === state.tag);
  countEl.textContent = state.items.length + ' 条';
  emptyEl.hidden = items.length > 0;
  listEl.innerHTML = items.map((item) => '<article class="card"><p>' + escapeHtml(item.text) + '</p><footer><span>' + escapeHtml(item.tag) + ' · ' + new Date(item.at).toLocaleDateString('zh-CN') + '</span><button class="delete" data-id="' + item.id + '">删除</button></footer></article>').join('');
}
async function init() {
  state.items = await store.get('ideas', []);
  if (!state.items.length) {
    state.items = [
      { id: 'demo-1', text: '把「等待」设计成一种可见的体验，而不是转圈。', tag: '设计', at: Date.now() - 86400000 },
      { id: 'demo-2', text: '给每周一次的产品复盘加一个固定问题：这周我们删掉了什么？', tag: '产品', at: Date.now() - 3600000 },
    ];
    await store.set('ideas', state.items);
  }
  render();
}
document.getElementById('add').addEventListener('click', async () => {
  const text = inputEl.value.trim();
  if (text.length < 2) { errorEl.textContent = '至少写两个字，让未来的你看得懂。'; inputEl.focus(); return; }
  errorEl.textContent = '';
  state.items.unshift({ id: 'i' + Date.now(), text, tag: state.tag === '全部' ? '生活' : state.tag, at: Date.now() });
  inputEl.value = '';
  await store.set('ideas', state.items);
  render();
  toast('已收进灵感库');
});
inputEl.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') document.getElementById('add').click(); });
document.getElementById('tags').addEventListener('click', (e) => {
  const tag = e.target.dataset?.tag;
  if (!tag) return;
  state.tag = tag;
  document.querySelectorAll('.tag').forEach((el) => el.classList.toggle('active', el.dataset.tag === tag));
  render();
});
listEl.addEventListener('click', async (e) => {
  const id = e.target.dataset?.id;
  if (!id) return;
  state.items = state.items.filter((item) => item.id !== id);
  await store.set('ideas', state.items);
  render();
  toast('已删除');
});
init();`;

const SEEDS = [
  { dir: 'focus-flow', keywords: /任务|待办|todo|效率|专注|番茄|清单|计划/i, name: 'Focus Flow' },
  { dir: 'cafe-ledger', keywords: /记账|支出|账单|财务|流水|咖啡|小店|营收|报表|看板|数据/i, name: 'Cafe Ledger' },
  { dir: 'habit-loop', keywords: /习惯|打卡|坚持|健康|运动|睡眠|每日/i, name: 'Habit Loop' },
];

function loadSeed(dir) {
  const base = path.join(SEED_DIR, dir);
  const files = [];
  for (const file of ['index.html', 'styles.css', 'app.js']) {
    try {
      files.push({ path: file, content: fs.readFileSync(path.join(base, file), 'utf8') });
    } catch {
      /* ignore */
    }
  }
  return files;
}

export function fallbackFiles(prompt, design = {}) {
  let files;
  const seed = SEEDS.find((item) => item.keywords.test(prompt));
  if (seed) {
    files = loadSeed(seed.dir);
  }
  if (!files?.length) {
    files = [
      { path: 'index.html', content: MINIMAL_FALLBACK },
      { path: 'styles.css', content: MINIMAL_CSS },
      { path: 'app.js', content: MINIMAL_JS },
    ];
  }
  if (design.name) {
    files = files.map((file) =>
      file.path === 'index.html'
        ? file.content.replace(/<title>[^<]*<\/title>/i, `<title>${design.name}</title>`)
        : file,
    );
  }
  return {
    files,
    plan: ['使用内置演示引擎快速搭建应用', '加载示例数据与持久化逻辑', '完成预览与自动验收'],
    summary: seed
      ? `已用内置演示模板生成「${design.name || seed.name}」，可继续用自然语言迭代。`
      : `已用内置演示引擎生成「${design.name || '你的应用'}」，可继续用自然语言迭代。`,
  };
}
