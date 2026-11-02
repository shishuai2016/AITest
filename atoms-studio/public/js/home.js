import { api } from './api.js';
import {
  $, $$, esc, attrs, formatNumber, timeAgo, icon, toast, brandMark, thumbHtml, themeButton, initTheme, toggleTheme,
} from './ui.js';

export async function renderHome(root) {
  initTheme();
  document.title = 'Atoms Studio · 把一句话变成一个能用的应用';
  let data = null;
  try {
    data = await api.get('/api/home');
  } catch (error) {
    root.innerHTML = `<div class="not-found"><div><h1>暂时连不上工作室</h1><p>${esc(error.message)}</p><button class="btn btn-dark" onclick="location.reload()">重新加载</button></div></div>`;
    return {};
  }

  const templates = data.templates || [];
  const seeds = data.seeds || [];
  const recent = (data.recent || []).filter((project) => !project.isSeed);
  const heroSeed = seeds[0];
  const stats = data.stats || {};

  root.innerHTML = `
  <div class="home view">
    <nav class="site-nav" aria-label="主导航">
      <div class="site-nav-inner">
        <a class="brand" href="/" aria-label="Atoms Studio 首页">
          ${brandMark(32)}
          <span class="brand-name">Atoms Studio<small>AGENTIC APP STUDIO</small></span>
        </a>
        <div class="nav-links">
          <a href="#works">作品</a>
          <a href="#templates">模板</a>
          <a href="#deliverables">交付物</a>
          <a href="#how">如何工作</a>
        </div>
        <div class="nav-actions">
          <span class="nav-model"><i class="dot-live"></i>${data.llm?.enabled ? 'DeepSeek · 在线' : '本地演示引擎'}</span>
          ${themeButton()}
          <a class="btn btn-dark nav-cta" href="#composer">开始创作 ${icon('arrow')}</a>
        </div>
      </div>
    </nav>

    <header class="hero">
      <div class="hero-copy">
        <div class="eyebrow"><span class="dot-live"></span> ATOMS STUDIO · 智能体应用工坊</div>
        <h1>把一句话，<br>变成一个<em>能用的</em><br><span class="mark-lime">应用</span>。</h1>
        <p class="hero-sub">告诉 Atoms 你想做什么。它会像一个产品团队那样理解需求、规划界面、写出代码，然后交给你一个<strong>真正可以点、数据会保存、还能分享</strong>的网页应用。</p>

        <form class="composer-card" id="heroComposer" autocomplete="off">
          <div class="composer-main">
            <span class="composer-spark">${icon('spark')}</span>
            <label class="sr-only" for="heroPrompt">描述你想做的应用</label>
            <textarea id="heroPrompt" rows="2" maxlength="2000" placeholder="例如：做一个给自由职业者用的项目报价单，可以添加项目、计算总价、导出报价，数据要保存下来。"></textarea>
          </div>
          <div class="composer-foot">
            <div class="prompt-chips">
              ${templates.slice(0, 3).map((template) => `<button class="chip" type="button" data-template="${attrs(template.prompt)}">${esc(template.emoji)} ${esc(template.title)}</button>`).join('')}
              <span class="chip accent" id="randomIdea">换一个灵感</span>
            </div>
            <button class="generate-btn" id="generateBtn" type="submit">生成应用 <span class="arrow">${icon('arrow')}</span></button>
          </div>
        </form>
        <div class="composer-note">
          <span>${icon('checkSmall')} 无需注册</span>
          <span>${icon('checkSmall')} 数据自动持久化</span>
          <span>${icon('checkSmall')} PRD / PPT / 报告随应用交付</span>
        </div>
      </div>

      <div class="hero-visual" aria-label="生成结果预览">
        <div class="visual-glow"></div>
        <div class="orbit-ring one"></div>
        <div class="orbit-ring two"></div>
        <div class="preview-stack">
          <div class="browser-mock">
            <div class="browser-bar">
              <span class="browser-dots"><i></i><i></i><i></i></span>
              <span class="browser-url" id="heroUrl">/s/${esc(heroSeed?.slug || 'focus-flow')}</span>
              <span class="browser-live"><i></i>LIVE</span>
            </div>
            <div class="shot-frame" id="heroShot">
              <div class="shot-placeholder">${esc(heroSeed?.emoji || '✦')}</div>
            </div>
          </div>
          <div class="float-card top-left">
            <span class="fc-icon">${icon('check')}</span>
            <span><strong>生成完成 · v1</strong><span>15 / 15 checks passed</span></span>
          </div>
          <div class="float-card top-right">
            <span class="fc-icon accent">${icon('deck')}</span>
            <span><strong>PRD + DECK</strong><span>一键交付</span></span>
          </div>
          <div class="float-card bottom-right">
            <span class="fc-icon">${icon('layers')}</span>
            <span><strong>数据已持久化</strong><span>atomsStore · SQLite</span></span>
          </div>
          <p class="shot-caption">${esc(heroSeed?.name || 'Focus Flow')} · 由 Atoms 生成的真实应用</p>
        </div>
      </div>
    </header>

    <div class="stat-strip" aria-label="工作室数据">
      <div class="stat"><strong data-count="${stats.totalProjects || seeds.length}">0</strong><span>已发布应用</span></div>
      <div class="stat"><strong data-count="${stats.versions || 0}">0</strong><span>生成版本</span></div>
      <div class="stat"><strong data-count="${stats.artifacts || 0}">0</strong><span>交付文档</span></div>
      <div class="stat"><strong data-count="${stats.todayProjects || 0}">0</strong><span>今日新建</span></div>
      <div class="stat-note">从想法到可用产品 · 平均一小时内</div>
    </div>

    <div class="marquee-wrap" aria-hidden="true">
      <div class="marquee">
        ${['WEB APP', 'PERSISTENT DATA', 'LIVE PREVIEW', 'PRODUCT PRD', 'SLIDE DECK', 'QA REPORT', 'SHARE LINK', 'VERSION HISTORY'].map((item) => `<span>${item}</span>`).join('')}
        ${['WEB APP', 'PERSISTENT DATA', 'LIVE PREVIEW', 'PRODUCT PRD', 'SLIDE DECK', 'QA REPORT', 'SHARE LINK', 'VERSION HISTORY'].map((item) => `<span>${item}</span>`).join('')}
      </div>
    </div>

    <section class="section" id="works">
      <div class="section-head">
        <div>
          <div class="eyebrow">01 · SELECTED WORKS</div>
          <h2 class="section-title">刚刚被做出来的<em>东西</em>。</h2>
          <p class="section-sub">不是截图，不是概念稿。每一张卡片背后都是一个可以打开、可以操作的真实应用。</p>
        </div>
        <a class="section-link" href="#works">全部作品 ${icon('arrow')}</a>
      </div>
      <div class="gallery" id="seedGallery">${gallerySkeleton(3)}</div>
    </section>

    <section class="section ${recent.length ? '' : 'hidden'}" id="recent">
      <div class="section-head">
        <div>
          <div class="eyebrow">02 · RECENTLY MADE</div>
          <h2 class="section-title">最近生成。</h2>
          <p class="section-sub">来自这个工作室里的真实想法。打开它，看看别人让智能体做了什么。</p>
        </div>
      </div>
      <div class="gallery" id="recentGallery"></div>
    </section>

    <section class="section" id="templates">
      <div class="section-head">
        <div>
          <div class="eyebrow">03 · STARTING POINTS</div>
          <h2 class="section-title">从一个<em>起点</em>开始。</h2>
          <p class="section-sub">选一个模板填入想法，或者直接写下你自己的。每一个词都会影响最终生成的产品。</p>
        </div>
      </div>
      <div class="template-grid">
        ${templates.map((template, index) => `
          <button class="template-card" type="button" data-template="${attrs(template.prompt)}">
            <span class="template-emoji">${esc(template.emoji)}</span>
            <span><strong>${esc(template.title)}</strong><span>${esc(template.category)} · TEMPLATE ${String(index + 1).padStart(2, '0')}</span></span>
            <span class="t-arrow">${icon('arrow')}</span>
          </button>`).join('')}
      </div>
    </section>

    <section class="section" id="deliverables">
      <div class="section-head">
        <div>
          <div class="eyebrow">04 · BEYOND THE SCREEN</div>
          <h2 class="section-title">交付的，不止是<em>网页</em>。</h2>
          <p class="section-sub">应用生成完成后，同一个智能体会继续产出可以直接拿去评审和演示的材料，并附上一份真实的自动验收报告。</p>
        </div>
      </div>
      <div class="deliverables">
        <article class="deliverable-card">
          <div class="deliverable-visual">
            <div class="dv-title">书笺 · 产品需求文档</div>
            <div class="dv-line w90"></div>
            <div class="dv-line w70"></div>
            <div class="dv-line w45 accent"></div>
            <div class="dv-line w90"></div>
            <div class="dv-line w70"></div>
          </div>
          <div><h3>需求文档 PRD</h3><p>根据真实生成的应用反向整理：目标用户、场景、功能表、验收标准，而不是空泛模板。</p></div>
          <div class="deliverable-meta">MARKDOWN · 可导出 · 可继续编辑</div>
        </article>
        <article class="deliverable-card">
          <div class="deliverable-visual">
            <div class="dv-slide"><span>ATOMS STUDIO · 2026</span><strong>把今天过成一条清楚的线</strong></div>
          </div>
          <div><h3>演示幻灯片</h3><p>7 页发布会节奏的演示稿，自动匹配应用气质，带演讲备注，可导出为 .pptx 继续修改。</p></div>
          <div class="deliverable-meta">PPTX · 16:9 · SPEAKER NOTES</div>
        </article>
        <article class="deliverable-card">
          <div class="deliverable-visual">
            <div class="dv-checks">
              <div class="dv-check"><i></i>预览可访问 · HTTP 200</div>
              <div class="dv-check"><i></i>JavaScript 语法 · PASS</div>
              <div class="dv-check"><i></i>服务端持久化 · PASS</div>
              <div class="dv-check warn"><i></i>外部资源 · 无依赖</div>
              <div class="dv-check"><i></i>验收评分 · 100 / 100</div>
            </div>
          </div>
          <div><h3>自动验收报告</h3><p>每次生成后自动跑一遍预览、脚本、资源与数据持久化检查，把「能演示」变成可验证的结论。</p></div>
          <div class="deliverable-meta">REAL CHECKS · 每次版本自动生成</div>
        </article>
      </div>
    </section>

    <section class="section" id="how">
      <div class="section-head">
        <div>
          <div class="eyebrow">05 · HOW IT WORKS</div>
          <h2 class="section-title">像一个产品团队一样<em>工作</em>。</h2>
        </div>
      </div>
      <div class="steps-grid">
        <div class="step-col">
          <span class="step-num">STEP 01</span>
          <h3>理解与规划</h3>
          <p>智能体先把一句话拆成产品名、定位、核心功能和实现步骤。不是直接开始写代码，而是先想清楚要做什么。</p>
          <div class="step-tags"><span>PLAN</span><span>UX</span><span>DATA MODEL</span></div>
        </div>
        <div class="step-col">
          <span class="step-num">STEP 02</span>
          <h3>生成与自检</h3>
          <p>流式写出 HTML、CSS 与交互代码，立刻在沙箱里渲染。语法、资源、持久化都会被自动检查，不通过就让智能体自己修。</p>
          <div class="step-tags"><span>STREAM</span><span>PREVIEW</span><span>SELF-HEAL</span></div>
        </div>
        <div class="step-col">
          <span class="step-num">STEP 03</span>
          <h3>迭代与交付</h3>
          <p>用自然语言继续改，每一次修改都是一个可回溯的版本。满意之后，一键分享、下载 HTML，或者让智能体把文档和 PPT 一起补齐。</p>
          <div class="step-tags"><span>VERSIONS</span><span>SHARE</span><span>DELIVERABLES</span></div>
        </div>
      </div>
    </section>

    <footer class="home-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          ${brandMark(36)}
          <div><strong>Atoms Studio</strong><p>AGENTIC APP STUDIO · DEMO</p></div>
        </div>
        <div class="footer-links">
          <a href="#works">作品</a>
          <a href="#templates">模板</a>
          <a href="#deliverables">交付物</a>
          <a href="#how">如何工作</a>
        </div>
        <div class="footer-links">
          <span>数据持久化 · SQLite</span>
          <span>无需注册</span>
          <span>${data.llm?.enabled ? '由豆包 / DeepSeek 驱动' : '内置演示引擎'}</span>
        </div>
      </div>
      <div class="footer-inner" style="padding-top:0;padding-bottom:26px">
        <div class="footer-note">
          <span>© 2026 ATOMS STUDIO · A DEMO BUILT WITH AGENTS</span>
          <span>生成的应用由智能体编写，请在使用前自行检查。</span>
        </div>
      </div>
    </footer>
  </div>`;

  // Hero screenshot
  if (heroSeed) {
    const frame = $('#heroShot');
    if (frame && heroSeed.thumb) {
      const img = document.createElement('img');
      img.src = heroSeed.thumb;
      img.alt = `${heroSeed.name} 界面预览`;
      img.onerror = () => img.remove();
      frame.appendChild(img);
    }
    const url = $('#heroUrl');
    if (url) url.textContent = `/s/${heroSeed.slug}`;
  }

  // Galleries
  const seedGallery = $('#seedGallery');
  seedGallery.innerHTML = seeds.length ? seeds.map((project) => appCard(project, true)).join('') : emptyGallery('还没有精选作品');
  if (recent.length) {
    $('#recentGallery').innerHTML = recent.map((project) => appCard(project, false)).join('');
  }

  // Stat count-up
  $$('.stat strong[data-count]').forEach((el) => {
    const target = Number(el.dataset.count || 0);
    const started = performance.now();
    const duration = 700;
    const tick = (timestamp) => {
      const progress = Math.min(1, (timestamp - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = formatNumber(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Hero composer
  const form = $('#heroComposer');
  const prompt = $('#heroPrompt');
  const generateBtn = $('#generateBtn');
  const submit = async () => {
    const value = prompt.value.trim();
    if (value.length < 4) {
      prompt.focus();
      toast('再写具体一点：它给谁用、解决什么问题、至少要有哪些操作。', 'error');
      return;
    }
    generateBtn.disabled = true;
    generateBtn.innerHTML = `正在创建 <span class="arrow">${icon('spark')}</span>`;
    try {
      const result = await api.post('/api/projects', { prompt: value });
      window.navigate?.(`/studio/${result.project.id}?job=${encodeURIComponent(result.jobId)}`);
    } catch (error) {
      toast(error.message, 'error');
      generateBtn.disabled = false;
      generateBtn.innerHTML = `生成应用 <span class="arrow">${icon('arrow')}</span>`;
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  prompt.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
  prompt.addEventListener('input', () => {
    prompt.style.height = 'auto';
    prompt.style.height = `${Math.min(180, Math.max(62, prompt.scrollHeight))}px`;
  });

  $$('[data-template]').forEach((button) => {
    button.addEventListener('click', () => {
      prompt.value = button.dataset.template;
      prompt.focus();
      prompt.dispatchEvent(new Event('input'));
      document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  const ideas = [
    '做一个自由职业者的项目报价单：添加项目、自动计算总价与税费、导出报价，数据保存下来。',
    '做一个独立书店的选书推荐页：按情绪和场景过滤书单，可以收藏，视觉像一张手写书签。',
    '做一个面向小团队的周报生成器：填写进展、风险和下周计划，自动整理成可复制的周报。',
    '做一个个人旅行足迹地图：按年份记录去过的城市，点击查看当时的照片和一句话记忆。',
    '做一个健身房会员管理看板：查看会员状态、到期提醒、签到记录和本月收入。',
  ];
  let ideaIndex = 0;
  $('#randomIdea')?.addEventListener('click', () => {
    ideaIndex = (ideaIndex + 1) % ideas.length;
    prompt.value = ideas[ideaIndex];
    prompt.focus();
    prompt.dispatchEvent(new Event('input'));
  });

  return {};
}

function appCard(project, curated = false) {
  const artifacts = project.artifactKinds || [];
  return `<a class="app-card" href="/studio/${attrs(project.id)}" aria-label="打开 ${attrs(project.name)}">
    <div class="app-thumb">
      <span class="thumb-tag">${curated ? 'CURATED' : 'JUST MADE'} · ${esc(project.category || '应用')}</span>
      ${thumbHtml(project)}
    </div>
    <div class="app-card-body">
      <div class="app-title-row">
        <span class="app-emoji">${esc(project.emoji || '✦')}</span>
        <span class="app-title">${esc(project.name)}</span>
        <span class="app-cat">${esc(project.category || '')}</span>
      </div>
      <p class="app-summary">${esc(project.summary || project.prompt || '')}</p>
      <div class="app-meta">
        <span>v${project.currentVersion || 1} · ${timeAgo(project.updatedAt)}</span>
        <span class="artifacts">
          ${artifacts.includes('prd') ? '<span class="art">PRD</span>' : ''}
          ${artifacts.includes('slides') ? '<span class="art">PPT</span>' : ''}
          ${artifacts.includes('report') ? '<span class="art">QA</span>' : ''}
        </span>
        <span style="margin-left:auto">打开 ${icon('arrow')}</span>
      </div>
    </div>
  </a>`;
}

function gallerySkeleton(count) {
  return Array.from({ length: count }).map(() => `
    <div class="app-card" aria-hidden="true">
      <div class="app-thumb skeleton"></div>
      <div class="app-card-body"><div class="skeleton" style="height:16px;width:60%"></div><div class="skeleton" style="height:10px;width:90%"></div><div class="skeleton" style="height:10px;width:75%"></div></div>
    </div>`).join('');
}

function emptyGallery(message) {
  return `<div class="gallery-empty" style="grid-column:1/-1">${esc(message)}</div>`;
}
