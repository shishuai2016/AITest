import { $, initTheme, toggleTheme, icon, openModal, closeModal } from './ui.js';
import { renderHome } from './home.js';
import { renderStudio } from './studio.js';

initTheme();

let cleanup = null;
let currentPath = null;

function loadingScreen(label = '正在打开工作室') {
  return `<div class="loading-screen"><div style="text-align:center"><div class="loader"></div>${label}</div></div>`;
}

function notFound() {
  return `<div class="not-found"><div>
    <div class="eyebrow">404 · NOT FOUND</div>
    <h1>这一页还没有被生成。</h1>
    <p>链接可能已经过期，或者项目已经被移除。回到工作室，开始一个新的想法。</p>
    <a class="btn btn-dark" href="/">回到工作室 ${icon('arrow')}</a>
  </div></div>`;
}

async function navigate(path, { replace = false } = {}) {
  const url = new URL(path, window.location.origin);
  const next = url.pathname + url.search;
  if (next === currentPath && !replace) return;
  currentPath = next;

  if (cleanup) {
    try { cleanup(); } catch { /* ignore */ }
    cleanup = null;
  }
  closeModal();

  if (!replace) window.history.pushState({}, '', next);
  const root = document.getElementById('app');
  root.innerHTML = loadingScreen();
  window.scrollTo({ top: 0, behavior: 'instant' });

  try {
    const studioMatch = url.pathname.match(/^\/studio\/([^/]+)\/?$/);
    if (studioMatch) {
      const view = await renderStudio(root, decodeURIComponent(studioMatch[1]));
      cleanup = view?.cleanup || null;
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const view = await renderHome(root);
      cleanup = view?.cleanup || null;
      return;
    }
    root.innerHTML = notFound();
  } catch (error) {
    console.error(error);
    root.innerHTML = `<div class="not-found"><div>
      <div class="eyebrow">SOMETHING WENT WRONG</div>
      <h1>工作室暂时没有响应。</h1>
      <p>${String(error.message || error).replace(/[<>&]/g, '')}</p>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn btn-dark" onclick="location.reload()">重新加载</button>
        <a class="btn" href="/">回到首页</a>
      </div>
    </div></div>`;
  }
}

window.navigate = (path, options) => navigate(path, options);
window.addEventListener('popstate', () => {
  navigate(window.location.pathname + window.location.search, { replace: true });
});

document.addEventListener('click', (event) => {
  const themeButton = event.target.closest('[data-action="toggle-theme"]');
  if (themeButton) {
    const theme = toggleTheme();
    document.querySelectorAll('[data-action="toggle-theme"]').forEach((button) => {
      button.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    });
    return;
  }

  const anchor = event.target.closest('a[href]');
  if (!anchor) return;
  if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) return;
  if (href.startsWith('/api/') || href.startsWith('/preview/') || href.startsWith('/s/') || href.startsWith('/shots/')) return;
  if (href.startsWith('/')) {
    event.preventDefault();
    navigate(href);
  }
});

const start = window.location.pathname + window.location.search;
navigate(start, { replace: true });
