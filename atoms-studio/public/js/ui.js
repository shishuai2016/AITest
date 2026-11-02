export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function attrs(value) {
  return esc(value).replaceAll('`', '&#96;');
}

export function formatDate(iso, options = {}) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(iso, { year: 'numeric' });
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

export function formatBytes(size) {
  const value = Number(size || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export function clampText(value, max = 180) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

const paths = {
  arrow: '<path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  back: '<path d="M15 5l-5 5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  spark: '<path d="M10 2.8c.5 3.5 1.7 4.7 5.2 5.2-3.5.5-4.7 1.7-5.2 5.2-.5-3.5-1.7-4.7-5.2-5.2 3.5-.5 4.7-1.7 5.2-5.2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  copy: '<rect x="7" y="7" width="8.5" height="9" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M12.5 7V5.6A1.6 1.6 0 0 0 10.9 4H5.6A1.6 1.6 0 0 0 4 5.6v7.3A1.6 1.6 0 0 0 5.6 14.5H7" stroke="currentColor" stroke-width="1.4"/>',
  download: '<path d="M10 3v8.5m0 0 3-3m-3 3-3-3M4 14.5V16h12v-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  share: '<circle cx="15" cy="5.5" r="2.3" stroke="currentColor" stroke-width="1.3"/><circle cx="5" cy="10" r="2.3" stroke="currentColor" stroke-width="1.3"/><circle cx="15" cy="14.5" r="2.3" stroke="currentColor" stroke-width="1.3"/><path d="m7 9 5.8-2.7M7 11l5.8 2.7" stroke="currentColor" stroke-width="1.3"/>',
  external: '<path d="M11 4h5v5M16 4l-6.5 6.5M8 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5V12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  refresh: '<path d="M16 8a6 6 0 1 0 .4 3.5M16 4v4h-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  desktop: '<rect x="3" y="4" width="14" height="9.5" rx="1.4" stroke="currentColor" stroke-width="1.3"/><path d="M7.5 16.5h5M10 13.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  tablet: '<rect x="5" y="2.8" width="10" height="14.4" rx="1.6" stroke="currentColor" stroke-width="1.3"/><path d="M9 14.8h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  mobile: '<rect x="6.2" y="2.5" width="7.6" height="15" rx="1.8" stroke="currentColor" stroke-width="1.3"/><path d="M9 15h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  code: '<path d="m7 6-4 4 4 4M13 6l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  layers: '<path d="m10 3 7 3.5-7 3.5L3 6.5 10 3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="m3 10 7 3.5 7-3.5M3 13.5 10 17l7-3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  history: '<path d="M3.5 10a6.5 6.5 0 1 0 2-4.6M3.5 4v4h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 6.8V10l2.4 1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  check: '<path d="m4 10.5 3.6 3.6L16 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="m5 5 10 10M15 5 5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  plus: '<path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  file: '<path d="M5 3.5h6l4 4V16a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 16V3.5Z" stroke="currentColor" stroke-width="1.3"/><path d="M11 3.5V8h4.5" stroke="currentColor" stroke-width="1.3"/>',
  doc: '<path d="M5 3.5h6l4 4V16a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 16V3.5Z" stroke="currentColor" stroke-width="1.3"/><path d="M7.5 10h5M7.5 12.8h5M11 3.5V8h4.5" stroke="currentColor" stroke-width="1.3"/>',
  deck: '<rect x="3" y="4" width="14" height="9" rx="1.2" stroke="currentColor" stroke-width="1.3"/><path d="M7 16.5 10 13l3 3.5M10 13v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  report: '<path d="M5 3.5h7.5L16 7v9.5A1.5 1.5 0 0 1 14.5 18h-9A1.5 1.5 0 0 1 4 16.5V5A1.5 1.5 0 0 1 5 3.5Z" stroke="currentColor" stroke-width="1.3"/><path d="M7 11h6M7 14h4M12 3.5V7.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  trash: '<path d="M5.5 6.5h9M8 6.5V4.8h4v1.7M6.8 6.5l.5 9.2h5.4l.5-9.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  send: '<path d="m4 10 12-5.5L11.5 16 9 11.5 4 10Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  sun: '<circle cx="10" cy="10" r="3.4" stroke="currentColor" stroke-width="1.3"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M15.3 4.7 14 6M6 14l-1.3 1.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  moon: '<path d="M16 12.2A6.4 6.4 0 0 1 7.8 4a6.6 6.6 0 1 0 8.2 8.2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  chevron: '<path d="m7 4 6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  checkSmall: '<path d="m3.5 8 2.6 2.6L12.5 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  warn: '<path d="M10 3 18 17H2L10 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 8v4M10 14.5v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  fail: '<path d="m5 5 10 10M15 5 5 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  github: '<path d="M10 2.5a7.5 7.5 0 0 0-2.4 14.6c.4.1.5-.2.5-.4v-1.5c-2.1.5-2.5-.9-2.5-.9-.3-.9-.8-1.1-.8-1.1-.7-.5.1-.5.1-.5.7.1 1.1.8 1.1.8.7 1.2 1.9.9 2.4.7.1-.5.3-.9.5-1.1-1.7-.2-3.5-.9-3.5-3.9 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2.1 0 3-1.8 3.7-3.5 3.9.3.2.5.7.5 1.4v2.1c0 .2.1.5.5.4A7.5 7.5 0 0 0 10 2.5Z" fill="currentColor"/>',
};

export function icon(name, cls = '') {
  const svg = paths[name] || paths.spark;
  return `<svg class="${cls}" viewBox="0 0 20 20" fill="none" aria-hidden="true">${svg}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export function toast(message, type = 'success') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.innerHTML = `<i></i><span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, type === 'error' ? 3800 : 2400);
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

let openModalState = null;

export function openModal({ title, subtitle = '', body = '', actions = '', size = '', onMount, onClose, bodyClass = '' }) {
  closeModal();
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="modal ${size}" role="dialog" aria-modal="true" aria-label="${attrs(title)}">
      <header class="modal-head">
        <div style="min-width:0">
          <div class="modal-title">${esc(title)}</div>
          ${subtitle ? `<div class="modal-sub">${esc(subtitle)}</div>` : ''}
        </div>
        <div class="modal-actions">${actions}<button class="modal-close" type="button" aria-label="关闭">×</button></div>
      </header>
      <div class="modal-body ${bodyClass}">${body}</div>
    </section>`;
  root.appendChild(backdrop);
  document.body.classList.add('no-scroll');
  const close = () => {
    backdrop.remove();
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey);
    openModalState = null;
    onClose?.();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  openModalState = { close, backdrop };
  onMount?.(backdrop.querySelector('.modal-body'), close);
  return { backdrop, close };
}

export function closeModal() {
  if (openModalState) openModalState.close();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/* ------------------------------------------------------------------ */
/* Markdown                                                             */
/* ------------------------------------------------------------------ */

function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script,iframe,object,embed,style,link,meta,form').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value || '';
      if (name.startsWith('on') || /javascript:/i.test(value) || (name === 'href' && /^data:/i.test(value))) {
        node.removeAttribute(attribute.name);
      }
    }
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noreferrer noopener');
    }
  });
  return template.innerHTML;
}

export function renderMarkdown(markdown) {
  const text = String(markdown || '');
  if (window.marked && typeof window.marked.parse === 'function') {
    return sanitizeHtml(window.marked.parse(text, { gfm: true, breaks: true }));
  }
  return `<pre style="white-space:pre-wrap;font-family:var(--sans)">${esc(text)}</pre>`;
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

export function initTheme() {
  let theme = 'light';
  try {
    theme = localStorage.getItem('atoms.theme') || 'light';
  } catch {
    theme = 'light';
  }
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('atoms.theme', next);
  } catch {
    /* ignore */
  }
  return next;
}

export function themeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return `<button class="theme-toggle" type="button" data-action="toggle-theme" aria-label="切换深浅色">${icon(dark ? 'sun' : 'moon')}</button>`;
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function brandMark(size = 32) {
  return `<span class="brand-mark" style="width:${size}px;height:${size}px" aria-hidden="true">
    <svg viewBox="0 0 32 32" fill="none"><ellipse cx="16" cy="16" rx="10" ry="4" transform="rotate(30 16 16)" stroke="currentColor" stroke-width="1.4"/><ellipse cx="16" cy="16" rx="10" ry="4" transform="rotate(-30 16 16)" stroke="currentColor" stroke-width="1.4"/><circle cx="16" cy="16" r="2.2" fill="currentColor"/></svg>
  </span>`;
}

export function thumbHtml(project, { eager = false } = {}) {
  const fallback = `<div class="thumb-fallback">${esc(project.emoji || '✦')}</div>`;
  if (!project.thumb) return fallback;
  return `${fallback}<img src="${attrs(project.thumb)}" alt="${attrs(project.name)} 的界面预览" loading="${eager ? 'eager' : 'lazy'}" onerror="this.remove()">`;
}

export function artifactLabel(kind) {
  return { prd: '需求文档', slides: '演示幻灯片', report: '验收报告' }[kind] || kind;
}

export function statusText(status) {
  return { ready: '已发布', generating: '生成中', error: '有错误', draft: '草稿' }[status] || status;
}

export function openShareFallback() {
  toast('当前环境不支持自动复制，请手动复制链接', 'error');
}
