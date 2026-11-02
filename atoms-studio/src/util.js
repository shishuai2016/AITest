import crypto from 'node:crypto';

export const uid = (prefix = '') => prefix + crypto.randomBytes(9).toString('hex');
export const nowIso = () => new Date().toISOString();

export function slugify(input, suffix = '') {
  const base = String(input || 'app')
    .toLowerCase()
    .replace(/[\u4e00-\u9fa5]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const tail = suffix || crypto.randomBytes(3).toString('hex');
  return `${base || 'app'}-${tail}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function parseJsonLoose(text, fallback = null) {
  if (!text) return fallback;
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* ignore */
      }
    }
    return fallback;
  }
}

const FILE_RE = /<atoms\s+file\s+path\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/atoms\s+file>/gi;
const PLAN_RE = /<atoms\s+plan>([\s\S]*?)<\/atoms\s+plan>/i;
const SUMMARY_RE = /<atoms\s+summary>([\s\S]*?)<\/atoms\s+summary>/i;

export function parseFiles(raw) {
  const text = String(raw || '');
  const files = [];
  let match;
  FILE_RE.lastIndex = 0;
  while ((match = FILE_RE.exec(text)) !== null) {
    const path = cleanRelPath(match[1]);
    const content = stripOuterFence(match[2]);
    if (path && content) files.push({ path, content });
  }
  if (!files.length) {
    // Fallback: model returned a fenced HTML document without markers.
    const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (fenced && /<html[\s>]/i.test(fenced[1])) {
      files.push({ path: 'index.html', content: fenced[1].trim() });
    }
  }
  const planMatch = text.match(PLAN_RE);
  const summaryMatch = text.match(SUMMARY_RE);
  return {
    files: dedupeFiles(files),
    plan: planMatch ? planMatch[1].trim() : '',
    summary: summaryMatch ? summaryMatch[1].trim() : '',
  };
}

function stripOuterFence(content) {
  let out = String(content || '').replace(/^\n+/, '').replace(/\s+$/, '');
  const fence = out.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/);
  if (fence) out = fence[1];
  return out;
}

export function cleanRelPath(path) {
  const clean = String(path || '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.?\//, '')
    .replace(/\.\.(\/|$)/g, '');
  if (!clean || clean.length > 120) return '';
  if (!/^[a-zA-Z0-9._\-/]+$/.test(clean)) return '';
  return clean.replace(/\/+/g, '/');
}

function dedupeFiles(files) {
  const map = new Map();
  for (const file of files) map.set(file.path, file);
  return [...map.values()];
}

export function contentTypeFor(path) {
  const ext = path.split('.').pop().toLowerCase();
  return (
    {
      html: 'text/html; charset=utf-8',
      css: 'text/css; charset=utf-8',
      js: 'text/javascript; charset=utf-8',
      json: 'application/json; charset=utf-8',
      svg: 'image/svg+xml',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      ico: 'image/x-icon',
      woff2: 'font/woff2',
      txt: 'text/plain; charset=utf-8',
      md: 'text/markdown; charset=utf-8',
      map: 'application/json; charset=utf-8',
    }[ext] || 'application/octet-stream'
  );
}

/**
 * Bundle a generated multi-file app into one self-contained HTML document.
 * Only local css/js files are inlined; external URLs are left untouched.
 */
export function bundleHtml(files, appName = 'App') {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const index = files.find((f) => f.path === 'index.html') || files[0];
  if (!index) return '';
  let html = index.content;
  html = html.replace(
    /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
    (full, href) => {
      const file = byPath.get(cleanRelPath(href));
      return file ? `<style>\n${file}\n</style>` : full;
    },
  );
  html = html.replace(
    /<script\b([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi,
    (full, pre, src, post) => {
      const file = byPath.get(cleanRelPath(src));
      if (!file) return full;
      const attrs = `${pre} ${post}`.replace(/\s+/g, ' ').trim();
      return `<script ${attrs}>\n${file}\n</script>`;
    },
  );
  if (!/<title>/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1><title>${escapeHtml(appName)}</title>`);
  return html;
}

export function truncate(text, max = 8000) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}\n…(已截断)` : value;
}

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}
