import { chat, llmStatus } from './llm.js';
import { staticChecks, validateFiles } from './validate.js';
import {
  addMessage,
  getProject,
  getVersion,
  saveVersion,
  updateProjectMeta,
  updateProjectStatus,
} from './repo.js';
import { emitJobEvent } from './jobs.js';
import { parseFiles, parseJsonLoose, truncate } from './util.js';
import { fallbackFiles } from './fallback.js';
import { buildReport, liveChecks } from './checks.js';
import { captureProjectShot } from './screenshot.js';
import { upsertArtifact, getArtifacts } from './repo.js';

const STEP_DEFS = [
  { id: 'understand', label: '理解想法', detail: '解析场景、角色与核心诉求' },
  { id: 'design', label: '设计产品', detail: '确定信息架构与界面方向' },
  { id: 'build', label: '编写代码', detail: '生成页面、样式与交互逻辑' },
  { id: 'verify', label: '自检与联调', detail: '语法检查、预览渲染、持久化验证' },
  { id: 'publish', label: '发布预览', detail: '保存版本并生成分享链接' },
];

function makeSteps() {
  return STEP_DEFS.map((step, index) => ({ ...step, status: index === 0 ? 'active' : 'pending' }));
}

function setStep(steps, id, status, detail) {
  const step = steps.find((item) => item.id === id);
  if (!step) return steps;
  step.status = status;
  if (detail) step.detail = detail;
  const next = steps.find((item) => item.status === 'active');
  if (!next && status === 'done') {
    const currentIndex = steps.findIndex((item) => item.id === id);
    const upcoming = steps[currentIndex + 1];
    if (upcoming) upcoming.status = 'active';
  }
  return steps;
}

function emitSteps(jobId, steps, status = 'running') {
  emitJobEvent(jobId, { type: 'steps', steps: JSON.parse(JSON.stringify(steps)), status });
}

function notice(jobId, message, level = 'warn') {
  emitJobEvent(jobId, { type: 'notice', level, message });
}

const PLANNER_SYSTEM = `你是 Atoms Studio 的产品策划。根据用户的想法，设计一个能被真正使用、值得演示的网页应用。
只输出一个 JSON 对象，不要任何解释、Markdown 或代码围栏。字段：
{
  "name": "2-6 个中文字的产品名，有记忆点，不要用「智能」「助手」凑数",
  "tagline": "12 字以内的一句话定位",
  "description": "40 字以内的产品描述",
  "emoji": "一个最贴合产品的 emoji",
  "accent": "从 #5B5BD6 #E0562B #0F766E #B4457A #1D4ED8 #D97706 里选一个主色",
  "category": "2-4 个字，如 效率工具 / 数据分析 / 生活方式 / 团队协作",
  "features": ["3-5 个核心功能，每条不超过 18 字"],
  "storeKeys": ["建议的持久化 key，英文 camelCase，2-4 个"],
  "plan": ["3-4 条实现步骤，每条不超过 26 字，动词开头"]
}
数据持久化能力由预览环境注入的 atomsStore 提供（写入服务端），不要建议或提及 localStorage、浏览器本地存储。`;

const CODER_SYSTEM = `你是 Atoms Studio 的首席产品工程师，擅长把一个中文想法变成可以直接运行、可以演示、有真实质感的网页应用。你要交付的不只是原型，而是一个看起来像成熟产品的单页应用。

# 输出协议（必须严格遵守）
只输出下面这些标签，不要任何前言、解释、道歉、Markdown 代码围栏或标签之外的文字：
<atoms plan>
- 用 3-4 条中文短句说明这一版的实现方案
</atoms plan>
<atoms summary>一句中文，说明这一版做成了什么，不超过 40 字</atoms summary>
<atoms file path="index.html">
完整的 index.html
</atoms file>
<atoms file path="styles.css">
完整的 styles.css
</atoms file>
<atoms file path="app.js">
完整的 app.js
</atoms file>

# 工程约束（硬性）
1. 必须恰好输出 index.html、styles.css、app.js 三个完整文件；index.html 通过 <link rel="stylesheet" href="styles.css"> 和 <script src="app.js" defer></script> 引用另外两个文件。
2. 禁止任何外部依赖：不得引用 CDN、外部字体、外部图片、第三方脚本或图标库。图标一律用内联 SVG 或 emoji。不要用 Tailwind、React、Vue。
3. 应用必须真实可用：所有按钮、表单、筛选、开关都要有实际行为，不能是装饰。至少包含一个新增/编辑/删除类操作和一个可感知的状态变化。
4. 数据必须持久化：使用服务端提供的全局对象 atomsStore。它已由预览环境注入，API 为：
   await atomsStore.get(key, fallbackValue)  // 读取，不存在时返回 fallback
   await atomsStore.set(key, value)          // 写入任意可 JSON 序列化的值
   await atomsStore.del(key)                 // 删除
   await atomsStore.list()                   // 读取全部 key/value
   首次加载请使用合理的演示数据，让页面一打开就有内容；用户的操作写入 atomsStore。
   同时在 app.js 顶部做兜底：const store = window.atomsStore || { get: async (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } }, set: async (k, v) => localStorage.setItem(k, JSON.stringify(v)), del: async (k) => localStorage.removeItem(k), list: async () => ({}) };
   然后统一使用 store。
5. 中文界面，文案具体、有人味，不要出现「Lorem ipsum」「TODO」「待补充」。
6. 响应式：在 390px、768px、1440px 宽度下都可用；不要横向滚动。
7. 无障碍：按钮/输入有可读标签，键盘可操作，焦点可见；不要用 alert / confirm / prompt，改用页面内的 toast 或 dialog。
8. 安全：渲染用户输入时使用 textContent 或转义，禁止把用户输入直接拼进 innerHTML。
9. 性能与体量：总量控制在 1200 行以内，避免无意义的大段重复 CSS。
10. 不要输出 base64 图片或超长 SVG。

# 设计与体验要求
- 有明确的设计方向：先选一个符合产品气质的视觉概念（例如编辑部纸张感、深夜数据终端、温暖手账、冷静 SaaS），再用统一的色彩、字体层级、留白、圆角、边框和微交互把它贯彻到底。
- 避免「白底 + 紫色渐变 + 一排圆角卡片」的通用 AI 模板感。背景要有层次（微妙的渐变、噪点或网格），主色只用于强调，正文对比度要足够。
- 使用 system-ui 字体栈（-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif），数字可使用 font-variant-numeric。
- 信息密度合理：有顶部品牌区、核心操作区、内容区和空状态；不要把所有内容堆在一屏。
- 加入有意义的过渡/悬停/按压反馈，但不要浮夸动画；支持 prefers-reduced-motion。
- 数据展示优先用 CSS/内联 SVG 绘制（柱状图、环形进度、热力格），不要引图表库。
- 首次加载要有轻量 loading（骨架或淡入），避免闪烁。

# 迭代规则
如果用户提供了「当前版本文件」，请输出修改后的完整三个文件，而不是 diff；保留没有被要求改变的功能和视觉方向，只做必要的修复与增强。`;

function designFromPrompt(prompt, project) {
  return {
    name: project.name || '新应用',
    tagline: '',
    description: '',
    emoji: project.emoji || '✦',
    accent: project.accent || '#5B5BD6',
    category: project.category || '应用',
    features: [],
    plan: [],
  };
}

export async function planProduct({ prompt, project, previous }) {
  if (!llmStatus().enabled || previous) return designFromPrompt(prompt, project);
  try {
    const result = await chat({
      messages: [
        { role: 'system', content: PLANNER_SYSTEM },
        { role: 'user', content: `用户的想法：\n${prompt}\n\n请设计这个产品。只输出 JSON。` },
      ],
      maxTokens: 900,
      temperature: 0.8,
      purpose: 'plan',
      projectId: project.id,
    });
    const design = parseJsonLoose(result.text, null);
    if (!design || !design.name) return designFromPrompt(prompt, project);
    const normalize = (value) => String(value).replace(/本地持久化|本地持久保存|浏览器本地存储|localStorage/gi, '服务端持久化');
    return {
      name: String(design.name).slice(0, 24),
      tagline: normalize(design.tagline || '').slice(0, 30),
      description: normalize(design.description || '').slice(0, 80),
      emoji: String(design.emoji || '✦').slice(0, 4),
      accent: /^#[0-9a-f]{6}$/i.test(design.accent) ? design.accent : '#5B5BD6',
      category: String(design.category || '应用').slice(0, 12),
      features: (Array.isArray(design.features) ? design.features : []).slice(0, 5).map((item) => normalize(item)),
      storeKeys: (Array.isArray(design.storeKeys) ? design.storeKeys : []).slice(0, 4).map(String),
      plan: (Array.isArray(design.plan) ? design.plan : []).slice(0, 4).map((item) => normalize(item)),
    };
  } catch (error) {
    return designFromPrompt(prompt, project);
  }
}

function filesForPrompt(files) {
  return files
    .map((file) => `<atoms file path="${file.path}">\n${file.content}\n</atoms file>`)
    .join('\n\n');
}

function buildCoderMessages({ project, prompt, design, previousFiles, previousSummary, kind }) {
  const userParts = [
    `产品名：${design.name || project.name}`,
    design.tagline ? `一句话定位：${design.tagline}` : '',
    design.description ? `产品描述：${design.description}` : '',
    design.features?.length ? `核心功能：\n${design.features.map((feature) => `- ${feature}`).join('\n')}` : '',
    design.plan?.length ? `实现步骤：\n${design.plan.map((step) => `- ${step}`).join('\n')}` : '',
    `用户最初的想法：\n${project.prompt || prompt}`,
  ].filter(Boolean);

  if (previousFiles?.length) {
    userParts.push(
      `当前版本 v${project.current_version} 的完整文件：\n\n${filesForPrompt(previousFiles)}`,
      previousSummary ? `当前版本说明：${previousSummary}` : '',
      `本次修改要求：\n${prompt}`,
      '请基于当前版本完整重写三个文件，保留未要求改变的部分，并确保所有旧功能仍然可用。',
    );
  } else {
    userParts.push(
      `本次要求：\n${prompt}`,
      '这是第一个版本。请直接生成完整应用，并在首次加载时准备一份能让页面显得真实可用的演示数据。',
    );
  }

  return [
    { role: 'system', content: CODER_SYSTEM },
    { role: 'user', content: userParts.filter(Boolean).join('\n\n') },
  ];
}

async function callCoder({ jobId, messages, projectId, maxTokens = 16000 }) {
  let streamed = 0;
  const result = await chat({
    messages,
    maxTokens,
    temperature: 0.72,
    stream: true,
    purpose: 'generate-code',
    projectId,
    onDelta: (text) => {
      streamed += text.length;
      emitJobEvent(jobId, { type: 'delta', text });
    },
  });
  return { ...result, streamed };
}

function repairMessages(messages, errors, raw) {
  return [
    ...messages,
    { role: 'assistant', content: truncate(raw, 24000) },
    {
      role: 'user',
      content: `上面的输出无法通过自动校验：\n${errors.map((error) => `- ${error}`).join('\n')}\n\n请重新输出完整、可运行的三个文件。必须严格遵守文件标签格式，不要输出标签之外的任何内容，也不要使用 Markdown 围栏。`,
    },
  ];
}

export async function runGeneration({ jobId, projectId, prompt, kind = 'generate', baseUrl }) {
  const project = getProject(projectId);
  if (!project) throw new Error('PROJECT_NOT_FOUND');
  const isIterate = kind === 'iterate' && project.current_version > 0;
  const previousVersion = isIterate ? getVersion(projectId, project.current_version) : null;
  const previousFiles = previousVersion ? JSON.parse(previousVersion.files) : [];
  const steps = makeSteps();
  emitSteps(jobId, steps);
  updateProjectStatus(projectId, 'generating');

  try {
    // 1. Understand
    setStep(steps, 'understand', 'done', '已提取核心场景与目标用户');
    emitSteps(jobId, steps);

    // 2. Design
    setStep(steps, 'design', 'active');
    emitSteps(jobId, steps);
    const design = await planProduct({ prompt, project, previous: isIterate });
    if (!isIterate && design.name) {
      updateProjectMeta(projectId, {
        name: design.name,
        summary: design.description || design.tagline || '',
        emoji: design.emoji || project.emoji,
        accent: design.accent || project.accent,
        category: design.category || project.category,
      });
      project.name = design.name;
      project.emoji = design.emoji || project.emoji;
      project.accent = design.accent || project.accent;
    }
    emitJobEvent(jobId, { type: 'design', design });
    setStep(steps, 'design', 'done', design.tagline || '已完成信息架构与视觉方向');
    setStep(steps, 'build', 'active');
    emitSteps(jobId, steps);

    // 3. Build
    const coderMessages = buildCoderMessages({ project, prompt, design, previousFiles, previousSummary: previousVersion?.summary, kind });
    let parsed;
    let validation;
    let llmResult = null;
    let fallback = false;

    if (llmStatus().enabled) {
      try {
        llmResult = await callCoder({ jobId, messages: coderMessages, projectId });
        parsed = parseFiles(llmResult.text);
        validation = validateFiles(parsed.files);
        if (!validation.ok) {
          notice(jobId, `自动校验发现 ${validation.errors.length} 个问题，正在让智能体修复…`, 'warn');
          const repair = await callCoder({
            jobId,
            messages: repairMessages(coderMessages, validation.errors, llmResult.text),
            projectId,
            maxTokens: 16000,
          });
          const repaired = parseFiles(repair.text);
          const repairedValidation = validateFiles(repaired.files);
          if (repairedValidation.ok || repaired.files.length >= validation.errors.length + 1) {
            parsed = repaired;
            validation = repairedValidation;
            llmResult = { ...repair, usage: mergeUsage(llmResult.usage, repair.usage) };
          }
        }
        if (!validation.ok) throw new Error(`VALIDATION_FAILED: ${validation.errors.join('; ')}`);
      } catch (error) {
        fallback = true;
        notice(jobId, `AI 服务暂时不可用（${String(error.message || error).slice(0, 90)}），已切换到内置演示引擎。`, 'warn');
      }
    } else {
      notice(jobId, '未配置模型密钥，本次使用内置演示引擎生成。', 'info');
    }

    if (fallback || !llmStatus().enabled) {
      const local = fallbackFiles(prompt, design);
      parsed = { files: local.files, plan: local.plan, summary: local.summary };
      validation = validateFiles(parsed.files);
      fallback = true;
    }

    if (!parsed?.files?.length || !parsed.files.some((file) => file.path === 'index.html')) {
      throw new Error('GENERATION_EMPTY');
    }

    const checks = staticChecks(parsed.files);
    setStep(steps, 'build', 'done', `已生成 ${parsed.files.length} 个文件`);
    setStep(steps, 'verify', 'active', '正在渲染预览并验证数据持久化');
    emitSteps(jobId, steps);

    // 4. Save + live verification
    const summary = (parsed.summary || (isIterate ? '已按你的要求更新应用。' : '应用已生成，可以直接预览。')).replace(/本地持久化|本地持久保存|浏览器本地存储|localStorage/gi, '服务端持久化');
    const version = saveVersion({
      projectId,
      files: parsed.files,
      summary,
      plan: parsed.plan || design.plan?.join('\n') || '',
      prompt,
      model: fallback ? 'local-demo-engine' : llmResult?.model || 'mock',
      usage: llmResult?.usage || {},
      checks,
      design: isIterate ? { name: project.name } : design,
    });

    const live = await liveChecks({
      projectId,
      version: version.number,
      baseUrl,
      files: parsed.files,
      staticChecks: checks,
    });
    const report = buildReport({ project, version, checks: live });
    upsertArtifact({
      projectId,
      version: version.number,
      kind: 'report',
      title: `v${version.number} 验收报告`,
      content: report,
    });
    // Persist the merged checks on the version row for the version list.
    const { run } = await import('./db.js');
    run('UPDATE versions SET checks = ? WHERE id = ?', JSON.stringify(live), version.id);

    setStep(steps, 'verify', report.summary.failed > 0 ? 'error' : 'done', report.summary.failed > 0 ? `${report.summary.failed} 项未通过` : `${report.summary.passed}/${report.summary.total} 项检查通过`);
    setStep(steps, 'publish', 'active', '正在生成分享预览');
    emitSteps(jobId, steps);

    // Thumbnail capture is best effort; never block publishing on it.
    captureProjectShot(projectId, version.number, baseUrl).catch(() => {});

    addMessage({
      projectId,
      role: 'assistant',
      content: summary,
      version: version.number,
      kind: fallback ? 'fallback' : 'app',
      meta: {
        model: fallback ? 'local-demo-engine' : llmResult?.model,
        usage: llmResult?.usage || {},
        plan: parsed.plan || design.plan || [],
        design,
        fallback,
        checks: report.summary,
        files: parsed.files.map((file) => ({ path: file.path, size: file.content.length })),
      },
    });

    setStep(steps, 'publish', 'done', `v${version.number} 已发布，可分享预览`);
    emitSteps(jobId, steps, 'done');
    updateProjectStatus(projectId, 'ready');
    emitJobEvent(jobId, { type: 'version', version: { number: version.number, summary } });
    return { version: version.number, summary, fallback, project: getProject(projectId) };
  } catch (error) {
    updateProjectStatus(projectId, 'error');
    const failedStep = steps.find((step) => step.status === 'active');
    if (failedStep) failedStep.status = 'error';
    emitSteps(jobId, steps, 'error');
    throw error;
  }
}

function mergeUsage(a = {}, b = {}) {
  return {
    prompt_tokens: (a.prompt_tokens || 0) + (b.prompt_tokens || 0),
    completion_tokens: (a.completion_tokens || 0) + (b.completion_tokens || 0),
    total_tokens: (a.total_tokens || 0) + (b.total_tokens || 0),
  };
}

/* ------------------------------------------------------------------ */
/* Deliverables: PRD, slide deck, test report                          */
/* ------------------------------------------------------------------ */

function visibleText(files) {
  const html = files.find((file) => file.path === 'index.html')?.content || '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1800);
}

function appBrief(project, version, design, files) {
  return [
    `产品名：${project.name}`,
    `产品描述：${project.summary || design.description || ''}`,
    `用户最初的想法：${project.prompt}`,
    `当前版本说明：${version.summary}`,
    design.tagline ? `定位：${design.tagline}` : '',
    design.features?.length ? `核心功能：${design.features.join('、')}` : '',
    design.plan?.length ? `实现方案：${design.plan.join('；')}` : '',
    `文件：${files.map((file) => file.path).join(', ')}`,
    '数据持久化：预览环境注入 atomsStore，数据写入服务端 SQLite；独立 HTML 仅使用 localStorage 兜底。',
    `页面主要可见文案：${visibleText(files)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const PRD_SYSTEM = `你是资深产品经理，擅长写可直接进入评审的中文 PRD。请根据给定的应用信息，输出 Markdown 格式的需求文档。
要求：
- 只输出 Markdown，不要 JSON、代码围栏或额外解释。
- 包含这些二级标题：产品概述、目标用户与场景、核心使用流程、功能需求、页面与交互说明、数据与持久化、非功能要求、验收标准、后续迭代建议。
- 功能需求用 Markdown 表格列出（编号、功能、优先级 P0/P1、验收要点），至少 5 行。
- 不要编造应用中不存在的功能；如信息不足，做合理但克制的补充，并保持与已有功能一致。
- 数据持久化固定写成「atomsStore 服务端存储（SQLite）」，只有下载后的独立 HTML 才使用 localStorage 兜底；不要声称应用仅依赖浏览器本地存储。
- 全文 900-1400 字，语言具体、可执行，不要空话。`;

const SLIDES_SYSTEM = `你是发布会级的演示设计师。请为给定应用设计一套 7 页的中文演示幻灯片。
只输出一个 JSON 对象，不要 Markdown、代码围栏或解释：
{
  "title": "演示主标题",
  "subtitle": "一句话副标题",
  "slides": [
    {"layout": "cover", "kicker": "2026 · PRODUCT LAUNCH", "title": "产品名", "bullets": ["一句话价值主张"], "note": "演讲备注"},
    {"layout": "points", "kicker": "01 · 问题", "title": "标题", "bullets": ["2-4 个短要点，每条 ≤ 22 字"], "note": "演讲备注"},
    {"layout": "quote", "kicker": "02 · 洞察", "title": "一句可被记住的话", "bullets": [], "note": "演讲备注"},
    {"layout": "points", "kicker": "03 · 产品", "title": "标题", "bullets": ["..."], "note": "演讲备注"},
    {"layout": "points", "kicker": "04 · 体验", "title": "标题", "bullets": ["..."], "note": "演讲备注"},
    {"layout": "points", "kicker": "05 · 技术", "title": "标题", "bullets": ["..."], "note": "演讲备注"},
    {"layout": "closing", "kicker": "THANK YOU", "title": "一句收尾", "bullets": ["下一步行动"], "note": "演讲备注"}
  ]
}
要求：信息密度低、观点清晰、有节奏；不要堆功能清单；标题不超过 18 字。`;

function localPrd(project, version, design, files) {
  const features = design.features?.length ? design.features : ['核心工作流', '数据持久化', '响应式界面'];
  const rows = features
    .map((feature, index) => `| F${index + 1} | ${feature} | P0 | 可见、可操作、刷新后数据仍然存在 |`)
    .join('\n');
  return `# ${project.name} · 产品需求文档

> 版本：v${version.number} ｜ 生成方式：内置模板（AI 服务暂不可用）

## 产品概述
${project.summary || design.description || '一个由 Atoms Studio 生成的轻量网页应用。'}

用户最初的想法：${project.prompt}

## 目标用户与场景
面向需要快速完成「${project.category}」相关任务的用户。典型场景：打开页面即可开始操作，无需注册；数据自动保存，下一次打开可以继续。

## 核心使用流程
1. 进入应用，看到已初始化的示例数据与核心入口。
2. 完成一次新增 / 编辑 / 筛选等核心操作。
3. 页面即时反馈结果，并写入持久化存储。
4. 刷新或再次访问，数据保持一致。

## 功能需求
| 编号 | 功能 | 优先级 | 验收要点 |
| --- | --- | --- | --- |
${rows}
| F${features.length + 1} | 空状态与异常提示 | P1 | 无数据时有引导，操作失败有可读提示 |
| F${features.length + 2} | 响应式布局 | P1 | 390px / 768px / 1440px 下均可使用 |

## 页面与交互说明
- 顶部品牌区：产品名与一句话定位。
- 主工作区：承载核心操作与数据展示。
- 反馈层：toast、空状态、加载态；不使用浏览器原生弹窗。
- 文件：${files.map((file) => `\`${file.path}\``).join('、')}。

## 数据与持久化
应用通过预览环境注入的 \`atomsStore\` 读写数据，写入服务端 SQLite；在下载后的独立 HTML 中使用 localStorage 兜底。数据按 key 隔离，单条限制 64KB。

## 非功能要求
- 首屏在 1 秒内可交互（本地环境）。
- 不依赖外部 CDN、字体或图片，离线可打开。
- 键盘可操作，焦点可见。

## 验收标准
- 核心操作可用，所有按钮都有行为。
- 刷新后数据不丢失。
- 移动端无横向滚动。

## 后续迭代建议
${(design.plan || []).map((step) => `- ${step}`).join('\n') || '- 根据真实使用反馈继续迭代。'}`;
}

function localSlides(project, design) {
  const features = design.features?.length ? design.features : ['真实可用的交互', '服务端持久化', '一键分享与导出'];
  return {
    title: project.name,
    subtitle: design.tagline || project.summary || '把想法变成可以使用的应用',
    slides: [
      { layout: 'cover', kicker: 'ATOMS STUDIO · 2026', title: project.name, bullets: [design.tagline || project.summary || ''], note: '开场：一句话讲清楚我们做了什么。' },
      { layout: 'points', kicker: '01 · 问题', title: '想法很多，落地很慢', bullets: ['从想法到可演示原型，常常需要几天', '通用模板无法承载具体业务语境', '原型缺少真实数据与交互'], note: '用具体场景说明摩擦。' },
      { layout: 'quote', kicker: '02 · 洞察', title: '用户要的不是页面，而是一个能马上用的东西。', bullets: [], note: '强调可用性。' },
      { layout: 'points', kicker: '03 · 产品', title: `认识 ${project.name}`, bullets: features.slice(0, 4), note: '对应演示中的核心操作。' },
      { layout: 'points', kicker: '04 · 体验', title: '一句话生成，一句话修改', bullets: ['智能体理解需求并规划产品', '流式生成三件套代码', '版本、预览、分享一体化'], note: '现场演示生成与迭代。' },
      { layout: 'points', kicker: '05 · 技术', title: '每一层都为真实使用设计', bullets: ['沙箱预览 + 服务端数据存储', '自动校验与验收报告', 'PRD / PPT / 报告一键导出'], note: '技术不做堆砌，只讲对用户的价值。' },
      { layout: 'closing', kicker: 'THANK YOU', title: '现在，把一个想法交给它。', bullets: ['打开在线 Demo 体验', '生成你的第一个应用'], note: '引导扫码/点击链接。' },
    ],
  };
}

export async function generatePrd({ projectId, force = false }) {
  const project = getProject(projectId);
  if (!project) throw new Error('PROJECT_NOT_FOUND');
  const version = getVersion(projectId, project.current_version);
  if (!version) throw new Error('NO_VERSION');
  const existing = getArtifacts(projectId, version.number).find((artifact) => artifact.kind === 'prd');
  if (existing && !force) return existing;
  const files = JSON.parse(version.files);
  const messageMeta = JSON.parse(
    (await import('./db.js')).get('SELECT meta FROM messages WHERE project_id = ? AND version = ? ORDER BY created_at DESC LIMIT 1', projectId, version.number)?.meta || '{}',
  );
  const design = messageMeta.design || {};
  let markdown;
  let model = 'local-template';
  if (llmStatus().enabled) {
    try {
      const result = await chat({
        messages: [
          { role: 'system', content: PRD_SYSTEM },
          { role: 'user', content: appBrief(project, version, design, files) },
        ],
        maxTokens: 2600,
        temperature: 0.65,
        purpose: 'artifact-prd',
        projectId,
      });
      markdown = result.text.trim();
      model = result.model;
    } catch (error) {
      markdown = localPrd(project, version, design, files);
    }
  } else {
    markdown = localPrd(project, version, design, files);
  }
  return upsertArtifact({
    projectId,
    version: version.number,
    kind: 'prd',
    title: `${project.name} · 产品需求文档`,
    content: { markdown, model, version: version.number, generatedAt: new Date().toISOString() },
  });
}

export async function generateSlides({ projectId, force = false }) {
  const project = getProject(projectId);
  if (!project) throw new Error('PROJECT_NOT_FOUND');
  const version = getVersion(projectId, project.current_version);
  if (!version) throw new Error('NO_VERSION');
  const existing = getArtifacts(projectId, version.number).find((artifact) => artifact.kind === 'slides');
  if (existing && !force) return existing;
  const files = JSON.parse(version.files);
  const { get } = await import('./db.js');
  const meta = JSON.parse(get('SELECT meta FROM messages WHERE project_id = ? AND version = ? ORDER BY created_at DESC LIMIT 1', projectId, version.number)?.meta || '{}');
  const design = meta.design || {};
  let deck = localSlides(project, design);
  let model = 'local-template';
  if (llmStatus().enabled) {
    try {
      const result = await chat({
        messages: [
          { role: 'system', content: SLIDES_SYSTEM },
          { role: 'user', content: appBrief(project, version, design, files) },
        ],
        maxTokens: 2200,
        temperature: 0.7,
        purpose: 'artifact-slides',
        projectId,
      });
      const parsed = parseJsonLoose(result.text, null);
      if (parsed && Array.isArray(parsed.slides) && parsed.slides.length >= 4) {
        deck = {
          title: String(parsed.title || project.name),
          subtitle: String(parsed.subtitle || design.tagline || ''),
          slides: parsed.slides.slice(0, 12).map((slide, index) => ({
            layout: ['cover', 'points', 'quote', 'closing'].includes(slide.layout) ? slide.layout : index === 0 ? 'cover' : 'points',
            kicker: String(slide.kicker || '').slice(0, 40),
            title: String(slide.title || '').slice(0, 60),
            bullets: (Array.isArray(slide.bullets) ? slide.bullets : []).slice(0, 5).map((bullet) => String(bullet).slice(0, 80)),
            note: String(slide.note || '').slice(0, 300),
          })),
        };
        model = result.model;
      }
    } catch (error) {
      deck = localSlides(project, design);
    }
  }
  return upsertArtifact({
    projectId,
    version: version.number,
    kind: 'slides',
    title: `${project.name} · 演示幻灯片`,
    content: { deck, model, version: version.number, generatedAt: new Date().toISOString(), accent: project.accent, emoji: project.emoji },
  });
}
