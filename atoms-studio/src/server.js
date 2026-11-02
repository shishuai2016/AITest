import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { DATA_DIR, get, all, run, jsonParse, newId } from './db.js';
import {
  addMessage,
  createProject,
  deleteProject,
  getArtifacts,
  getProject,
  getProjectBySlug,
  getVersion,
  listMessages,
  listProjectCards,
  projectCard,
  projectStats,
  saveVersion,
  updateProjectMeta,
} from './repo.js';
import { createJob, activeJobForProject, getJobRow, subscribeJob, finishJob } from './jobs.js';
import { runGeneration, generatePrd, generateSlides } from './agent.js';
import { llmStatus } from './llm.js';
import { buildReport, liveChecks } from './checks.js';
import { captureProjectShot, getShotPath } from './screenshot.js';
import { previewDocument, staticChecks } from './validate.js';
import { buildPptx } from './pptx.js';
import { bundleHtml, escapeHtml } from './util.js';
import { seedDatabase } from './seeds.js';

const PORT = Number(process.env.PORT || 4318);
const PUBLIC_DIR = path.resolve('public');
const app = express();
const require = createRequire(import.meta.url);
const MARKED_PATH = path.join(path.dirname(require.resolve('marked')), 'marked.umd.js');
const startedAt = Date.now();
let baseUrl = process.env.SELF_URL || `http://127.0.0.1:${PORT}`;
let activeGenerations = 0;
const DAILY_GENERATION_LIMIT = Number(process.env.DAILY_GENERATION_LIMIT || 12);

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie || '');
  let workspace = cookies.atoms_ws;
  if (!workspace || !/^[a-f0-9]{16,64}$/.test(workspace)) {
    workspace = crypto.randomBytes(12).toString('hex');
    res.cookie('atoms_ws', workspace, {
      maxAge: 365 * 24 * 3600 * 1000,
      sameSite: 'lax',
      httpOnly: false,
    });
  }
  req.workspaceId = workspace;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseCookies(header) {
  const out = {};
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return out;
}

function projectBundle(projectId) {
  const project = getProject(projectId);
  if (!project) return null;
  const version = project.current_version ? getVersion(projectId, project.current_version) : null;
  const artifacts = getArtifacts(projectId, project.current_version || 1);
  const versions = all(
    'SELECT number, summary, prompt, model, usage, created_at FROM versions WHERE project_id = ? ORDER BY number DESC',
    projectId,
  ).map((row) => ({
    number: row.number,
    summary: row.summary,
    prompt: row.prompt,
    model: row.model,
    usage: jsonParse(row.usage, {}),
    createdAt: row.created_at,
  }));
  return {
    project: {
      ...projectCard(project, artifacts),
      plan: version ? jsonParse(version.plan, '') : '',
      filesList: version ? jsonParse(version.files, []).map((file) => ({ path: file.path, size: file.content.length })) : [],
    },
    messages: listMessages(projectId),
    versions,
    current: version
      ? {
          number: version.number,
          files: jsonParse(version.files, []),
          summary: version.summary,
          checks: jsonParse(version.checks, []),
          createdAt: version.created_at,
          model: version.model,
        }
      : null,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      version: artifact.version,
      status: artifact.status,
      updatedAt: artifact.updatedAt,
      content: artifact.content,
    })),
    activeJob: activeJobForProject(projectId),
    llm: llmStatus(),
  };
}

function artifactOut(row) {
  if (!row) return row;
  return { ...row, content: jsonParse(row.content, {}) };
}

function generationUsageToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = get(
    "SELECT COUNT(*) AS n FROM versions WHERE model NOT IN ('seed','restore') AND created_at >= ?",
    start.toISOString(),
  );
  return row?.n || 0;
}

function quotaGuard(res) {
  if (!llmStatus().enabled) return true;
  const used = generationUsageToday();
  if (used >= DAILY_GENERATION_LIMIT) {
    res.status(429).json({
      error: `今天的演示生成额度已用完（${DAILY_GENERATION_LIMIT} 次）。你仍然可以打开示例应用、查看已有作品，或明天再来。`,
    });
    return false;
  }
  return true;
}

function friendlyError(error) {
  const message = String(error?.message || error);
  if (/AccountQuotaExceeded/i.test(message)) return '模型服务本月配额已用完，请稍后再试或配置其他模型。';
  if (/ModelNotOpen|InvalidEndpointOrModel/i.test(message)) return '模型尚未开通或不可用，请检查 ARK 模型配置。';
  if (/VALIDATION_FAILED/i.test(message)) return '智能体生成的代码未通过自动校验，请换一种描述重试。';
  if (/GENERATION_EMPTY/i.test(message)) return '智能体没有返回可用的应用文件，请重试。';
  if (/LLM_NOT_CONFIGURED/i.test(message)) return '未配置模型密钥。';
  return `生成失败：${message.slice(0, 160)}`;
}

function startGeneration({ projectId, prompt, kind }) {
  if (activeGenerations >= 3) {
    const error = new Error('BUSY');
    error.status = 429;
    throw error;
  }
  const jobId = createJob({ projectId, kind, prompt });
  activeGenerations += 1;
  runGeneration({ jobId, projectId, prompt, kind, baseUrl })
    .then((result) => {
      const card = projectCard(getProject(projectId), getArtifacts(projectId, result.version));
      emitDone(jobId, {
        version: { number: result.version, summary: result.summary },
        project: card,
        fallback: result.fallback,
      });
    })
    .catch((error) => {
      console.error('[generation]', error);
      emitDone(jobId, null, { error: friendlyError(error) });
    })
    .finally(() => {
      activeGenerations -= 1;
    });
  return jobId;
}

function emitDone(jobId, payload, failure) {
  if (failure) finishJob(jobId, 'error', { error: failure.error });
  else finishJob(jobId, 'done', payload);
}

function ensureVersionReport(projectId) {
  const project = getProject(projectId);
  if (!project || !project.current_version) return null;
  const version = getVersion(projectId, project.current_version);
  if (!version) return null;
  const files = jsonParse(version.files, []);
  const checks = jsonParse(version.checks, staticChecks(files));
  const report = buildReport({ project, version, checks });
  return { project, version, files, report };
}

const TEMPLATES = [
  {
    id: 'tasks',
    emoji: '◎',
    title: '个人任务管理器',
    category: '效率',
    prompt: '做一个安静的任务管理应用：可以添加、完成、筛选任务，带今日进度和完成率，数据要保存下来。视觉像一张干净的纸。',
  },
  {
    id: 'finance',
    emoji: '☕',
    title: '小店流水看板',
    category: '经营',
    prompt: '做一个咖啡店的每日流水看板：深色质感，展示今日营收、订单数、客单价、一周趋势图，可以记一笔订单并删除，支持分类筛选。',
  },
  {
    id: 'habit',
    emoji: '◌',
    title: '习惯打卡',
    category: '生活',
    prompt: '做一个习惯打卡应用：可添加多个习惯，展示最近 7 天打卡格，点击打卡；显示连续天数和 28 天热力图，界面温和有呼吸感。',
  },
  {
    id: 'dashboard',
    emoji: '▦',
    title: '团队数据看板',
    category: '数据',
    prompt: '做一个 SaaS 团队的数据看板：展示 MRR、活跃用户、转化率的 KPI，带趋势图和渠道分布，可以切换时间范围，视觉专业克制。',
  },
  {
    id: 'landing',
    emoji: '✦',
    title: '产品落地页',
    category: '营销',
    prompt: '为一个 AI 笔记工具做产品落地页：有 hero、功能三栏、用户评价、定价和 CTA，风格像一本现代杂志，文案要有说服力。',
  },
  {
    id: 'notes',
    emoji: '✎',
    title: '灵感便签',
    category: '生活',
    prompt: '做一个轻量的灵感便签应用：卡片式便签、标签筛选、搜索、置顶和删除，支持本地持久化，视觉温暖有纸张感。',
  },
];

/* ------------------------------ API ---------------------------------- */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round((Date.now() - startedAt) / 1000),
    llm: llmStatus(),
    projects: get('SELECT COUNT(*) AS n FROM projects')?.n || 0,
    versions: get('SELECT COUNT(*) AS n FROM versions')?.n || 0,
    time: new Date().toISOString(),
  });
});

app.get('/api/home', (req, res) => {
  const seeds = listProjectCards({ seeds: true, limit: 12 });
  const recent = listProjectCards({ seeds: false, limit: 8 });
  const used = generationUsageToday();
  res.json({
    seeds,
    recent,
    stats: projectStats(),
    templates: TEMPLATES,
    llm: { ...llmStatus(), usedToday: used, dailyLimit: DAILY_GENERATION_LIMIT, remaining: Math.max(0, DAILY_GENERATION_LIMIT - used) },
  });
});

app.get('/api/templates', (req, res) => res.json({ templates: TEMPLATES }));

app.post('/api/projects', (req, res) => {
  const prompt = String(req.body?.prompt || '').trim().slice(0, 2000);
  if (prompt.length < 4) return res.status(400).json({ error: '请至少写 4 个字描述你的想法。' });
  if (!quotaGuard(res)) return;
  const project = createProject({ prompt, workspaceId: req.workspaceId });
  addMessage({ projectId: project.id, role: 'user', content: prompt, kind: 'text' });
  const jobId = startGeneration({ projectId: project.id, prompt, kind: 'generate' });
  res.status(201).json({ project: projectCard(project), jobId });
});

app.get('/api/projects', (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const rows = all('SELECT * FROM projects ORDER BY is_seed DESC, updated_at DESC LIMIT ?', limit);
  res.json({
    projects: rows.map((row) => projectCard(row, getArtifacts(row.id, row.current_version))),
  });
});

app.get('/api/projects/:id', (req, res) => {
  const bundle = projectBundle(req.params.id);
  if (!bundle) return res.status(404).json({ error: '项目不存在' });
  res.json(bundle);
});

app.patch('/api/projects/:id', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const fields = {};
  if (typeof req.body?.name === 'string' && req.body.name.trim()) fields.name = req.body.name.trim().slice(0, 40);
  if (typeof req.body?.shareEnabled === 'boolean') fields.share_enabled = req.body.shareEnabled;
  updateProjectMeta(project.id, fields);
  res.json({ project: projectCard(getProject(project.id), getArtifacts(project.id, getProject(project.id).current_version)) });
});

app.delete('/api/projects/:id', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  if (project.is_seed) return res.status(403).json({ error: '示例项目不能删除' });
  deleteProject(project.id);
  res.json({ ok: true });
});

app.post('/api/projects/:id/messages', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const content = String(req.body?.content || '').trim().slice(0, 2000);
  if (content.length < 2) return res.status(400).json({ error: '请告诉智能体你想改什么。' });
  if (!quotaGuard(res)) return;
  const active = activeJobForProject(project.id);
  if (active) return res.status(409).json({ error: '智能体正在处理上一条需求，请稍候。', jobId: active });
  addMessage({ projectId: project.id, role: 'user', content, kind: 'text' });
  const kind = project.current_version > 0 ? 'iterate' : 'generate';
  const jobId = startGeneration({ projectId: project.id, prompt: content, kind });
  res.status(202).json({ jobId });
});

app.post('/api/projects/:id/versions/:number/restore', ah(async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const source = getVersion(project.id, Number(req.params.number));
  if (!source) return res.status(404).json({ error: '版本不存在' });
  const files = jsonParse(source.files, []);
  const checks = await liveChecks({
    projectId: project.id,
    version: Number(req.params.number),
    baseUrl,
    files,
    staticChecks: staticChecks(files),
  });
  const version = saveVersion({
    projectId: project.id,
    files,
    summary: `已恢复到 v${source.number} 的版本。`,
    plan: source.plan,
    prompt: `恢复版本 v${source.number}`,
    model: 'restore',
    usage: {},
    checks,
    design: { name: project.name },
  });
  addMessage({
    projectId: project.id,
    role: 'assistant',
    content: `已恢复到 v${source.number} 的文件内容，并发布为 v${version.number}。`,
    version: version.number,
    kind: 'restore',
    meta: { restoredFrom: source.number },
  });
  const report = buildReport({ project: getProject(project.id), version, checks });
  upsertReport(project.id, version.number, report);
  res.json({ version: { number: version.number }, project: projectCard(getProject(project.id), getArtifacts(project.id, version.number)) });
}));

app.get('/api/projects/:id/versions/:number', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const version = getVersion(project.id, Number(req.params.number));
  if (!version) return res.status(404).json({ error: '版本不存在' });
  res.json({
    number: version.number,
    summary: version.summary,
    plan: version.plan,
    files: jsonParse(version.files, []),
    checks: jsonParse(version.checks, []),
    model: version.model,
    createdAt: version.created_at,
  });
});

app.get('/api/jobs/:id', (req, res) => {
  const row = getJobRow(req.params.id);
  if (!row) return res.status(404).json({ error: '任务不存在' });
  res.json({
    id: row.id,
    status: row.status,
    steps: jsonParse(row.steps, []),
    streamTail: row.stream_tail,
    createdAt: row.created_at,
    error: row.error,
    version: row.version,
  });
});

app.get('/api/jobs/:id/events', (req, res) => subscribeJob(req.params.id, req, res));

app.get('/api/projects/:id/artifacts', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  res.json({ artifacts: getArtifacts(project.id, project.current_version) });
});

app.post('/api/projects/:id/artifacts/:kind', ah(async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  if (!project.current_version) return res.status(400).json({ error: '先生成一个版本，再来创建交付物。' });
  const kind = req.params.kind;
  const force = req.body?.force === true;
  if (kind === 'prd') return res.json({ artifact: artifactOut(await generatePrd({ projectId: project.id, force })) });
  if (kind === 'slides') return res.json({ artifact: artifactOut(await generateSlides({ projectId: project.id, force })) });
  if (kind === 'report') {
    const version = getVersion(project.id, project.current_version);
    const files = jsonParse(version.files, []);
    const checks = await liveChecks({
      projectId: project.id,
      version: version.number,
      baseUrl,
      files,
      staticChecks: staticChecks(files),
    });
    run('UPDATE versions SET checks = ? WHERE id = ?', JSON.stringify(checks), version.id);
    const report = buildReport({ project, version, checks });
    const artifact = upsertReport(project.id, version.number, report);
    return res.json({ artifact: artifactOut(artifact) });
  }
  return res.status(400).json({ error: '不支持的交付物类型' });
}));

app.get('/api/artifacts/:id', (req, res) => {
  const row = get('SELECT * FROM artifacts WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: '交付物不存在' });
  const project = getProject(row.project_id);
  res.json({
    artifact: {
      id: row.id,
      projectId: row.project_id,
      version: row.version,
      kind: row.kind,
      title: row.title,
      status: row.status,
      content: jsonParse(row.content, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    project: project ? { id: project.id, name: project.name, emoji: project.emoji, accent: project.accent } : null,
  });
});

app.get('/api/artifacts/:id/download', ah(async (req, res) => {
  const row = get('SELECT * FROM artifacts WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: '交付物不存在' });
  const content = jsonParse(row.content, {});
  const project = getProject(row.project_id);
  const format = String(req.query.format || '');
  if (row.kind === 'slides' && (format === 'pptx' || !format)) {
    const shot = getShotPath(project.id, row.version);
    const file = await buildPptx({ artifact: { ...row, content }, project, shotFile: shot });
    return res.download(file, `${safeFilename(project.name)}-演示幻灯片.pptx`);
  }
  if (row.kind === 'slides') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(project.name)}-slides.json"`);
    return res.send(JSON.stringify(content, null, 2));
  }
  const markdown = row.kind === 'prd' ? content.markdown || '' : content.markdown || '';
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(project.name)}-${row.kind === 'prd' ? 'PRD' : '验收报告'}.md"`);
  res.send(markdown || '暂无内容');
}));

app.get('/api/projects/:id/versions/:number/download', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const version = getVersion(project.id, Number(req.params.number));
  if (!version) return res.status(404).json({ error: '版本不存在' });
  const files = jsonParse(version.files, []);
  const html = bundleHtml(files, project.name);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(project.name)}.html"`);
  res.send(html);
});

app.post('/api/projects/:id/screenshot', ah(async (req, res) => {
  const project = getProject(req.params.id);
  if (!project || !project.current_version) return res.status(404).json({ error: '项目不存在' });
  await captureProjectShot(project.id, project.current_version, baseUrl);
  res.json({ ok: true, thumb: `/shots/${project.id}/${project.current_version}.png?v=${Date.now()}` });
}));

/* --------------------------- app data store --------------------------- */

function validStoreKey(key) {
  return /^[a-zA-Z0-9._-]{1,80}$/.test(String(key || ''));
}

app.get('/api/apps/:projectId/store', (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: '应用不存在' });
  const rows = all('SELECT key, value FROM app_store WHERE project_id = ? ORDER BY updated_at DESC LIMIT 200', project.id);
  const items = {};
  for (const row of rows) items[row.key] = jsonParse(row.value, null);
  res.json({ items });
});

app.get('/api/apps/:projectId/store/:key', (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: '应用不存在' });
  if (!validStoreKey(req.params.key)) return res.status(400).json({ error: 'key 不合法' });
  const row = get('SELECT value, updated_at FROM app_store WHERE project_id = ? AND key = ?', project.id, req.params.key);
  if (!row) return res.status(404).json({ error: '没有这个 key', key: req.params.key });
  res.json({ key: req.params.key, value: jsonParse(row.value, null), updatedAt: row.updated_at });
});

app.put('/api/apps/:projectId/store/:key', (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: '应用不存在' });
  if (!validStoreKey(req.params.key)) return res.status(400).json({ error: 'key 不合法' });
  const value = req.body?.value;
  if (value === undefined) return res.status(400).json({ error: '缺少 value' });
  const serialized = JSON.stringify(value);
  if (serialized.length > 64 * 1024) return res.status(413).json({ error: '单条数据不能超过 64KB' });
  const at = new Date().toISOString();
  run(
    `INSERT INTO app_store (project_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    project.id,
    req.params.key,
    serialized,
    at,
  );
  res.json({ ok: true, key: req.params.key, updatedAt: at });
});

app.delete('/api/apps/:projectId/store/:key', (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: '应用不存在' });
  if (!validStoreKey(req.params.key)) return res.status(400).json({ error: 'key 不合法' });
  run('DELETE FROM app_store WHERE project_id = ? AND key = ?', project.id, req.params.key);
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

/* ------------------------------ preview ------------------------------- */

app.get('/preview/:projectId/:version', (req, res, next) => {
  if (req.path.endsWith('/')) return next();
  return res.redirect(301, `/preview/${req.params.projectId}/${req.params.version}/`);
});

app.get('/preview/:projectId/:version/*', (req, res, next) => {
  const project = getProject(req.params.projectId);
  if (!project) return next();
  const version = getVersion(project.id, Number(req.params.version));
  if (!version) return next();
  const files = jsonParse(version.files, []);
  let requested = req.params[0] || 'index.html';
  if (requested.endsWith('/')) requested += 'index.html';
  let file = files.find((item) => item.path === requested);
  if (!file && !path.extname(requested)) {
    file = files.find((item) => item.path === 'index.html');
    requested = 'index.html';
  }
  if (!file) return next();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (file.path.endsWith('.html')) {
    const html = previewDocument(file.content, {
      projectId: project.id,
      version: version.number,
      appName: project.name,
      runtimeBase: '',
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  res.setHeader('Content-Type', contentTypeFor(file.path));
  if (file.path.endsWith('.css')) res.setHeader('Cache-Control', 'no-store');
  res.send(file.content);
});

app.use('/preview', (req, res) => res.status(404).send(renderMessagePage('预览不存在', '这个版本可能已经被移除，回到工作室看看最新版本。')));

app.get('/shots/:projectId/:file', ah(async (req, res) => {
  const match = String(req.params.file).match(/^(\d+)\.png$/);
  if (!match) return res.status(404).end();
  const version = Number(match[1]);
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).end();
  let file = getShotPath(project.id, version);
  if (!file && project.current_version === version) {
    try {
      file = await captureProjectShot(project.id, version, baseUrl);
    } catch {
      return res.status(404).end();
    }
  }
  if (!file) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(file);
}));

/* ----------------------------- share page ---------------------------- */

app.get('/s/:slug', (req, res, next) => {
  const project = getProjectBySlug(req.params.slug);
  if (!project) return next();
  if (!project.share_enabled) {
    return res.status(403).send(renderMessagePage('预览未公开', '这个应用还没有开启公开分享。', project));
  }
  if (!project.current_version) {
    return res.status(404).send(renderMessagePage('还在生成中', '这个应用还没有可预览的版本，请稍后再来。', project));
  }
  const protocol = req.protocol || 'http';
  const host = req.get('host');
  const shot = getShotPath(project.id, project.current_version);
  const image = shot ? `${protocol}://${host}/shots/${project.id}/${project.current_version}.png` : '';
  const previewUrl = `/preview/${project.id}/${project.current_version}/`;
  const appUrl = `${protocol}://${host}/s/${project.slug}/raw`;
  res.setHeader('Cache-Control', 'no-store');
  res.send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(project.name)} · 由 Atoms Studio 生成</title>
<meta name="description" content="${escapeHtml(project.summary || project.prompt)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(project.name)}">
<meta property="og:description" content="${escapeHtml(project.summary || project.prompt)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
<meta name="theme-color" content="${escapeHtml(project.accent)}">
<style>
  *{box-sizing:border-box}html,body{margin:0;height:100%;background:#f6f4ef;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff}
  .badge{position:fixed;left:18px;bottom:18px;z-index:10;display:flex;align-items:center;gap:10px;padding:9px 14px 9px 10px;border-radius:999px;background:rgba(22,21,19,.9);color:#fff;text-decoration:none;font-size:12px;backdrop-filter:blur(10px);box-shadow:0 10px 30px -10px rgba(0,0,0,.4);transition:transform .18s ease,background .18s ease}
  .badge:hover{transform:translateY(-2px);background:#161513}
  .badge .mark{width:22px;height:22px;border-radius:50%;border:1px solid rgba(255,255,255,.4);display:grid;place-items:center;font-size:11px;color:#d9f26a}
  .badge b{font-weight:600}.badge span{color:#a9a49b}
  .open{position:fixed;right:18px;bottom:18px;z-index:10;padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.92);color:#161513;text-decoration:none;font-size:12px;border:1px solid rgba(0,0,0,.08);box-shadow:0 10px 30px -14px rgba(0,0,0,.35)}
  .open:hover{background:#fff}
  @media(max-width:560px){.badge{left:10px;bottom:10px;padding:8px 12px 8px 8px;font-size:11px}.open{right:10px;bottom:10px;font-size:11px}}
</style></head>
<body>
<iframe src="${previewUrl}" title="${escapeHtml(project.name)}" allow="clipboard-write; fullscreen"></iframe>
<a class="badge" href="/?from=share"><span class="mark">✦</span><b>Atoms Studio</b><span>生成</span></a>
<a class="open" href="/studio/${project.id}">在工作室中打开 ↗</a>
<script>window.__APP_URL__=${JSON.stringify(appUrl)};</script>
</body></html>`);
});

app.get('/s/:slug/raw', (req, res, next) => {
  const project = getProjectBySlug(req.params.slug);
  if (!project || !project.current_version || !project.share_enabled) return next();
  res.redirect(`/preview/${project.id}/${project.current_version}/`);
});

/* ------------------------------ static ------------------------------- */

app.get('/vendor/marked.min.js', (req, res) => {
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.sendFile(MARKED_PATH);
});
app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: 0, index: false }));
app.get('/atoms-runtime.js', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'atoms-runtime.js')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'favicon.svg')));

app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((error, req, res, next) => {
  console.error('[server]', error);
  if (res.headersSent) return next(error);
  if (req.path.startsWith('/api/')) {
    return res.status(error.status || 500).json({ error: friendlyError(error) });
  }
  res.status(error.status || 500).send(renderMessagePage('出了点问题', friendlyError(error)));
});

/* ------------------------------ helpers ------------------------------ */

function safeFilename(name) {
  return String(name || 'app').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
}

function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
      '.txt': 'text/plain; charset=utf-8',
    }[ext] || 'application/octet-stream'
  );
}

function upsertReport(projectId, version, report) {
  const at = new Date().toISOString();
  const existing = get('SELECT id FROM artifacts WHERE project_id = ? AND version = ? AND kind = ?', projectId, version, 'report');
  if (existing) {
    run('UPDATE artifacts SET title = ?, content = ?, updated_at = ? WHERE id = ?', `v${version} 验收报告`, JSON.stringify(report), at, existing.id);
    return { id: existing.id, projectId, version, kind: 'report', title: `v${version} 验收报告`, status: 'ready', content: report, createdAt: at, updatedAt: at };
  }
  const id = newId('art_');
  run(
    'INSERT INTO artifacts (id, project_id, version, kind, title, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    projectId,
    version,
    'report',
    `v${version} 验收报告`,
    JSON.stringify(report),
    'ready',
    at,
    at,
  );
  return { id, projectId, version, kind: 'report', title: `v${version} 验收报告`, status: 'ready', content: report, createdAt: at, updatedAt: at };
}

function renderMessagePage(title, message, project) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Atoms Studio</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4ef;color:#161513;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;padding:24px}.card{max-width:420px;background:#fffdf8;border:1px solid #e7e1d5;border-radius:20px;padding:32px;text-align:center;box-shadow:0 30px 70px -50px rgba(0,0,0,.5)}.mark{width:44px;height:44px;border-radius:50%;border:1px solid #161513;display:grid;place-items:center;margin:0 auto 16px;color:#4f46e5;font-size:18px}h1{font-size:22px;margin:0 0 8px}p{color:#6f6a61;font-size:13px;line-height:1.7;margin:0 0 20px}a{display:inline-block;background:#161513;color:#fff;text-decoration:none;border-radius:999px;padding:10px 18px;font-size:12px}</style></head>
<body><div class="card"><div class="mark">✦</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="/">回到 Atoms Studio</a></div></body></html>`;
}

/* ------------------------------ startup ------------------------------ */

const created = seedDatabase();
app.listen(PORT, '0.0.0.0', () => {
  baseUrl = process.env.SELF_URL || `http://127.0.0.1:${PORT}`;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, 'server-info.json'),
    JSON.stringify({ port: PORT, pid: process.pid, startedAt: new Date().toISOString(), url: baseUrl }, null, 2),
  );
  const l = llmStatus();
  console.log(`\n  ✦ Atoms Studio`);
  console.log(`  local   ${baseUrl}`);
  console.log(`  llm     ${l.enabled ? 'enabled · ' + l.model : 'disabled · local fallback'}`);
  console.log(`  data    ${path.resolve(DATA_DIR, 'atoms.db')}`);
  console.log(`  seeds   ${get('SELECT COUNT(*) AS n FROM projects WHERE is_seed = 1')?.n || 0} (${created} new)\n`);
  refreshSeedShowcase().catch((error) => console.error('[seed-refresh]', error));
});

async function refreshSeedShowcase() {
  const seeds = all('SELECT * FROM projects WHERE is_seed = 1 ORDER BY created_at ASC');
  for (const project of seeds) {
    if (!project.current_version) continue;
    const version = getVersion(project.id, project.current_version);
    if (!version) continue;
    const files = jsonParse(version.files, []);
    try {
      const checks = await liveChecks({ projectId: project.id, version: version.number, baseUrl, files, staticChecks: staticChecks(files) });
      run('UPDATE versions SET checks = ? WHERE id = ?', JSON.stringify(checks), version.id);
      const report = buildReport({ project, version, checks });
      upsertReport(project.id, version.number, report);
    } catch (error) {
      console.error('[seed-checks]', project.slug, error.message);
    }
    captureProjectShot(project.id, version.number, baseUrl).catch((error) => console.error('[seed-shot]', project.slug, error.message));
  }
}

process.on('SIGINT', () => {
  console.log('\n  bye.');
  process.exit(0);
});
process.on('SIGTERM', () => process.exit(0));
process.on('unhandledRejection', (error) => console.error('[unhandled]', error));
