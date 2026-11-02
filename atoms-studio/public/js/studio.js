import { api } from './api.js';
import {
  $, $$, esc, attrs, timeAgo, formatBytes, formatDate, icon, toast, openModal, closeModal,
  copyText, renderMarkdown, thumbHtml, themeButton, initTheme,
} from './ui.js';

const TABS = [
  { id: 'preview', label: '预览' },
  { id: 'code', label: '代码' },
  { id: 'artifacts', label: '交付物' },
  { id: 'versions', label: '版本' },
];

const ARTIFACT_META = {
  prd: {
    icon: 'doc',
    title: '产品需求文档',
    type: 'PRD · MARKDOWN',
    description: '目标用户、核心流程、功能表与验收标准，可直接进入评审。',
  },
  slides: {
    icon: 'deck',
    title: '演示幻灯片',
    type: 'DECK · PPTX',
    description: '7 页发布会节奏的演示稿，带演讲备注，可导出 PPTX。',
  },
  report: {
    icon: 'report',
    title: '自动验收报告',
    type: 'QA · LIVE CHECKS',
    description: '每次生成后自动检查预览、脚本、资源和数据持久化。',
  },
};

function modelLabel(model) {
  if (!model) return 'Atoms Agent';
  if (model === 'local-demo-engine') return '内置演示引擎';
  if (model === 'curated') return '编辑精选';
  if (model === 'seed') return '示例应用';
  if (model === 'restore') return '版本恢复';
  if (model.includes('deepseek')) return 'DeepSeek V4 Flash';
  if (model.includes('doubao')) return 'Doubao Seed';
  return model.length > 24 ? model.slice(0, 24) : model;
}

function isNearBottom(el) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 90;
}

function elapsedText(start) {
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function artifactContent(artifact) {
  if (!artifact) return {};
  if (typeof artifact.content === 'string') {
    try { return JSON.parse(artifact.content); } catch { return {}; }
  }
  return artifact.content || {};
}

export async function renderStudio(root, projectId) {
  initTheme();
  const initial = await api.get(`/api/projects/${encodeURIComponent(projectId)}`);
  if (!initial?.project) throw new Error('项目不存在');

  const state = {
    projectId,
    data: initial,
    tab: 'preview',
    device: 'desktop',
    activeFile: initial.current?.files?.[0]?.path || 'index.html',
    previewVersion: null,
    busy: Boolean(initial.activeJob),
    activeJob: initial.activeJob || null,
    steps: [],
    design: null,
    notices: [],
    stream: '',
    startedAt: Date.now(),
    streamRaf: null,
    elapsedTimer: null,
    es: null,
    pollTimer: null,
    finished: false,
    runError: null,
    artifactLoading: new Set(),
  };

  const queryJob = new URLSearchParams(window.location.search).get('job');
  const cleanupFns = [];
  document.title = `${initial.project.name} · Atoms Studio`;

  root.innerHTML = shell(state);
  bindEvents();
  paintAll();

  if (state.activeJob) {
    trackJob(state.activeJob);
  } else if (queryJob) {
    // The job may have just finished while the page was loading.
    checkJobOnce(queryJob);
  }

  function shell(s) {
    const p = s.data.project;
    return `
    <div class="studio view" style="--app-accent:${esc(p.accent || '#4b44d6')}">
      <header class="studio-nav">
        <div class="studio-nav-left">
          <a class="studio-back" href="/" data-link>${icon('back')} <span class="back-label">工作室</span></a>
          <span class="studio-divider"></span>
          <span class="studio-emoji" id="studioEmoji">${esc(p.emoji || '✦')}</span>
          <div class="studio-title-wrap">
            <div>
              <div class="studio-title" id="studioTitle">${esc(p.name)}</div>
              <div class="studio-sub" id="studioSub">v${p.currentVersion || 0} · ${esc(p.category || '应用')} · ${timeAgo(p.updatedAt)}</div>
            </div>
            <span class="status-pill ${s.busy ? 'generating' : ''}" id="studioStatus"><i></i>${s.busy ? '生成中' : p.status === 'ready' ? '已发布' : '草稿'}</span>
          </div>
        </div>
        <div class="studio-actions" id="studioActions">
          <button class="icon-btn" type="button" data-action="sync" aria-label="同步最新版本" title="同步最新版本">${icon('refresh')}</button>
          <button class="btn btn-sm btn-ghost" type="button" data-action="share">${icon('share')}<span class="share-label">分享</span></button>
          <button class="btn btn-sm btn-dark" type="button" data-action="new-app">${icon('plus')} <span class="new-label">新建应用</span></button>
          ${themeButton()}
          <button class="icon-btn" type="button" data-action="more" aria-label="更多操作">···</button>
        </div>
      </header>
      <div class="studio-body">
        <aside class="chat-pane" aria-label="智能体对话">
          <div class="chat-head">
            <span class="eyebrow">ATOMS AGENT</span>
            <div class="chat-head-meta">
              <span>${s.data.llm?.enabled ? 'ONLINE' : 'LOCAL'}</span>
              <span>·</span>
              <span>${modelLabel(s.data.llm?.model || '')}</span>
            </div>
          </div>
          <div class="chat-messages" id="chatMessages"></div>
          <div class="chat-composer">
            <div class="chat-composer-box">
              <textarea id="chatInput" rows="2" maxlength="2000" placeholder="描述一个修改，例如：把配色换成深色主题…" ${s.busy ? 'disabled' : ''}></textarea>
              <div class="chat-composer-foot">
                <span class="hint">⌘ / Ctrl + Enter 发送 · Shift + Enter 换行</span>
                <button class="send-btn" id="sendBtn" type="button" aria-label="发送修改要求" ${s.busy ? 'disabled' : ''}>${icon('send')}</button>
              </div>
            </div>
          </div>
        </aside>
        <section class="preview-pane" aria-label="应用预览与交付物">
          <div class="preview-toolbar">
            <div class="tabs" role="tablist" aria-label="工作区视图">
              ${TABS.map((tab) => `<button class="tab ${state.tab === tab.id ? 'active' : ''}" type="button" role="tab" aria-selected="${state.tab === tab.id}" data-tab="${tab.id}">${tab.label}<span class="count" data-count-for="${tab.id}"></span></button>`).join('')}
            </div>
            <div class="preview-tools" id="previewTools"></div>
          </div>
          <div class="preview-stage" id="previewStage"></div>
        </section>
      </div>
    </div>`;
  }

  /* ------------------------------ painting ------------------------------ */

  function paintAll() {
    paintNav();
    paintTabs();
    paintChat();
    paintTab();
  }

  function paintNav() {
    const p = state.data.project;
    const title = $('#studioTitle');
    const emoji = $('#studioEmoji');
    const sub = $('#studioSub');
    const status = $('#studioStatus');
    if (title) title.textContent = p.name;
    if (emoji) emoji.textContent = p.emoji || '✦';
    if (sub) sub.textContent = `v${p.currentVersion || 0} · ${p.category || '应用'} · ${timeAgo(p.updatedAt)}`;
    if (status) {
      status.className = `status-pill ${state.busy ? 'generating' : ''}`;
      status.innerHTML = `<i></i>${state.busy ? '生成中' : p.status === 'ready' ? '已发布' : p.status === 'error' ? '需重试' : '草稿'}`;
    }
    const input = $('#chatInput');
    if (input) {
      input.disabled = state.busy;
      input.placeholder = state.busy ? '智能体正在工作，完成后可以继续修改…' : '描述一个修改，例如：把配色换成深色主题…';
    }
    const send = $('#sendBtn');
    if (send) send.disabled = state.busy;
  }

  function paintTabs() {
    $$('.tab').forEach((button) => {
      const active = button.dataset.tab === state.tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const counts = {
      code: state.data.current?.files?.length || 0,
      artifacts: state.data.artifacts?.length || 0,
      versions: state.data.versions?.length || 0,
    };
    $$('[data-count-for]').forEach((el) => {
      const count = counts[el.dataset.countFor];
      el.textContent = count ? String(count) : '';
    });
    const tools = $('#previewTools');
    if (tools) tools.innerHTML = toolsHtml();
  }

  function toolsHtml() {
    const p = state.data.project;
    if (state.tab === 'preview') {
      const hasVersion = (state.previewVersion || p.currentVersion) > 0;
      return `
        <div class="device-switch" role="group" aria-label="预览尺寸">
          <button class="device-btn ${state.device === 'desktop' ? 'active' : ''}" type="button" data-device="desktop" aria-label="桌面端">${icon('desktop')}</button>
          <button class="device-btn ${state.device === 'tablet' ? 'active' : ''}" type="button" data-device="tablet" aria-label="平板">${icon('tablet')}</button>
          <button class="device-btn ${state.device === 'mobile' ? 'active' : ''}" type="button" data-device="mobile" aria-label="手机">${icon('mobile')}</button>
        </div>
        <span class="tool-sep"></span>
        <button class="tool-btn" type="button" data-action="reload-preview" ${hasVersion ? '' : 'disabled'}>${icon('refresh')} 刷新</button>
        <button class="tool-btn" type="button" data-action="open-preview" ${hasVersion ? '' : 'disabled'}>${icon('external')} 打开</button>
        <button class="tool-btn" type="button" data-action="download" ${hasVersion ? '' : 'disabled'}>${icon('download')} 下载</button>
        <button class="tool-btn" type="button" data-action="share">${icon('share')} 分享</button>`;
    }
    if (state.tab === 'code') {
      return `<button class="tool-btn" type="button" data-action="copy-code">${icon('copy')} 复制全部</button>
        <button class="tool-btn" type="button" data-action="download">${icon('download')} 下载 HTML</button>`;
    }
    if (state.tab === 'artifacts') {
      const allReady = Object.keys(ARTIFACT_META).every((kind) => artifactFor(kind));
      return allReady ? '' : `<button class="tool-btn" type="button" data-action="generate-all">${icon('spark')} 补全交付物</button>`;
    }
    return '';
  }

  function paintChat() {
    const mount = $('#chatMessages');
    if (!mount) return;
    const atBottom = isNearBottom(mount);
    const messages = state.data.messages || [];
    const hasVersion = state.data.project.currentVersion > 0;
    mount.innerHTML =
      messages.map(messageHtml).join('') +
      (state.busy || state.runError ? '<div id="runCardMount"></div>' : '') +
      (!messages.length && !hasVersion && !state.busy
        ? `<div class="msg agent"><span class="msg-avatar">${icon('spark')}</span><div class="msg-body"><div class="msg-bubble">告诉我你想做什么。我会先规划，再写出一个可以点、数据会保存、还能分享的应用。</div><div class="msg-meta"><span>ATOMS AGENT</span><span class="sep">·</span><span>等待你的第一个想法</span></div></div></div>`
        : '');
    if (state.busy) paintRunCard();
    if (atBottom) mount.scrollTop = mount.scrollHeight;
    paintSuggestions();
  }

  function paintSuggestions() {
    const composer = $('.chat-composer');
    if (!composer) return;
    const old = $('#chatSuggestions');
    if (old) old.remove();
    if (state.busy || !state.data.project.currentVersion) return;
    const suggestions = ['换成深色主题', '加一个搜索框', '优化手机端布局'];
    const bar = document.createElement('div');
    bar.id = 'chatSuggestions';
    bar.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;padding:0 1px 8px';
    bar.innerHTML = suggestions.map((text) => `<button class="chip" type="button" data-suggest="${attrs(text)}">${esc(text)}</button>`).join('');
    composer.insertBefore(bar, composer.firstChild);
  }

  function messageHtml(message) {
    if (message.role === 'user') {
      return `<div class="msg user">
        <span class="msg-avatar">你</span>
        <div class="msg-body">
          <div class="msg-bubble">${esc(message.content)}</div>
          <div class="msg-meta"><span>${message.createdAt ? timeAgo(message.createdAt) : '刚刚'}</span></div>
        </div>
      </div>`;
    }
    const meta = message.meta || {};
    const plan = Array.isArray(meta.plan) && meta.plan.length ? meta.plan : null;
    const checks = meta.checks;
    const fallback = message.kind === 'fallback';
    return `<div class="msg agent">
      <span class="msg-avatar">${icon('spark')}</span>
      <div class="msg-body">
        <div class="msg-bubble">${esc(message.content)}${fallback ? '<span style="display:block;margin-top:6px;font-family:var(--mono);font-size:8px;color:var(--amber)">本地演示引擎生成 · 配置模型后可获得完整 AI 生成</span>' : ''}</div>
        <div class="msg-meta">
          ${message.version ? `<span>v${message.version}</span><span class="sep">·</span>` : ''}
          <span>${modelLabel(meta.model || message.model)}</span>
          ${meta.usage?.total_tokens ? `<span class="sep">·</span><span>${meta.usage.total_tokens} tokens</span>` : ''}
          ${checks?.total ? `<span class="sep">·</span><span>${checks.passed}/${checks.total} checks</span>` : ''}
          <span class="sep">·</span><span>${timeAgo(message.createdAt)}</span>
        </div>
        ${plan ? `<details class="msg-plan"><summary>${icon('chevron')} 本版实现方案</summary><ol>${plan.map((item) => `<li>${esc(item)}</li>`).join('')}</ol></details>` : ''}
        <div class="msg-actions">
          ${message.version ? `<button type="button" data-action="goto-tab" data-tab="code">查看代码</button><button type="button" data-action="goto-tab" data-tab="artifacts">交付物</button>` : ''}
        </div>
      </div>
    </div>`;
  }

  function paintRunCard() {
    const mount = $('#runCardMount');
    if (!mount) return;
    const p = state.data.project;
    mount.innerHTML = `<div class="run-card" id="runCard">
      <div class="run-head">
        <span class="run-pulse"></span>
        <div><strong>${state.runError ? '这次生成遇到了问题' : 'Atoms 正在工作'}</strong>
          <span>${state.runError ? '你可以重新描述一次，或换个说法' : `正在生成 ${p.currentVersion ? `v${p.currentVersion + 1}` : '第一个版本'}`}</span></div>
        <span class="run-time" data-elapsed>${elapsedText(state.startedAt)}</span>
      </div>
      ${state.runError ? `<div class="gen-notice" style="margin:10px 0 0">${esc(state.runError)}</div>` : stepsHtml()}
      ${state.runError ? '' : `${planHtml()}${noticesHtml()}<details class="run-details" ${state.stream ? 'open' : ''}><summary>实时输出</summary><pre class="run-stream" id="runStream">${esc(tailStream())}</pre></details>`}
    </div>`;
  }

  function stepsHtml() {
    const steps = state.steps.length ? state.steps : [
      { id: 'understand', label: '理解想法', detail: '解析场景与目标用户', status: 'active' },
      { id: 'design', label: '设计产品', detail: '确定信息架构与界面方向', status: 'pending' },
      { id: 'build', label: '编写代码', detail: '生成页面、样式与交互', status: 'pending' },
      { id: 'verify', label: '自检与联调', detail: '预览、语法与持久化', status: 'pending' },
      { id: 'publish', label: '发布预览', detail: '保存版本并生成分享链接', status: 'pending' },
    ];
    const activeIndex = steps.findIndex((step) => step.status === 'active');
    return `<div class="gen-steps" style="margin-top:12px">${steps.map((step, index) => `
      <div class="gen-step ${step.status}">
        <span class="gen-step-dot">${step.status === 'done' ? icon('checkSmall') : step.status === 'error' ? icon('fail') : ''}</span>
        <div>
          <div class="gen-step-label">${esc(step.label)}${activeIndex === index ? ' · 进行中' : ''}</div>
          <div class="gen-step-detail">${esc(step.detail || '')}</div>
        </div>
      </div>`).join('')}</div>`;
  }

  function planHtml() {
    const design = state.design;
    if (!design) return '';
    return `<div class="run-plan">
      <div class="run-plan-title">${esc(design.emoji || '✦')} ${esc(design.name || '')} ${design.tagline ? `<span>${esc(design.tagline)}</span>` : ''}</div>
      <div class="plan-tags">${(design.features || design.plan || []).slice(0, 5).map((item) => `<span>${esc(item)}</span>`).join('')}</div>
    </div>`;
  }

  function noticesHtml() {
    if (!state.notices.length) return '';
    return state.notices.map((notice) => `<div class="gen-notice">${esc(notice)}</div>`).join('');
  }

  function tailStream() {
    return state.stream.slice(-5200);
  }

  function paintTab() {
    if (state.tab === 'preview') paintPreview();
    else if (state.tab === 'code') paintCode();
    else if (state.tab === 'artifacts') paintArtifacts();
    else if (state.tab === 'versions') paintVersions();
    paintTabs();
  }

  function paintPreview() {
    const stage = $('#previewStage');
    if (!stage) return;
    const p = state.data.project;
    const current = state.data.current;
    const version = state.previewVersion || p.currentVersion;
    if (!version) {
      if (state.busy) {
        stage.innerHTML = `<div class="gen-stage-wrap">${genOverlayHtml()}</div>`;
        requestAnimationFrame(() => {
          const pre = $('#genStream');
          if (pre) pre.textContent = tailStream();
        });
        return;
      }
      stage.innerHTML = `<div class="preview-empty" style="width:100%"><div class="preview-empty-inner">
        <div class="preview-empty-mark">${icon('spark')}</div>
        <h3>${state.data.project.status === 'error' ? '上一个版本没有生成成功' : '还没有可预览的应用'}</h3>
        <p>${state.data.project.status === 'error' ? '可以直接用同一个需求重试，不需要重新输入。' : '在左侧告诉智能体你想做什么，几十秒后就能看到一个真实可用的应用。'}</p>
        ${state.data.project.status === 'error' ? `<button class="btn btn-dark" type="button" data-action="retry">重试生成</button>` : ''}
      </div></div>`;
      return;
    }
    const previewUrl = `/preview/${p.id}/${version}/?v=${encodeURIComponent(state.data.current?.createdAt || p.updatedAt)}`;
    const isOld = state.previewVersion && state.previewVersion !== p.currentVersion;
    stage.innerHTML = `<div class="preview-wrap">
      ${isOld ? `<div class="preview-banner">正在预览历史版本 v${version} · 编辑与交付物仍基于最新版本 <button class="btn btn-sm" type="button" data-action="back-latest">回到最新 v${p.currentVersion}</button></div>` : ''}
      <div class="preview-frame ${state.device}" id="previewFrame">
        <div class="frame-bar">
          <span class="frame-dots"><i></i><i></i><i></i></span>
          <span class="frame-url">/s/${esc(p.slug)}${isOld ? `?v=${version}` : ''}</span>
          <button class="frame-open" type="button" data-action="open-preview">打开 ↗</button>
        </div>
        <iframe id="previewIframe" src="${attrs(previewUrl)}" title="${attrs(p.name)} 预览" allow="clipboard-write; fullscreen" loading="eager"></iframe>
        ${state.busy ? genOverlayHtml() : ''}
      </div>
    </div>`;
    if (state.busy) {
      requestAnimationFrame(() => {
        const pre = $('#genStream');
        if (pre) pre.textContent = tailStream();
      });
    }
  }

  function genOverlayHtml() {
    const active = state.steps.find((step) => step.status === 'active');
    return `<div class="gen-overlay" id="genOverlay">
      <div class="gen-head">
        <span class="gen-pulse"></span>
        <div><h3>正在把你的想法写成应用</h3><p>${active ? `${esc(active.label)} · ${esc(active.detail || '')}` : '智能体正在准备工作区'}</p></div>
        <span class="gen-timer" data-elapsed>${elapsedText(state.startedAt)}</span>
      </div>
      ${noticesHtml()}
      <div id="genSteps">${stepsHtml()}</div>
      ${planHtml()}
      <div class="gen-stream" style="margin-top:12px">
        <div class="gen-stream-head"><i></i> agent · live output <span style="margin-left:auto">${formatBytes(state.stream.length)}</span></div>
        <pre id="genStream">${esc(tailStream())}</pre>
      </div>
      <div class="gen-actions">
        <span class="hint">生成完成后会自动保存版本、运行验收并发布分享链接。</span>
      </div>
    </div>`;
  }

  function paintCode() {
    const stage = $('#previewStage');
    if (!stage) return;
    const files = state.data.current?.files || [];
    if (!files.length) {
      stage.innerHTML = `<div class="code-empty" style="width:100%">这个版本还没有文件。</div>`;
      return;
    }
    const active = files.find((file) => file.path === state.activeFile) || files[0];
    state.activeFile = active.path;
    const lines = String(active.content || '').split('\n');
    stage.innerHTML = `<div class="code-view" style="width:100%;height:100%">
      <div class="file-list">
        ${files.map((file) => `<button type="button" class="file-item ${file.path === active.path ? 'active' : ''}" data-file="${attrs(file.path)}">${icon('file')} ${esc(file.path)}</button>`).join('')}
      </div>
      <div class="code-main">
        <div class="code-head">
          <span>${esc(active.path)}</span><span>·</span><span>${formatBytes(active.content.length)}</span>
          <button class="tool-btn copy" type="button" data-action="copy-code">${icon('copy')} 复制</button>
        </div>
        <pre class="code-pre">${lines.map((line, index) => `<div class="code-line"><span class="code-num">${index + 1}</span><span class="code-text">${esc(line) || ' '}</span></div>`).join('')}</pre>
      </div>
    </div>`;
  }

  function paintArtifacts() {
    const stage = $('#previewStage');
    if (!stage) return;
    const p = state.data.project;
    if (!p.currentVersion) {
      stage.innerHTML = `<div class="code-empty" style="width:100%">先生成一个版本，交付物会自动准备。</div>`;
      return;
    }
    const artifacts = state.data.artifacts || [];
    const count = artifacts.length;
    stage.innerHTML = `<div class="panel-scroll" style="width:100%"><div class="artifacts-wrap">
      <div class="artifacts-head">
        <div><div class="eyebrow">DELIVERABLES · v${p.currentVersion}</div><h2>应用之外，交付一整套材料。</h2><p>基于同一个版本生成，和真实应用保持一致。${count ? `已生成 ${count}/3。` : ''}</p></div>
      </div>
      <div class="artifacts-grid">
        ${Object.entries(ARTIFACT_META).map(([kind, meta]) => {
          const artifact = artifacts.find((item) => item.kind === kind);
          const loading = state.artifactLoading.has(kind);
          return `<div class="artifact-card ${kind}">
            <span class="artifact-icon">${icon(meta.icon)}</span>
            <div class="artifact-info">
              <h3>${esc(meta.title)} <span class="artifact-type">${esc(meta.type)}</span></h3>
              <p>${esc(meta.description)}</p>
            </div>
            <div class="artifact-actions">
              ${artifact
                ? `<span class="artifact-state"><i></i>已生成</span>
                   <button class="btn btn-sm" type="button" data-artifact-open="${kind}">打开</button>
                   <a class="btn btn-sm btn-ghost" href="${attrs(downloadUrl(artifact))}" download>下载</a>`
                : `<button class="btn btn-sm btn-dark" type="button" data-artifact-generate="${kind}" ${loading ? 'disabled' : ''}>${loading ? '生成中…' : '生成'}</button>`}
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="artifact-hint"><strong>关于交付物：</strong>PRD 与幻灯片由智能体基于当前版本的真实功能生成；验收报告则在每次生成后自动运行，包含预览可访问性、JavaScript 语法、资源引用和服务端持久化检查。幻灯片可直接下载为 16:9 的 .pptx 文件继续修改。</div>
    </div></div>`;
  }

  function paintVersions() {
    const stage = $('#previewStage');
    if (!stage) return;
    const versions = state.data.versions || [];
    const p = state.data.project;
    stage.innerHTML = `<div class="panel-scroll" style="width:100%"><div class="versions-wrap">
      <div class="artifacts-head"><div><div class="eyebrow">VERSION HISTORY</div><h2>每一次修改，都可以回溯。</h2><p>当前 v${p.currentVersion}。恢复历史版本会创建一个新的版本，不会丢掉任何东西。</p></div></div>
      ${versions.length ? versions.map((version) => {
        const current = version.number === p.currentVersion;
        return `<div class="version-item ${current ? 'current' : ''}">
          <span class="version-badge">v${version.number}</span>
          <div class="version-info">
            <h3>${esc(version.summary || '生成版本')} ${current ? '<span class="current-tag">CURRENT</span>' : ''}</h3>
            <p>${esc(version.prompt || '')}</p>
            <div class="version-meta"><span>${formatDate(version.createdAt)}</span><span>·</span><span>${modelLabel(version.model)}</span>${version.usage?.total_tokens ? `<span>·</span><span>${version.usage.total_tokens} tokens</span>` : ''}</div>
          </div>
          <div class="version-actions">
            <button class="btn btn-sm btn-ghost" type="button" data-version-preview="${version.number}">预览</button>
            ${current ? '' : `<button class="btn btn-sm" type="button" data-version-restore="${version.number}">恢复</button>`}
          </div>
        </div>`;
      }).join('') : '<div class="version-empty">还没有版本。</div>'}
    </div></div>`;
  }

  /* --------------------------- live generation -------------------------- */

  async function checkJobOnce(jobId) {
    try {
      const job = await api.get(`/api/jobs/${jobId}`);
      if (job.status === 'done') {
        await finishSuccess({ version: job.version ? { number: job.version } : null });
      } else if (job.status === 'error') {
        await finishError(job.error || '任务已结束');
      }
    } catch {
      /* ignore */
    }
  }

  function startJobPolling(jobId) {
    stopJobPolling();
    // SSE is the primary channel; this poller keeps the UI in sync when a proxy
    // buffers the event stream or a long-lived connection silently stalls.
    state.pollTimer = setInterval(async () => {
      if (!state.busy || state.finished || state.activeJob !== jobId) return;
      try {
        const job = await api.get(`/api/jobs/${jobId}`);
        if (job.steps?.length) {
          const next = JSON.stringify(job.steps);
          if (next !== JSON.stringify(state.steps)) {
            state.steps = job.steps;
            if (state.tab === 'preview' || state.busy) {
              paintChat();
              if (state.tab === 'preview') paintPreview();
            }
          }
        }
        if (job.status === 'done') {
          await finishSuccess({ version: job.version ? { number: job.version } : null });
        } else if (job.status === 'error') {
          await finishError(job.error || '生成失败');
        }
      } catch {
        /* transient network error; next tick retries */
      }
    }, 2500);
  }

  function stopJobPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function trackJob(jobId) {
    if (state.finished) return;
    state.busy = true;
    state.activeJob = jobId;
    state.finished = false;
    state.runError = null;
    state.startedAt = Date.now();
    state.steps = [];
    state.design = null;
    state.notices = [];
    state.stream = '';
    state.previewVersion = null;
    state.tab = 'preview';
    paintNav();
    paintTabs();
    paintChat();
    paintTab();
    startElapsed();
    stopJobPolling();
    if (state.es) state.es.close();

    try {
      const job = await api.get(`/api/jobs/${jobId}`);
      if (job.steps?.length) state.steps = job.steps;
      if (job.createdAt) state.startedAt = new Date(job.createdAt).getTime() || Date.now();
      if (job.status === 'done') {
        await finishSuccess({ version: job.version ? { number: job.version } : null });
        return;
      }
      if (job.status === 'error') {
        await finishError(job.error || '生成失败');
        return;
      }
      paintChat();
      if (state.tab === 'preview') paintPreview();
      startJobPolling(jobId);
      state.es = new EventSource(`/api/jobs/${jobId}/events`);
      state.es.onmessage = (event) => {
        let payload;
        try { payload = JSON.parse(event.data); } catch { return; }
        handleJobEvent(payload);
      };
      state.es.onerror = () => {
        if (!state.busy || state.finished) return;
        // EventSource reconnects by itself; if the server closed the stream after
        // finishing, a couple of polls settle the final state.
        clearTimeout(state.esFallbackTimer);
        state.esFallbackTimer = setTimeout(() => checkJobOnce(jobId), 4000);
      };
    } catch (error) {
      await finishError(error.message || '无法读取任务状态');
    }
  }

  function handleJobEvent(event) {
    if ((event.type === 'done' || event.type === 'error') && event.jobId && state.activeJob && event.jobId !== state.activeJob) {
      return;
    }
    if (event.type === 'steps') {
      state.steps = event.steps || [];
      paintChat();
      if (state.tab === 'preview') paintPreview();
    } else if (event.type === 'design') {
      state.design = event.design;
      paintChat();
      if (state.tab === 'preview') paintPreview();
    } else if (event.type === 'delta') {
      state.stream += event.text || '';
      if (state.stream.length > 60000) state.stream = state.stream.slice(-50000);
      scheduleStreamPaint();
    } else if (event.type === 'notice') {
      if (event.message && !state.notices.includes(event.message)) state.notices.push(event.message);
      paintChat();
      if (state.tab === 'preview') paintPreview();
    } else if (event.type === 'done') {
      finishSuccess(event);
    } else if (event.type === 'error') {
      finishError(event.message || '生成失败');
    }
  }

  function scheduleStreamPaint() {
    if (state.streamRaf) return;
    state.streamRaf = requestAnimationFrame(() => {
      state.streamRaf = null;
      const pre = $('#genStream');
      if (pre) {
        pre.textContent = tailStream();
        pre.scrollTop = pre.scrollHeight;
      }
      const run = $('#runStream');
      if (run) {
        run.textContent = tailStream();
        run.scrollTop = run.scrollHeight;
      }
      const size = $('#genOverlay .gen-stream-head span');
      if (size) size.textContent = formatBytes(state.stream.length);
    });
  }

  async function finishSuccess(event) {
    if (state.finished) return;
    state.finished = true;
    state.busy = false;
    state.activeJob = null;
    state.runError = null;
    closeEventSource();
    stopElapsed();
    const version = event?.version?.number || event?.version || state.data.project.currentVersion;
    try {
      await refreshProject();
    } catch {
      /* ignore */
    }
    paintAll();
    removeJobQuery();
    if (version) toast(`v${version} 已发布，预览已更新`);
  }

  async function finishError(message) {
    if (state.finished) return;
    state.finished = true;
    state.busy = false;
    state.runError = message;
    closeEventSource();
    stopElapsed();
    try {
      await refreshProject();
    } catch {
      /* ignore */
    }
    paintAll();
    paintChat();
    toast(message, 'error');
  }

  function closeEventSource() {
    if (state.es) {
      state.es.close();
      state.es = null;
    }
    clearTimeout(state.esFallbackTimer);
    stopJobPolling();
  }

  function startElapsed() {
    stopElapsed();
    state.elapsedTimer = setInterval(() => {
      $$('[data-elapsed]').forEach((el) => { el.textContent = elapsedText(state.startedAt); });
    }, 1000);
  }

  function stopElapsed() {
    if (state.elapsedTimer) clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
  }

  async function refreshProject() {
    const data = await api.get(`/api/projects/${state.projectId}`);
    state.data = data;
    state.activeJob = data.activeJob || null;
    if (state.activeFile && !data.current?.files?.some((file) => file.path === state.activeFile)) {
      state.activeFile = data.current?.files?.[0]?.path || 'index.html';
    }
    document.title = `${data.project.name} · Atoms Studio`;
  }

  async function syncProject(showToast = false) {
    if (state.busy) return;
    const before = state.data.project.updatedAt;
    try {
      await refreshProject();
      paintAll();
      if (showToast) toast(state.data.project.updatedAt !== before ? '已同步到最新版本' : '已经是最新版本');
    } catch (error) {
      if (showToast) toast(error.message, 'error');
    }
  }

  function removeJobQuery() {
    const url = new URL(window.location.href);
    if (url.searchParams.has('job')) {
      url.searchParams.delete('job');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }

  /* ----------------------------- actions -------------------------------- */

  function setTab(tab) {
    state.tab = tab;
    paintTabs();
    paintTab();
  }

  function setDevice(device) {
    state.device = device;
    const frame = $('#previewFrame');
    if (frame) {
      frame.classList.remove('desktop', 'tablet', 'mobile');
      frame.classList.add(device);
    }
    $$('[data-device]').forEach((button) => button.classList.toggle('active', button.dataset.device === device));
  }

  function reloadPreview() {
    const iframe = $('#previewIframe');
    if (!iframe) return;
    const url = new URL(iframe.src, window.location.origin);
    url.searchParams.set('v', String(Date.now()));
    iframe.src = url.pathname + url.search;
    toast('预览已刷新');
  }

  function openPreview() {
    const p = state.data.project;
    const version = state.previewVersion || p.currentVersion;
    if (!version) return;
    const url = p.shareEnabled ? `/s/${p.slug}` : `/preview/${p.id}/${version}/`;
    window.open(url, '_blank', 'noopener');
  }

  function downloadHtml() {
    const p = state.data.project;
    const version = state.previewVersion || p.currentVersion;
    if (!version) return;
    window.location.href = `/api/projects/${p.id}/versions/${version}/download`;
  }

  async function retryGeneration() {
    if (state.busy) return toast('已有任务在运行', 'error');
    try {
      const result = await api.post(`/api/projects/${state.projectId}/retry`, {});
      await trackJob(result.jobId);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function submitPrompt() {
    if (state.busy) return toast('智能体正在处理上一条需求', 'error');
    const input = $('#chatInput');
    if (!input) return;
    const value = input.value.trim();
    if (value.length < 2) return toast('再具体一点告诉智能体你想改什么', 'error');
    const optimistic = { id: 'local_' + Date.now(), role: 'user', content: value, createdAt: new Date().toISOString(), meta: {} };
    state.data.messages = [...(state.data.messages || []), optimistic];
    input.value = '';
    input.style.height = 'auto';
    paintChat();
    try {
      const result = await api.post(`/api/projects/${state.projectId}/messages`, { content: value });
      await trackJob(result.jobId);
    } catch (error) {
      if (error.status === 409 && error.payload?.jobId) {
        await trackJob(error.payload.jobId);
        return;
      }
      state.data.messages = state.data.messages.filter((message) => message.id !== optimistic.id);
      paintChat();
      const inputEl = $('#chatInput');
      if (inputEl && !inputEl.value) inputEl.value = value;
      toast(error.message, 'error');
    }
  }

  async function downloadArtifact(artifact) {
    window.location.href = downloadUrl(artifact);
  }

  function downloadUrl(artifact) {
    return artifact.kind === 'slides'
      ? `/api/artifacts/${artifact.id}/download?format=pptx`
      : `/api/artifacts/${artifact.id}/download`;
  }

  function artifactFor(kind) {
    return (state.data.artifacts || []).find((artifact) => artifact.kind === kind);
  }

  async function ensureArtifact(kind, { force = false } = {}) {
    const existing = artifactFor(kind);
    if (existing && !force) return existing;
    state.artifactLoading.add(kind);
    if (state.tab === 'artifacts') paintArtifacts();
    try {
      const result = await api.post(`/api/projects/${state.projectId}/artifacts/${kind}`, { force });
      const artifact = result.artifact;
      const artifacts = (state.data.artifacts || []).filter((item) => item.kind !== kind);
      artifacts.push(artifact);
      state.data.artifacts = artifacts;
      if (state.tab === 'artifacts') paintArtifacts();
      paintTabs();
      return artifact;
    } finally {
      state.artifactLoading.delete(kind);
      if (state.tab === 'artifacts') paintArtifacts();
    }
  }

  async function openArtifact(kind) {
    let artifact = artifactFor(kind);
    if (!artifact) {
      try {
        artifact = await ensureArtifact(kind);
        toast('交付物已生成');
      } catch (error) {
        toast(error.message, 'error');
        return;
      }
    }
    if (kind === 'prd') openPrd(artifact);
    else if (kind === 'slides') openSlides(artifact);
    else openReport(artifact);
  }

  async function generateAll() {
    if (state.busy) return toast('应用正在生成中', 'error');
    const missing = Object.keys(ARTIFACT_META).filter((kind) => !artifactFor(kind));
    if (!missing.length) return toast('交付物已经齐了');
    for (const kind of missing) {
      try {
        const artifact = await ensureArtifact(kind, { force: kind === 'report' && Boolean(artifactFor('report')) });
        toast(`${ARTIFACT_META[kind].title}已生成`);
      } catch (error) {
        toast(error.message, 'error');
        return;
      }
    }
  }

  function openPrd(artifact) {
    const content = artifactContent(artifact);
    const markdown = content.markdown || '';
    openModal({
      title: artifact.title || '产品需求文档',
      subtitle: `v${artifact.version} · ${modelLabel(content.model)} · 可直接进入评审`,
      size: 'wide',
      body: `<article class="markdown">${renderMarkdown(markdown)}</article>`,
      bodyClass: 'pad',
      actions: `
        <button class="btn btn-sm" type="button" data-prd-copy>${icon('copy')} 复制全文</button>
        <button class="btn btn-sm" type="button" data-prd-regenerate>${icon('refresh')} 重新生成</button>
        <a class="btn btn-sm btn-dark" href="${attrs(downloadUrl(artifact))}" download>${icon('download')} 下载 .md</a>`,
      onMount: (body, close) => {
        body.closest('.modal').querySelector('[data-prd-copy]')?.addEventListener('click', async () => {
          const ok = await copyText(markdown);
          toast(ok ? 'PRD 已复制到剪贴板' : '复制失败，请手动选择', ok ? 'success' : 'error');
        });
        body.closest('.modal').querySelector('[data-prd-regenerate]')?.addEventListener('click', async () => {
          close();
          try {
            const next = await ensureArtifact('prd', { force: true });
            toast('PRD 已更新');
            openPrd(next);
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      },
    });
  }

  function slideHtml(slide, index, total, deck, accent) {
    const layout = slide.layout || (index === 0 ? 'cover' : 'points');
    const kicker = esc(slide.kicker || '');
    const title = esc(slide.title || '');
    const bullets = (slide.bullets || []).filter(Boolean).map(esc);
    const page = `<span class="slide-page">${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>`;
    if (layout === 'cover') {
      const shot = state.data.project.thumb;
      return `<div class="slide slide-cover" style="--slide-accent:${esc(accent)}">
        <div class="slide-kicker">${kicker || 'ATOMS STUDIO · 2026'}</div>
        <div class="slide-cover-copy">
          <h2>${title || esc(deck.title || '')}</h2>
          <p class="slide-sub">${esc(bullets[0] || deck.subtitle || '')}</p>
          <div class="slide-foot"><span class="dot-live"></span> ${esc(deck.title || '')} · 由 Atoms Studio 生成</div>
        </div>
        ${shot ? `<div class="slide-cover-visual"><img src="${attrs(shot)}" alt=""></div>` : `<div class="slide-cover-emoji">${esc(state.data.project.emoji || '✦')}</div>`}
        ${page}
      </div>`;
    }
    if (layout === 'quote') {
      return `<div class="slide slide-quote" style="--slide-accent:${esc(accent)}">
        <div class="quote-mark">“</div>
        <div class="slide-kicker">${kicker}</div>
        <blockquote>${title}</blockquote>
        <div class="slide-foot">${esc(deck.title || '')}</div>
        ${page}
      </div>`;
    }
    if (layout === 'closing') {
      return `<div class="slide slide-closing" style="--slide-accent:${esc(accent)}">
        <div class="slide-kicker">${kicker || 'THANK YOU'}</div>
        <h2>${title || '谢谢观看'}</h2>
        <div class="closing-bullets">${bullets.map((bullet) => `<span>${bullet}</span>`).join('')}</div>
        <div class="slide-foot">${esc(deck.title || '')} · Atoms Studio</div>
        ${page}
      </div>`;
    }
    return `<div class="slide slide-points" style="--slide-accent:${esc(accent)}">
      <div class="slide-kicker">${kicker}</div>
      <h2>${title}</h2>
      <ul>${bullets.map((bullet) => `<li>${bullet}</li>`).join('')}</ul>
      <div class="slide-foot"><span>${esc(deck.title || '')}</span><span>ATOMS STUDIO</span></div>
      ${page}
    </div>`;
  }

  function openSlides(artifact) {
    const content = artifactContent(artifact);
    const deck = content.deck || {};
    const slides = Array.isArray(deck.slides) ? deck.slides : [];
    const accent = content.accent || state.data.project.accent || '#4b44d6';
    if (!slides.length) return toast('这套幻灯片还没有内容', 'error');
    let index = 0;
    openModal({
      title: artifact.title || '演示幻灯片',
      subtitle: `v${artifact.version} · ${slides.length} 页 · ${modelLabel(content.model)}`,
      size: 'wide',
      bodyClass: '',
      body: `<div class="deck-view">
        <div class="deck-toolbar">
          <span>DECK · 16:9</span><span class="spacer"></span>
          <span id="deckCounter">01 / ${String(slides.length).padStart(2, '0')}</span>
          <span class="deck-nav">
            <button type="button" data-deck-prev aria-label="上一页">←</button>
            <button type="button" data-deck-next aria-label="下一页">→</button>
            <button type="button" data-deck-fullscreen>全屏演示</button>
          </span>
        </div>
        <div class="deck-stage-wrap"><div class="deck-stage" id="deckStage"></div></div>
        <div class="deck-thumbs" id="deckThumbs"></div>
      </div>`,
      actions: `<a class="btn btn-sm btn-dark" href="${attrs(downloadUrl(artifact))}" download>${icon('download')} 导出 PPTX</a>`,
      onMount: (body) => {
        const stage = body.querySelector('#deckStage');
        const thumbs = body.querySelector('#deckThumbs');
        const counter = body.querySelector('#deckCounter');
        const paint = () => {
          stage.innerHTML = slideHtml(slides[index], index, slides.length, deck, accent);
          counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
          thumbs.querySelectorAll('.deck-thumb').forEach((thumb, thumbIndex) => thumb.classList.toggle('active', thumbIndex === index));
        };
        thumbs.innerHTML = slides.map((slide, slideIndex) => `<button class="deck-thumb ${slideIndex === 0 ? 'active' : ''}" type="button" data-deck-index="${slideIndex}"><span>${String(slideIndex + 1).padStart(2, '0')} · ${esc(slide.layout || 'points')}</span><strong>${esc(slide.title || '未命名')}</strong></button>`).join('');
        const go = (next) => {
          index = (next + slides.length) % slides.length;
          paint();
        };
        paint();
        body.querySelector('[data-deck-prev]')?.addEventListener('click', () => go(index - 1));
        body.querySelector('[data-deck-next]')?.addEventListener('click', () => go(index + 1));
        thumbs.addEventListener('click', (event) => {
          const button = event.target.closest('[data-deck-index]');
          if (!button) return;
          index = Number(button.dataset.deckIndex);
          paint();
        });
        const fullscreen = () => {
          if (stage.requestFullscreen) stage.requestFullscreen().catch(() => toast('当前浏览器不支持全屏', 'error'));
        };
        body.querySelector('[data-deck-fullscreen]')?.addEventListener('click', fullscreen);
        const onKey = (event) => {
          if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); go(index + 1); }
          if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
          if (event.key === 'f' || event.key === 'F') fullscreen();
        };
        document.addEventListener('keydown', onKey);
        const originalClose = document.querySelector('.modal-close');
        if (originalClose) {
          const observer = new MutationObserver(() => {
            if (!document.body.contains(stage)) {
              document.removeEventListener('keydown', onKey);
              observer.disconnect();
            }
          });
          observer.observe(document.getElementById('modal-root'), { childList: true });
        }
      },
    });
  }

  function openReport(artifact) {
    const content = artifactContent(artifact);
    const checks = content.checks || [];
    const summary = content.summary || {};
    const score = summary.score ?? 0;
    const statusIcon = { pass: 'checkSmall', warn: 'warn', fail: 'fail' };
    openModal({
      title: artifact.title || '验收报告',
      subtitle: `v${artifact.version} · 每次生成后自动运行`,
      size: 'wide',
      body: `<div class="report-view">
        <div class="report-hero">
          <div class="report-score">${score}<small>/100</small></div>
          <div class="report-hero-info">
            <h2>${summary.failed ? '有检查项需要关注' : summary.warned ? '基本通过，有几项提示' : '全部检查通过'}</h2>
            <p>${summary.total || checks.length} 项检查 · ${summary.passed || 0} 通过 · ${summary.warned || 0} 提示 · ${summary.failed || 0} 失败</p>
            <div class="report-bar"><i style="width:${score}%"></i></div>
          </div>
          <div class="report-summary">
            <span>PREVIEW</span><span>SYNTAX</span><span>PERSISTENCE</span><span>RESPONSIVE</span>
          </div>
        </div>
        <div class="check-list">
          ${checks.map((check) => `<div class="check-row">
            <span class="check-status ${check.status}">${icon(statusIcon[check.status] || 'checkSmall')}</span>
            <div class="check-info"><h3>${esc(check.label)}</h3><p>${esc(check.detail)}</p></div>
            <span class="check-tag">${String(check.status).toUpperCase()}</span>
          </div>`).join('')}
        </div>
        <p class="report-note">报告生成于 ${esc(formatDate(content.generatedAt))} · 模型 ${esc(modelLabel(content.model))}。检查在预览真实渲染后运行，包括 atomsStore 的写入、读取与删除往返。</p>
      </div>`,
      actions: `<button class="btn btn-sm" type="button" data-report-refresh>${icon('refresh')} 重新检查</button><a class="btn btn-sm btn-dark" href="${attrs(downloadUrl(artifact))}" download>${icon('download')} 下载 .md</a>`,
      onMount: (body, close) => {
        body.closest('.modal').querySelector('[data-report-refresh]')?.addEventListener('click', async () => {
          close();
          try {
            await ensureArtifact('report', { force: true });
            toast('验收报告已更新');
            const next = artifactFor('report');
            if (next) openReport(next);
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      },
    });
  }

  function openShare() {
    const p = state.data.project;
    const url = `${window.location.origin}/s/${p.slug}`;
    openModal({
      title: '分享这个应用',
      subtitle: '公开链接不需要登录，打开即可体验。',
      size: 'narrow',
      body: `<div class="share-preview">
        <span class="app-emoji">${esc(p.emoji || '✦')}</span>
        <div><h3>${esc(p.name)}</h3><p>${esc(p.summary || p.prompt || '')}</p></div>
        <div class="share-toggle"><span>${p.shareEnabled ? '公开' : '仅自己'}</span><button class="switch ${p.shareEnabled ? 'on' : ''}" type="button" data-share-toggle aria-label="切换公开分享"></button></div>
      </div>
      <div class="share-row"><div class="link-box">${esc(url)}</div><button class="btn btn-dark" type="button" data-share-copy>${icon('copy')} 复制链接</button></div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <a class="btn" href="${attrs(url)}" target="_blank" rel="noreferrer">打开分享页 ${icon('external')}</a>
        <a class="btn btn-ghost" href="/preview/${p.id}/${p.currentVersion}/" target="_blank" rel="noreferrer">打开原始应用 ${icon('external')}</a>
      </div>
      <p style="font-family:var(--mono);font-size:8px;color:var(--faint);margin-top:16px;line-height:1.7">分享页会以全屏方式呈现生成的应用，并带有一个返回 Atoms Studio 的小标识。关闭公开分享后，链接会显示未公开提示。</p>`,
      onMount: (body) => {
        const copyButton = body.closest('.modal').querySelector('[data-share-copy]');
        copyButton?.addEventListener('click', async () => {
          const ok = await copyText(url);
          toast(ok ? '分享链接已复制' : '复制失败，请手动选择链接', ok ? 'success' : 'error');
        });
        const toggle = body.closest('.modal').querySelector('[data-share-toggle]');
        toggle?.addEventListener('click', async () => {
          const next = !state.data.project.shareEnabled;
          try {
            await api.patch(`/api/projects/${p.id}`, { shareEnabled: next });
            state.data.project.shareEnabled = next;
            toggle.classList.toggle('on', next);
            toggle.parentElement.querySelector('span').textContent = next ? '公开' : '仅自己';
            toast(next ? '已开启公开分享' : '已关闭公开分享');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      },
    });
  }

  function openMore() {
    const p = state.data.project;
    openModal({
      title: '项目操作',
      subtitle: `创建于 ${formatDate(p.createdAt, { year: 'numeric' })}`,
      size: 'narrow',
      body: `<div style="display:grid;gap:8px">
        <button class="btn" type="button" data-more="rename">${icon('spark')} 重命名应用</button>
        <button class="btn" type="button" data-more="download">${icon('download')} 下载当前版本 HTML</button>
        <button class="btn" type="button" data-more="refresh">${icon('refresh')} 重新生成缩略图</button>
        <button class="btn btn-danger" type="button" data-more="delete" ${p.isSeed ? 'disabled' : ''}>${icon('trash')} 删除这个项目</button>
      </div>
      <p style="font-family:var(--mono);font-size:8px;color:var(--faint);margin-top:14px">示例应用不能被删除。删除操作不可恢复。</p>`,
      onMount: (body, close) => {
        const modal = body.closest('.modal');
        modal.querySelector('[data-more="rename"]')?.addEventListener('click', () => {
          close();
          renameProject();
        });
        modal.querySelector('[data-more="download"]')?.addEventListener('click', () => { close(); downloadHtml(); });
        modal.querySelector('[data-more="refresh"]')?.addEventListener('click', async () => {
          close();
          try {
            await api.post(`/api/projects/${p.id}/screenshot`, {});
            toast('缩略图已更新');
            await refreshProject();
            paintAll();
          } catch (error) {
            toast(error.message, 'error');
          }
        });
        modal.querySelector('[data-more="delete"]')?.addEventListener('click', async () => {
          close();
          try {
            await api.del(`/api/projects/${p.id}`);
            toast('项目已删除');
            window.navigate('/');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      },
    });
  }

  function renameProject() {
    const p = state.data.project;
    openModal({
      title: '重命名应用',
      size: 'narrow',
      body: `<form class="modal-form" id="renameForm"><label for="renameInput">应用名称</label><input id="renameInput" value="${attrs(p.name)}" maxlength="40" autocomplete="off"><div class="modal-form-actions"><button class="btn" type="button" data-rename-cancel>取消</button><button class="btn btn-dark" type="submit">保存</button></div></form>`,
      onMount: (body, close) => {
        const form = body.querySelector('#renameForm');
        const input = body.querySelector('#renameInput');
        input.focus();
        input.select();
        body.querySelector('[data-rename-cancel]')?.addEventListener('click', close);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const name = input.value.trim();
          if (!name) return;
          try {
            await api.patch(`/api/projects/${p.id}`, { name });
            state.data.project.name = name;
            await refreshProject();
            document.title = `${name} · Atoms Studio`;
            paintAll();
            close();
            toast('名称已更新');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      },
    });
  }

  async function restoreVersion(number) {
    try {
      toast(`正在恢复 v${number}…`);
      const result = await api.post(`/api/projects/${state.projectId}/versions/${number}/restore`, {});
      await refreshProject();
      state.previewVersion = null;
      state.tab = 'preview';
      paintAll();
      toast(`已恢复并发布为 v${result.version.number}`);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  /* ------------------------------ binding ------------------------------- */

  function bindEvents() {
    const onRootClick = async (event) => {
      const tab = event.target.closest('[data-tab]');
      if (tab && !tab.dataset.action) { setTab(tab.dataset.tab); return; }
      if (event.target.closest('[data-action="goto-tab"]')) { setTab(event.target.closest('[data-action="goto-tab"]').dataset.tab); return; }
      if (event.target.closest('[data-action="retry"]')) { retryGeneration(); return; }
      if (event.target.closest('[data-action="sync"]')) { syncProject(true); return; }
      if (event.target.closest('[data-action="share"]')) { openShare(); return; }
      if (event.target.closest('[data-action="new-app"]')) { window.navigate('/'); return; }
      if (event.target.closest('[data-action="more"]')) { openMore(); return; }
      if (event.target.closest('[data-action="reload-preview"]')) { reloadPreview(); return; }
      if (event.target.closest('[data-action="open-preview"]')) { openPreview(); return; }
      if (event.target.closest('[data-action="download"]')) { downloadHtml(); return; }
      if (event.target.closest('[data-action="back-latest"]')) { state.previewVersion = null; paintTab(); return; }
      if (event.target.closest('[data-action="copy-code"]')) {
        try { await copyText((state.data.current?.files || []).map((file) => `/* ${file.path} */\n${file.content}`).join('\n\n')); toast('代码已复制'); } catch { toast('复制失败', 'error'); }
        return;
      }
      if (event.target.closest('[data-action="generate-all"]')) { generateAll(); return; }
      const device = event.target.closest('[data-device]');
      if (device) { setDevice(device.dataset.device); return; }
      const file = event.target.closest('[data-file]');
      if (file) { state.activeFile = file.dataset.file; paintCode(); return; }
      const openArtifactButton = event.target.closest('[data-artifact-open]');
      if (openArtifactButton) { openArtifact(openArtifactButton.dataset.artifactOpen); return; }
      const generateArtifactButton = event.target.closest('[data-artifact-generate]');
      if (generateArtifactButton) {
        const kind = generateArtifactButton.dataset.artifactGenerate;
        try {
          const artifact = await ensureArtifact(kind);
          toast(`${ARTIFACT_META[kind].title}已生成`);
          openArtifact(kind);
        } catch (error) {
          toast(error.message, 'error');
        }
        return;
      }
      const versionPreview = event.target.closest('[data-version-preview]');
      if (versionPreview) { state.previewVersion = Number(versionPreview.dataset.versionPreview); setTab('preview'); return; }
      const versionRestore = event.target.closest('[data-version-restore]');
      if (versionRestore) { restoreVersion(Number(versionRestore.dataset.versionRestore)); return; }
      const suggest = event.target.closest('[data-suggest]');
      if (suggest) {
        const input = $('#chatInput');
        if (input) { input.value = suggest.dataset.suggest; input.focus(); }
        return;
      }
    };
    root.addEventListener('click', onRootClick);

    const onKeydown = (event) => {
      if (event.target.id === 'chatInput') {
        if (event.isComposing) return;
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          submitPrompt();
        }
      }
    };
    root.addEventListener('keydown', onKeydown);

    root.addEventListener('click', (event) => {
      if (event.target.closest('#sendBtn')) submitPrompt();
    });

    const onInput = (event) => {
      if (event.target.id === 'chatInput') {
        const el = event.target;
        el.style.height = 'auto';
        el.style.height = `${Math.min(140, Math.max(44, el.scrollHeight))}px`;
      }
    };
    root.addEventListener('input', onInput);

    let lastAutoSync = 0;
    const autoSync = () => {
      if (document.visibilityState === 'hidden' || state.busy) return;
      if (Date.now() - lastAutoSync < 8000) return;
      lastAutoSync = Date.now();
      refreshProject()
        .then((data) => {
          if (data.project.updatedAt !== state.data.project.updatedAt) paintAll();
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', autoSync);
    window.addEventListener('focus', autoSync);
    cleanupFns.push(() => root.removeEventListener('click', onRootClick));
    cleanupFns.push(() => root.removeEventListener('keydown', onKeydown));
    cleanupFns.push(() => root.removeEventListener('input', onInput));
    cleanupFns.push(() => document.removeEventListener('visibilitychange', autoSync));
    cleanupFns.push(() => window.removeEventListener('focus', autoSync));
  }

  function cleanup() {
    closeEventSource();
    stopElapsed();
    if (state.streamRaf) cancelAnimationFrame(state.streamRaf);
    cleanupFns.forEach((fn) => fn());
    closeModal();
  }

  return { cleanup };
}
