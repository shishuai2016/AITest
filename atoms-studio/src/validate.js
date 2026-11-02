import vm from 'node:vm';
import { cleanRelPath, escapeHtml } from './util.js';

const LOCAL_ASSET_RE = /<(?:link|script|img)\b[^>]*(?:href|src)=["']([^"']+)["']/gi;

export function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["'](?:application\/ld\+json|application\/json)["']/i.test(attrs)) continue;
    scripts.push({ attrs, code: match[2] || '' });
  }
  return scripts;
}

export function extractLocalAssets(files) {
  const paths = new Set();
  for (const file of files) {
    if (!file.path.endsWith('.html')) continue;
    let match;
    LOCAL_ASSET_RE.lastIndex = 0;
    while ((match = LOCAL_ASSET_RE.exec(file.content)) !== null) {
      const ref = match[1].trim();
      if (/^(?:https?:)?\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('#')) continue;
      const clean = cleanRelPath(ref.split('?')[0].split('#')[0]);
      if (clean) paths.add(clean);
    }
  }
  return paths;
}

function jsSyntaxErrors(code) {
  if (!String(code || '').trim()) return [];
  try {
    // Module syntax is common in generated apps; strip import/export lines before
    // parsing with the classic script parser so we can still catch real syntax errors.
    const scrubbed = code
      .replace(/^\s*import\s+[^;\n]+;?\s*$/gm, '')
      .replace(/^\s*export\s+(default\s+)?/gm, '');
    // eslint-disable-next-line no-new
    new vm.Script(scrubbed, { filename: 'generated-app.js' });
    return [];
  } catch (error) {
    return [String(error.message || error).slice(0, 240)];
  }
}

export function validateFiles(files) {
  const errors = [];
  const warnings = [];
  const index = files.find((file) => file.path === 'index.html');
  if (!index) {
    return { ok: false, errors: ['缺少 index.html'], warnings };
  }
  if (index.content.length < 600) errors.push('index.html 内容过短，可能不是完整应用');
  if (!/<html[\s>]/i.test(index.content)) errors.push('index.html 缺少 <html> 结构');
  if (!/<body[\s>]/i.test(index.content)) errors.push('index.html 缺少 <body>');
  if (!/<title>[\s\S]*?\S[\s\S]*?<\/title>/i.test(index.content)) warnings.push('缺少页面 <title>');
  if (!/name=["']viewport["']/i.test(index.content)) warnings.push('缺少 viewport meta，移动端适配可能异常');

  const assetPaths = extractLocalAssets(files);
  for (const asset of assetPaths) {
    if (!files.some((file) => file.path === asset)) {
      errors.push(`引用了不存在的文件：${asset}`);
    }
  }

  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const file of files) {
    if (file.path.endsWith('.js')) {
      for (const message of jsSyntaxErrors(file.content)) errors.push(`${file.path} 语法错误：${message}`);
    }
    if (file.path.endsWith('.html')) {
      for (const script of extractInlineScripts(file.content)) {
        if (/(?:^|\s)type=["']module["']/i.test(script.attrs)) continue;
        for (const message of jsSyntaxErrors(script.code)) errors.push('内联脚本语法错误：' + message);
      }
    }
  }

  const html = index.content;
  if (!/atomsStore|localStorage/i.test(html) && !(byPath.get('app.js')?.content || '').match(/atomsStore|localStorage/i)) {
    warnings.push('未发现数据持久化调用（atomsStore / localStorage）');
  }
  if (/\bTODO\b|待补充|Lorem ipsum/i.test(files.map((f) => f.content).join('\n'))) {
    warnings.push('代码里含占位文案（TODO/Lorem ipsum）');
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function staticChecks(files) {
  const index = files.find((file) => file.path === 'index.html');
  const all = files.map((file) => file.content).join('\n');
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });

  add('files', '生成文件完整性', index ? 'pass' : 'fail', index ? `${files.length} 个文件 · ${(all.length / 1024).toFixed(1)} KB` : '缺少 index.html');
  add('doctype', 'HTML 文档结构', index && /^<!doctype html>/i.test(index.content.trim()) ? 'pass' : 'warn', '包含 doctype / html / body');
  add('viewport', '移动端适配基础', index && /name=["']viewport["']/i.test(index.content) ? 'pass' : 'warn', 'viewport meta');
  add('title', '页面标题', index && /<title>[^<]*\S[^<]*<\/title>/i.test(index.content) ? 'pass' : 'warn', '浏览器标签标题');

  const assetPaths = extractLocalAssets(files);
  const missing = [...assetPaths].filter((asset) => !files.some((file) => file.path === asset));
  add('assets', '本地资源引用', missing.length ? 'fail' : 'pass', missing.length ? `缺失：${missing.join(', ')}` : `${assetPaths.size} 个本地引用均可解析`);

  let syntaxErrors = [];
  for (const file of files) {
    if (file.path.endsWith('.js')) syntaxErrors.push(...jsSyntaxErrors(file.content));
    if (file.path.endsWith('.html')) {
      for (const script of extractInlineScripts(file.content)) {
        if (/(?:^|\s)type=["']module["']/i.test(script.attrs)) continue;
        syntaxErrors.push(...jsSyntaxErrors(script.code));
      }
    }
  }
  add('js', 'JavaScript 语法', syntaxErrors.length ? 'fail' : 'pass', syntaxErrors.length ? syntaxErrors[0] : '所有脚本通过语法解析');

  const external = all.match(/https?:\/\/[^\s"'<>)]+/g) || [];
  const externalFiltered = [...new Set(external.filter((url) => !url.includes('www.w3.org') && !url.includes('schema.org')))];
  add('offline', '离线可用性', externalFiltered.length ? 'warn' : 'pass', externalFiltered.length ? `发现 ${externalFiltered.length} 个外部资源` : '无外部 CDN/图片依赖');

  const persistence = /atomsStore/.test(all) ? 'pass' : /localStorage/.test(all) ? 'warn' : 'warn';
  add(
    'persistence',
    '数据持久化接入',
    persistence,
    /atomsStore/.test(all) ? '使用 Atoms 服务端存储' : /localStorage/.test(all) ? '使用浏览器 localStorage' : '未检测到持久化调用',
  );

  const html = index?.content || '';
  const buttonCount = (html.match(/<button\b/gi) || []).length;
  const inputCount = (html.match(/<(?:input|select|textarea)\b/gi) || []).length;
  add('interaction', '交互元素', buttonCount + inputCount >= 3 ? 'pass' : 'warn', `${buttonCount} 个按钮 · ${inputCount} 个表单控件`);

  const todo = /\bTODO\b|待补充|Lorem ipsum/i.test(all);
  add('content', '内容完整性', todo ? 'warn' : 'pass', todo ? '仍有占位内容' : '未发现占位内容');

  return checks;
}

export function previewDocument(html, { projectId, version, appName = 'App', runtimeBase = '' }) {
  const config = `<script>window.__ATOMS_APP__=${JSON.stringify({ projectId, version, appName }).replaceAll('<', '\\u003c')};</script>`;
  const runtime = `<script src="${runtimeBase}/atoms-runtime.js"></script>`;
  const injection = `\n${config}\n${runtime}\n`;
  let out = html;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head>${injection}</head>`);
  } else {
    out = `<head>${injection}</head>${out}`;
  }
  if (!/<body[\s>]/i.test(out)) {
    out = out.replace(/<\/html>$/i, `<body>${escapeHtml(appName)}</body></html>`);
  }
  return out;
}
