import fs from 'node:fs';
import path from 'node:path';
import { all, get, jsonParse, run } from './db.js';
import { createProject, saveVersion, addMessage, upsertArtifact, getProject } from './repo.js';
import { staticChecks } from './validate.js';
import { buildReport } from './checks.js';

const SEED_DIR = path.resolve('seed');

function readFiles(dir) {
  return ['index.html', 'styles.css', 'app.js'].map((file) => ({
    path: file,
    content: fs.readFileSync(path.join(SEED_DIR, dir, file), 'utf8'),
  }));
}

const SEEDS = [
  {
    dir: 'focus-flow',
    slug: 'focus-flow',
    name: 'Focus Flow',
    emoji: '◎',
    accent: '#2F5D50',
    category: '效率工具',
    summary: '把今天过成一条清楚的线：一份安静的任务清单，和一个专注计时器。',
    prompt: '做一个安静、克制的个人效率应用：左边是今天的任务清单，可以添加、完成、筛选；右边是番茄钟，可以开始/暂停/重置，完成后记录专注段。整体像一张纸，不要花哨。',
    plan: ['先做任务清单与筛选', '加入番茄钟与专注统计', '接通本地持久化与空状态'],
    features: ['任务增删改查与筛选', '25/5 分钟专注计时', '今日完成率与专注统计', '服务端持久化'],
    prd: `# Focus Flow · 产品需求文档

## 产品概述
Focus Flow 是一个安静的个人效率工具，把「今天要做什么」和「现在专注多久」放在同一屏里。它不追求游戏化激励，而是用克制的视觉和清晰的节奏，帮用户把注意力放回眼前的事。

## 目标用户与场景
- 需要在一天开始时梳理 3-5 件重要事项的知识工作者。
- 容易被打断、希望用番茄钟建立专注节奏的人。
- 场景：早晨打开应用 → 记下今天的事 → 选一件开始 25 分钟专注 → 完成后勾选并休息。

## 核心使用流程
1. 打开应用，看到今日任务和计时器。
2. 输入任务并回车，任务进入清单。
3. 点击开始专注，25 分钟后自动切换到 5 分钟休息。
4. 勾选完成的任务，完成率环与统计同步更新。
5. 刷新页面，任务与专注记录仍在。

## 功能需求
| 编号 | 功能 | 优先级 | 验收要点 |
| --- | --- | --- | --- |
| F1 | 任务新增 | P0 | 输入 ≥2 字可添加，空输入有提示 |
| F2 | 任务完成/删除 | P0 | 勾选有删除线，删除后立即消失 |
| F3 | 筛选与清除 | P0 | 全部/进行中/已完成切换正确 |
| F4 | 专注计时 | P0 | 开始、暂停、重置、模式切换可用 |
| F5 | 专注统计 | P1 | 完成段数、分钟数、完成率实时更新 |
| F6 | 持久化 | P0 | 刷新或换设备后数据保留 |
| F7 | 响应式 | P1 | 390px 下为单列，无横向滚动 |

## 页面与交互说明
- 顶栏：品牌、日期与当前时间。
- 主区：任务面板（标题、进度环、输入框、筛选、列表、底部统计）。
- 侧栏：深绿色专注面板（计时环、开始/重置、模式切换、三项统计）。
- 使用 toast 反馈操作；任务列表为空时有留白式空状态。

## 数据与持久化
使用 \`atomsStore\` 保存 \`ff_tasks\` 与 \`ff_sessions\`，服务端 SQLite 持久化；独立打开时用 localStorage 兜底。首次进入注入示例任务与专注记录。

## 非功能要求
- 无外部字体、图片与 CDN，离线可用。
- 键盘可完成添加与计时操作，焦点样式可见。
- 动效克制，尊重 prefers-reduced-motion。

## 验收标准
- 添加、勾选、删除、筛选均可用。
- 计时器能完整走完一个 25 分钟专注段并记录。
- 刷新后任务和专注记录不丢失。

## 后续迭代建议
- 支持任务分组与优先级。
- 增加周报与专注趋势。
- 与日历/提醒集成。`,
    slides: {
      title: 'Focus Flow',
      subtitle: '把今天过成一条清楚的线',
      slides: [
        { layout: 'cover', kicker: 'ATOMS STUDIO · 2026', title: 'Focus Flow', bullets: ['把今天过成一条清楚的线'], note: '开场：不是又一个待办工具，而是一张安静的今日工作台。' },
        { layout: 'points', kicker: '01 · 问题', title: '待办很多，注意力很少', bullets: ['清单越拉越长，真正做的事没有变多', '专注被打断，重启成本很高', '工具本身也在制造噪音'], note: '用真实的一天说明问题。' },
        { layout: 'quote', kicker: '02 · 洞察', title: '效率不是做得更多，而是更少地被打断。', bullets: [], note: '停顿一下，让这句话落地。' },
        { layout: 'points', kicker: '03 · 产品', title: '一屏，两件事', bullets: ['左边：今天真正要完成的事', '右边：一个 25 分钟的专注计时器', '完成率与专注记录自动汇总'], note: '现场演示添加任务和开始计时。' },
        { layout: 'points', kicker: '04 · 体验', title: '克制，但不是冷淡', bullets: ['纸张质感的暖色背景', '深绿色专注面板，进入工作状态', '每次操作都有轻量反馈'], note: '强调视觉方向：安静、有温度。' },
        { layout: 'points', kicker: '05 · 技术', title: '从生成到可用', bullets: ['三文件结构，预览即所得', 'atomsStore 服务端持久化', '自动验收报告与分享链接'], note: '技术服务于可用性。' },
        { layout: 'closing', kicker: 'THANK YOU', title: '今天，只做三件事。', bullets: ['打开 Focus Flow，写下第一件事'], note: '收尾行动号召。' },
      ],
    },
  },
  {
    dir: 'cafe-ledger',
    slug: 'cafe-ledger',
    name: '拾光咖啡 · 小店流水',
    emoji: '☕',
    accent: '#E0A96D',
    category: '经营分析',
    summary: '一间咖啡馆的每日流水：营收、客单价、趋势与订单，一眼看清。',
    prompt: '给一家独立咖啡馆做一个每日流水看板：深色有质感，展示今日营收、订单数、客单价、本周趋势图、今日订单列表；可以手动记一笔订单，也能删除和筛选，还要能导出 CSV。',
    plan: ['搭好深色经营看板骨架', '接入记一笔与订单管理', '生成趋势图与经营指标'],
    features: ['今日经营指标', '记一笔订单', '7/14 天趋势图', '分类筛选与 CSV 导出'],
    prd: `# 拾光咖啡 · 小店流水 · 产品需求文档

## 产品概述
面向独立咖啡馆经营者的每日经营看板。把「今天赚了多少、卖了多少、什么最好卖」压缩到一屏，让店主在打烊后花两分钟完成经营记录。

## 目标用户与场景
- 1-3 人小店的店主或店长。
- 场景：每完成一单，随手记一笔；打烊后查看今日营收与一周趋势；月底导出流水做核对。

## 核心使用流程
1. 打开看板，看到今日营收、订单数、客单价与热销单品。
2. 在「记一笔」中填写商品、金额、分类并提交。
3. 今日订单列表即时更新，可筛选分类、删除误录。
4. 切换 7/14 天查看趋势；需要时导出 CSV。
5. 次日再次打开，数据仍在。

## 功能需求
| 编号 | 功能 | 优先级 | 验收要点 |
| --- | --- | --- | --- |
| F1 | 今日指标 | P0 | 营收/订单/客单价/热销随数据变化 |
| F2 | 新增订单 | P0 | 商品和金额必填，提交后立即可见 |
| F3 | 订单列表 | P0 | 时间倒序，分类筛选，删除可用 |
| F4 | 趋势图 | P0 | 7/14 天切换，柱高与数值一致 |
| F5 | CSV 导出 | P1 | 中文不乱码，含时间/商品/分类/金额 |
| F6 | 持久化 | P0 | 服务端保存，刷新不丢 |
| F7 | 响应式 | P1 | 手机端表单与列表可用 |

## 页面与交互说明
- 顶栏：品牌、营业状态、日期、导出入口。
- 首屏：大号今日营收 + 近 7 天迷你趋势 + 四项指标卡。
- 中部：一周流水柱状图与「记一笔」表单。
- 底部：今日订单表，含分类筛选与恢复示例数据。

## 数据与持久化
订单数组存入 \`atomsStore\` 的 \`cl_orders\`，字段包含商品、金额、分类、时间戳；服务端 SQLite 持久化。首次加载写入一周演示数据。

## 非功能要求
- 深色界面对比度满足阅读；数字使用等宽数字特性。
- 所有图表用 CSS/内联 SVG 绘制，不依赖图表库。
- 外部网络不可用时仍可记录与查看。

## 验收标准
- 新增一笔后营收、订单数、客单价同步更新。
- 删除订单后所有指标同步减少。
- 刷新页面数据保持，CSV 可下载打开。

## 后续迭代建议
- 商品库与一键点单。
- 毛利与原料成本。
- 多门店/多员工权限。`,
    slides: {
      title: '拾光咖啡 · 小店流水',
      subtitle: '一间小店的经营，从每一笔流水开始',
      slides: [
        { layout: 'cover', kicker: 'ATOMS STUDIO · 2026', title: '拾光咖啡', bullets: ['一间小店的经营，从每一笔流水开始'], note: '开场：为独立咖啡馆做一个真正会用的经营看板。' },
        { layout: 'points', kicker: '01 · 问题', title: '经营数据散在收银机、外卖平台和脑子里', bullets: ['打烊后不知道今天到底赚了多少', '热销单品靠记忆，补货靠感觉', '月底对账要翻三个平台'], note: '从店主的真实动作出发。' },
        { layout: 'quote', kicker: '02 · 洞察', title: '小店不需要复杂 BI，只需要每天两分钟。', bullets: [], note: '产品判断：极简、即时、可信。' },
        { layout: 'points', kicker: '03 · 产品', title: '一屏看清今天', bullets: ['今日营收与客单价', '7/14 天趋势与热销单品', '记一笔、删一笔、导出流水'], note: '现场记一笔订单，展示指标联动。' },
        { layout: 'points', kicker: '04 · 体验', title: '像夜晚的咖啡馆一样安静', bullets: ['深色底 + 琥珀色强调', '数字是第一视觉层级', '表单与列表都在一屏内完成'], note: '视觉方向说明。' },
        { layout: 'points', kicker: '05 · 技术', title: '真实可用的轻应用', bullets: ['纯 CSS/SVG 图表，无第三方依赖', 'atomsStore 服务端持久化', '生成即预置一周演示数据'], note: '展示自动验收与分享链接。' },
        { layout: 'closing', kicker: 'THANK YOU', title: '把今天的流水，记下来。', bullets: ['打开拾光咖啡看板，记第一笔'], note: '行动号召。' },
      ],
    },
  },
  {
    dir: 'habit-loop',
    slug: 'habit-loop',
    name: 'Habit Loop',
    emoji: '◌',
    accent: '#2F6F5E',
    category: '生活方式',
    summary: '用每天一个勾，让好习惯慢慢长出来。',
    prompt: '做一个习惯打卡应用：可以添加多个习惯，每个习惯展示最近 7 天的打卡格，点击即可打卡；显示今日完成率、连续天数和 28 天热力图。界面要温和、有呼吸感，像一本手账。',
    plan: ['设计习惯列表与一周打卡格', '实现连续天数与热力图', '加入新增习惯与持久化'],
    features: ['习惯增删与打卡', '一周打卡格', '连续天数与热力图', '今日完成率'],
    prd: `# Habit Loop · 产品需求文档

## 产品概述
Habit Loop 是一个温和的习惯追踪工具。它不强调连续多少天的压力，而是用「今天有没有出现」帮助用户建立可持续的小习惯。

## 目标用户与场景
- 想养成阅读、运动、喝水、冥想等日常习惯的人。
- 场景：早晨打开看一眼今天要做什么；完成一个习惯后点一下；睡前看一眼这周的整体状态。

## 核心使用流程
1. 打开应用，看到今日完成率、习惯列表和本周打卡格。
2. 点击某一天的格子完成/取消打卡。
3. 新增习惯时选择名称、图标和颜色。
4. 连续天数、28 天热力图和今日进度即时更新。
5. 再次打开，历史记录仍在。

## 功能需求
| 编号 | 功能 | 优先级 | 验收要点 |
| --- | --- | --- | --- |
| F1 | 本周打卡格 | P0 | 7 天日期正确，点击切换状态 |
| F2 | 新增习惯 | P0 | 名称≥2 字，图标与颜色可选 |
| F3 | 删除习惯 | P1 | 二次确认式反馈，列表即时更新 |
| F4 | 连续天数 | P0 | 连续打卡计算正确，中断后重新计数 |
| F5 | 今日进度 | P0 | 完成数与百分比实时更新 |
| F6 | 28 天热力图 | P1 | 颜色深浅与当日完成数对应 |
| F7 | 持久化 | P0 | 刷新后习惯和历史不丢失 |

## 页面与交互说明
- 首屏左侧是标题与说明，右侧是今日进度卡。
- 主卡为习惯列表，每个习惯一行，含 7 个打卡格、连续天数和删除入口。
- 底部为 28 天热力图与每日一句。
- 新增习惯使用居中浮层，Esc 可关闭。

## 数据与持久化
\`hl_habits\` 保存习惯定义，\`hl_checks\` 保存 \`habitId → dayKey → true\` 的打卡记录；服务端 SQLite 持久化，localStorage 兜底。首屏注入 4 个示例习惯与历史打卡。

## 非功能要求
- 浅色、低饱和配色，移动端优先，390px 下单列布局。
- 打卡点击有即时视觉反馈，减少误触。
- 尊重 reduced motion。

## 验收标准
- 打卡和取消打卡可逆，连续天数计算正确。
- 新增习惯后当天即可打卡。
- 刷新后所有记录保持。

## 后续迭代建议
- 周报与提醒。
- 习惯模板与好友共修。
- 数据导出。`,
    slides: {
      title: 'Habit Loop',
      subtitle: '让好习惯自己长出来',
      slides: [
        { layout: 'cover', kicker: 'ATOMS STUDIO · 2026', title: 'Habit Loop', bullets: ['让好习惯自己长出来'], note: '开场：一个不制造压力的习惯工具。' },
        { layout: 'points', kicker: '01 · 问题', title: '打卡工具，常常变成新的压力', bullets: ['连续断一天就想放弃', '提醒太多，反而想关掉', '记录很复杂，坚持很难'], note: '从用户放弃的瞬间讲起。' },
        { layout: 'quote', kicker: '02 · 洞察', title: '习惯不是一条不能断的链，而是一个可以回来的圈。', bullets: [], note: '产品价值观。' },
        { layout: 'points', kicker: '03 · 产品', title: '每天一个勾，就够了', bullets: ['一周打卡格，一眼看到全局', '连续天数与 28 天热力图', '自定义图标与颜色'], note: '现场演示打卡与新增习惯。' },
        { layout: 'points', kicker: '04 · 体验', title: '像手账，而不是 KPI', bullets: ['低饱和的雾蓝与松绿', '留白、圆角、轻动效', '中断后仍然欢迎你回来'], note: '视觉与语气设计。' },
        { layout: 'points', kicker: '05 · 技术', title: '小应用，完整闭环', bullets: ['相对日期自动计算', '服务端持久化与兜底', '自动验收 + 可分享预览'], note: '展示技术可信度。' },
        { layout: 'closing', kicker: 'THANK YOU', title: '从一个很小的习惯开始。', bullets: ['今天读 10 分钟书'], note: '行动号召。' },
      ],
    },
  },
];

export function seedDatabase({ force = false } = {}) {
  let created = 0;
  for (const seed of SEEDS) {
    const existing = get('SELECT * FROM projects WHERE is_seed = 1 AND slug = ?', seed.slug);
    if (existing && !force) continue;
    const files = readFiles(seed.dir);
    if (!files.every((file) => file.content.length > 100)) continue;
    const project = existing || createProject({ prompt: seed.prompt, name: seed.name, summary: seed.summary, emoji: seed.emoji, accent: seed.accent, category: seed.category, slug: seed.slug, status: 'ready', isSeed: true, shareEnabled: true });
    if (!existing) {
      addMessage({ projectId: project.id, role: 'user', content: seed.prompt, kind: 'text' });
    }
    if (!get('SELECT number FROM versions WHERE project_id = ?', project.id)) {
      const checks = staticChecks(files);
      const version = saveVersion({
        projectId: project.id,
        files,
        summary: seed.summary,
        plan: seed.plan.join('\n'),
        prompt: seed.prompt,
        model: 'seed',
        usage: {},
        checks,
        design: { name: seed.name, emoji: seed.emoji, accent: seed.accent, category: seed.category },
      });
      addMessage({
        projectId: project.id,
        role: 'assistant',
        content: seed.summary,
        version: version.number,
        kind: 'seed',
        meta: { design: { name: seed.name, tagline: seed.summary, emoji: seed.emoji, accent: seed.accent, category: seed.category, features: seed.features, plan: seed.plan }, files: files.map((file) => ({ path: file.path, size: file.content.length })) },
      });
      const report = buildReport({ project: getProject(project.id), version, checks });
      upsertArtifact({ projectId: project.id, version: version.number, kind: 'report', title: `v${version.number} 验收报告`, content: report });
      upsertArtifact({
        projectId: project.id,
        version: version.number,
        kind: 'prd',
        title: `${seed.name} · 产品需求文档`,
        content: { markdown: seed.prd, model: 'curated', version: version.number, generatedAt: new Date().toISOString() },
      });
      upsertArtifact({
        projectId: project.id,
        version: version.number,
        kind: 'slides',
        title: `${seed.name} · 演示幻灯片`,
        content: { deck: seed.slides, model: 'curated', version: version.number, generatedAt: new Date().toISOString(), accent: seed.accent, emoji: seed.emoji },
      });
      created += 1;
    }
  }
  return created;
}

export function seedList() {
  return SEEDS.map((seed) => ({ slug: seed.slug, name: seed.name }));
}
