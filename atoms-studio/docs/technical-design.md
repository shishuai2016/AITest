# Atoms Studio Demo · 技术设计文档

> 版本：v1.0 ｜ 日期：2026-11-02 ｜ 状态：已实现
>
> 在线 Demo：https://bob-regardless-neither-powered.trycloudflare.com
>
> 关联需求文档：`docs/requirements.md` / 飞书《Atoms Studio Demo · 产品需求文档》

---

## 1. 设计目标与约束

### 1.1 目标

在有限时间内交付一个可运行、可体验、可扩展的 Atoms-like 产品：

- 自然语言 → 真实可交互的网页应用；
- 服务端持久化（平台数据 + 生成应用的业务数据）；
- 可迭代、可回溯、可分享；
- 至少一个延展能力：PRD / 演示 PPT / 验收报告；
- 在线可访问链接与完整文档。

### 1.2 约束

- 只有一台开发机，无云服务器/K8s；通过 Cloudflare Quick Tunnel 暴露公网 HTTPS。
- 无注册体系，Demo 采用匿名工作区。
- 模型使用火山方舟 ARK OpenAI 兼容接口，服务端持有密钥；免费额度有限。
- 生成的应用由模型编写，必须经过解析、语法检查与预览联调后才能发布。
- 6 小时窗口内优先保证「核心闭环 + 交付物 + 可演示」，不追求多租户与生产级安全。

### 1.3 关键取舍

| 决策 | 选择 | 原因 |
| --- | --- | --- |
| 前端框架 | 原生 ES Modules + 设计系统 CSS | 无构建步骤，部署简单，首屏快，便于现场排障 |
| 数据存储 | Node 22 内置 `node:sqlite` | 零外部服务、单文件、事务与 WAL，足够 Demo |
| 生成协议 | 文本文件标记（`<atoms file>`） | 比 JSON 更省 Token、更抗转义；解析失败可降级 |
| 实时进度 | SSE | 单向推送、浏览器自动重连、实现成本低 |
| 应用运行 | 同源 iframe + 运行时注入 | 生成应用可以直接调用平台持久化 API，且可分享 |
| 交付物 | LLM 生成 + 服务端导出 | PRD/Deck 内容与真实应用一致，PPTX 可直接修改 |
| 失败兜底 | 内置示例模板引擎 | 模型不可用时 Demo 仍能走通核心流程 |

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser                                                             │
│  ├─ SPA（public/index.html + js/*.js）                              │
│  │   首页 / 工作室 / 代码 / 交付物 / 版本                            │
│  ├─ SSE（EventSource）← /api/jobs/:id/events                        │
│  ├─ 分享页 /s/:slug（服务端渲染 HTML + iframe）                      │
│  └─ 预览 iframe /preview/:projectId/:version/                       │
│       ├─ 注入 window.__ATOMS_APP__                                  │
│       ├─ 注入 /atoms-runtime.js（atomsStore）                       │
│       └─ 渲染生成的 index.html / styles.css / app.js                │
└───────────────┬─────────────────────────────────────────────────────┘
                │ HTTP(S)
┌───────────────▼─────────────────────────────────────────────────────┐
│ Node.js 22 + Express（src/server.js）                                │
│  ├─ API：projects / versions / jobs / artifacts / app_store          │
│  ├─ Agent Orchestrator（src/agent.js）                               │
│  │   plan → code(stream) → parse → validate → repair                │
│  │   → save version → live checks → report → screenshot             │
│  ├─ 预览与分享（src/validate.js / server.js）                        │
│  ├─ 交付物：PRD（Markdown）、Deck（JSON→PPTX）、验收报告             │
│  ├─ 导出：单文件 HTML 内联、pptxgenjs                               │
│  └─ 截图：Headless Chrome（src/screenshot.js）                       │
└──────┬──────────────────────┬──────────────────────┬────────────────┘
       │                      │                      │
┌──────▼──────┐        ┌──────▼──────┐        ┌──────▼──────────────┐
│ SQLite      │        │ ARK LLM     │        │ data/shots/*.png     │
│ data/atoms  │        │ stream API  │        │ data/exports/*.pptx  │
│ .db (WAL)   │        │ (server key)│        │ data/chrome-profile  │
└─────────────┘        └─────────────┘        └──────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────────┐
│ Cloudflare Quick Tunnel → https://<random>.trycloudflare.com        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js 22.22 | 内置 `fetch`、`node:sqlite`、ESM |
| 服务端 | Express 4 | 路由、静态资源、SSE |
| 数据库 | SQLite（`node:sqlite`） | WAL、事务、单文件；`data/atoms.db` |
| 模型 | 火山方舟 ARK，`deepseek-v4-flash-ga-260731` | OpenAI 兼容接口，流式；`thinking: disabled` |
| 前端 | 原生 ES Modules + CSS 变量 | 无打包、无 CDN 依赖 |
| Markdown | marked（服务端/前端 UMD 本地文件） | PRD 渲染 + XSS 过滤 |
| PPT | pptxgenjs | 服务端生成 16:9 PPTX |
| 截图 | Chrome Headless | 生成作品封面与 OG 图 |
| 隧道 | cloudflared Quick Tunnel | 公网 HTTPS 演示链接 |
| 测试 | Node 脚本 + puppeteer-core | 冒烟、截图、生成流程回归 |

---

## 4. 数据模型

### 4.1 ER 关系

```
projects 1 ── n versions
projects 1 ── n messages
projects 1 ── n jobs
projects 1 ── n artifacts
projects 1 ── n app_store (key/value)
llm_calls（可观测，独立）
```

### 4.2 表结构

**projects**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | `app_` + 随机 |
| name / slug | TEXT | 产品名 / 公网标识（唯一） |
| prompt | TEXT | 最初的想法 |
| summary / emoji / accent / category | TEXT | 展示元信息 |
| status | TEXT | draft / generating / ready / error |
| current_version | INTEGER | 当前版本号 |
| share_enabled | INTEGER | 是否公开分享 |
| is_seed | INTEGER | 是否为精选示例 |
| workspace_id | TEXT | 浏览器匿名工作区 |
| created_at / updated_at | TEXT | ISO 时间 |

**versions**

| 字段 | 说明 |
| --- | --- |
| id, project_id, number | 版本标识与递增编号 |
| files | JSON：`[{path, content}]` |
| summary / plan / prompt | 版本摘要、实现方案、本次需求 |
| model / usage | 模型与 Token 用量 |
| checks | JSON：自动验收检查项 |
| created_at | 时间 |

**messages**：role（user/assistant）、content、version、kind、meta（design/plan/usage/checks）、created_at。

**jobs**：kind、status（queued/running/done/error）、prompt、steps（JSON）、stream_tail（最近 4KB）、error、version、时间。进程启动时会把遗留的 running 任务标记为中断。

**artifacts**：project_id、version、kind（prd/slides/report）、title、content（JSON）、status、时间；`(project_id, version, kind)` 唯一。

**app_store**：`(project_id, key)` 主键，value 为 JSON 字符串，单条上限 64KB。

**llm_calls**：purpose、model、prompt_tokens、completion_tokens、latency_ms、ok、created_at。

---

## 5. API 设计

所有 API 返回 JSON；生成与交付物操作可能耗时较长，前端通过任务/加载态反馈。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查、模型状态、项目数 |
| GET | `/api/home` | 首页数据：精选、最近、统计、模板、额度 |
| POST | `/api/projects` | 创建项目并启动第一次生成 |
| GET | `/api/projects` | 项目列表 |
| GET | `/api/projects/:id` | 项目详情：项目、消息、版本、当前文件、交付物、活动任务 |
| PATCH | `/api/projects/:id` | 重命名 / 分享开关 |
| DELETE | `/api/projects/:id` | 删除非示例项目 |
| POST | `/api/projects/:id/messages` | 追加需求并启动迭代任务 |
| GET | `/api/projects/:id/versions/:n` | 版本文件详情 |
| POST | `/api/projects/:id/versions/:n/restore` | 恢复历史版本（创建新版本） |
| GET | `/api/jobs/:id` | 任务状态、步骤、流式尾部 |
| GET | `/api/jobs/:id/events` | SSE：步骤、设计、delta、通知、done/error |
| GET | `/api/projects/:id/artifacts` | 当前版本交付物 |
| POST | `/api/projects/:id/artifacts/:kind` | 生成 PRD / Deck / 报告（支持 force） |
| GET | `/api/artifacts/:id/download` | PRD/报告 .md 或 Deck .pptx |
| GET | `/api/projects/:id/versions/:n/download` | 单文件 HTML 下载（内联 CSS/JS） |
| GET | `/api/apps/:projectId/store` | `atomsStore.list()` |
| GET/PUT/DELETE | `/api/apps/:projectId/store/:key` | 生成应用 key/value 持久化 |
| POST | `/api/projects/:id/screenshot` | 重新生成缩略图 |
| GET | `/preview/:projectId/:version/*` | 生成应用预览（注入运行时） |
| GET | `/s/:slug` | 公开分享页（SSR） |
| GET | `/s/:slug/raw` | 直接打开原始应用 |
| GET | `/shots/:projectId/:version.png` | 应用截图 |

### 5.1 SSE 事件协议

```jsonc
// 任务状态与步骤
{ "type": "steps", "steps": [{"id":"build","label":"编写代码","status":"active"}], "status": "running" }

// 产品设计（规划结果）
{ "type": "design", "design": {"name":"Focus Flow","features":["..."],"plan":["..."],"accent":"#2F5D50"} }

// 流式代码（前端拼接显示）
{ "type": "delta", "text": "..." }

// 提示/降级/修复
{ "type": "notice", "level": "warn", "message": "自动校验发现 1 个问题，正在修复…" }

// 完成
{ "type": "done", "version": { "number": 1, "summary": "..." }, "project": {} }

// 失败
{ "type": "error", "message": "生成失败：..." }
```

`jobs.js` 在内存中保留事件历史，SSE 支持重放；页面刷新后先读 `/api/jobs/:id`，再订阅事件流，避免错过进度。

---

## 6. Agent 生成管线

### 6.1 流程

```
POST /api/projects|messages
  └─ createJob(projectId, prompt, kind)
       └─ runGeneration()
            1. 理解需求（本地规范化）
            2. 规划产品：LLM 返回 name/tagline/description/emoji/accent/features/plan
            3. 构建代码提示：系统约束 + 产品方案 + 当前版本文件（迭代时）
            4. LLM 流式生成三个文件
            5. 解析 <atoms file> → 校验（index.html、资源、JS 语法、持久化）
            6. 不通过 → 最多一次修复调用
            7. 保存版本（事务）→ 更新项目当前版本
            8. 真实联调：预览 HTTP、运行时注入、atomsStore 写入/读取/删除
            9. 生成验收报告（15+ 项）
           10. 异步截图 → 生成作品封面
           11. 写入 assistant 消息，发布 vN
```

### 6.2 规划提示（Planner）

要求只输出 JSON，字段固定；解析失败时使用项目占位名与默认设计，不阻塞生成。核心要求：

- 产品名 2–6 个中文字，有记忆点；
- 定位 12 字以内，描述 40 字以内；
- 3–5 个核心功能，3–4 条实现步骤；
- 主色从给定色板中选择；
- **持久化统一描述为 atomsStore 服务端存储**，不出现 localStorage/浏览器本地存储。

### 6.3 代码提示（Coder）

系统提示是生成质量的关键，包含：

1. **输出协议**：只输出 `<atoms plan>`、`<atoms summary>`、三个 `<atoms file path="...">`，不允许 Markdown 围栏或额外解释。
2. **工程约束**：恰好 index.html / styles.css / app.js；index 引用另外两个；禁止外部 CDN/字体/图片；不引第三方框架；所有按钮有真实行为；至少一个增删改类操作。
3. **持久化**：必须使用注入的 `atomsStore`；提供 localStorage 兜底；首次加载注入合理示例数据。
4. **体验**：中文界面、具体文案、空状态、加载态、错误态、响应式 390/768/1440、无障碍、无 `alert/confirm/prompt`。
5. **设计方向**：先选一个明确视觉概念（纸张、深夜终端、手账等），统一色彩/字号/留白/圆角/微交互；避免「白底紫渐变 + 圆角卡片」的通用 AI 模板感。
6. **迭代**：保留未要求改变的功能，输出完整文件而非 diff。

### 6.4 解析与校验

- 正则解析文件块，清理路径穿越与非法字符，去重。
- 校验：index.html 存在且结构完整、长度合理；本地引用文件存在；JS（外链与内联）通过 `vm.Script` 语法解析；viewport/title/持久化/交互元素/占位文案检查。
- 失败时把错误清单与上一次输出回传模型修复一次；仍失败则抛出明确错误，由调度器返回 SSE error；项目保留旧版本。

### 6.5 失败兜底

- 未配置密钥或模型报错：切换到 `src/fallback.js` 的内置演示应用模板（按关键词选择任务/经营/习惯模板），明确标注「内置演示引擎」，仍生成可预览版本。
- 兜底不伪造 AI 结果：消息 meta 标记 `fallback: true`，界面显示提示。
- 模型连续失败/超时：任务进入 error，项目状态置 error，已保存版本不受影响。

### 6.6 并发、额度与超时

- 同一项目同时只允许一个生成任务；全局最多 3 个并发生成。
- 每日生成上限（默认 12 个版本）按项目版本数统计；达到上限返回 429 与友好提示。
- LLM 总超时 240s；流式空闲超时 90s；失败最多重试一次（网络类错误）。
- 每次 LLM 调用记录 Token 与耗时，便于监控免费额度与性能。

---

## 7. 预览、持久化与分享

### 7.1 预览注入

服务端读取版本文件，在返回 index.html 时注入：

```html
<script>window.__ATOMS_APP__={"projectId":"app_x","version":2,"appName":"Focus Flow"};</script>
<script src="/atoms-runtime.js"></script>
```

- 注入位置在 `<head>` 起始处，确保 `atomsStore` 在应用脚本前可用；
- 不修改数据库中保存的原始文件；
- CSS/JS 按版本从同一路径提供，支持相对引用；
- 预览路由带 `no-store`，避免迭代后看到旧内容。

### 7.2 atomsStore 运行时

`public/atoms-runtime.js` 暴露：

```js
window.atomsStore = { get(key, fallback), set(key, value), del(key), list(), projectId };
```

- 同源 fetch `/api/apps/:projectId/store/:key`；
- 网络失败或独立 HTML 场景回退 localStorage；
- 生成应用的首次数据由应用自己写入，平台不预设业务 schema；
- 服务端校验 key 正则，限制单条 64KB，避免滥用。

### 7.3 分享

- `share_enabled=1` 时 `/s/:slug` 返回 SSR 页面：全屏 iframe + 品牌浮标 + OG 元信息；
- 关闭分享返回 403 说明页；
- `/s/:slug/raw` 直接跳转 `/preview/...`；
- 分享页 iframe 与应用使用同一套持久化 API，数据跨设备可见（同一项目）。

### 7.4 版本与恢复

- 每次生成创建递增版本；恢复历史版本会复制文件生成新版本，**不覆盖历史**。
- 版本记录模型、Token、检查结果，便于回溯质量。
- 单文件下载时把 `styles.css`、`app.js` 内联进 index.html，生成离线可打开的 HTML。

---

## 8. 交付物生成

### 8.1 PRD

- 输入：产品名、描述、最初想法、当前版本摘要、规划信息、文件列表、可见文案、持久化方式；
- 输出：Markdown（900–1400 字），固定二级标题与功能表；
- 服务端保存 JSON `{markdown, model, version, generatedAt}`；
- 前端用 marked 渲染并做 XSS 过滤；支持复制、下载 .md。

### 8.2 演示 Deck

- 输入同上；输出 JSON Deck：`{title, subtitle, slides[]}`，7 页，layout 支持 cover/points/quote/closing；
- 前端渲染为 16:9 可翻页 Deck，支持键盘方向键、全屏、缩略图导航；
- 服务端用 pptxgenjs 生成 PPTX：深色封面 + 应用截图、浅色内容页、强调色、页码、演讲备注；
- 幻灯片保存失败时降级为本地模板 Deck。

### 8.3 验收报告

每次版本生成后自动执行（`src/checks.js`）：

1. 文件完整性 / HTML 结构 / viewport / title
2. 本地资源引用是否可解析
3. JavaScript 语法（外链 + 内联）
4. 外部资源/离线可用性
5. atomsStore 持久化接入
6. 交互元素数量
7. 占位内容
8. 预览 HTTP 200 与 HTML 类型
9. 运行时注入（配置 + atoms-runtime）
10. atomsStore 写入/读取/删除往返
11. 汇总评分

报告保存到 artifacts（kind=report），可在线查看、下载 Markdown；每次重新生成可「重新检查」。

---

## 9. 前端实现

### 9.1 结构

```
public/
  index.html               SPA 壳
  css/styles.css           设计系统（变量、组件、响应式、深色）
  js/app.js                路由、主题、全局链接拦截
  js/home.js               首页：Hero、作品、模板、能力、工作原理
  js/studio.js             工作室：对话、SSE、预览、代码、交付物、版本
  js/ui.js                 图标、Toast、Modal、Markdown、复制、主题
  js/api.js                fetch 封装
  atoms-runtime.js         生成应用的持久化运行时
  vendor/marked.min.js     本地 Markdown 渲染
```

### 9.2 工作室状态与交互

- 初始加载 `GET /api/projects/:id`，渲染对话与预览；
- 若有 `activeJob`，先 `GET /api/jobs/:id` 取步骤与流式尾部，再 `EventSource` 订阅；
- 收到 `steps/design/delta` 更新运行卡片与预览覆盖面板；
- `done` 后重新拉取项目，刷新 iframe、对话、交付物和版本；
- 失败显示错误卡片，保留旧版本可继续操作；
- 切换预览/代码/交付物/版本不丢失当前项目数据；
- 设备尺寸通过切换 frame class 实现（不重载应用）；
- 所有历史版本可预览，顶部提示「正在预览历史版本」，一键回到最新；
- 清理函数在路由离开时关闭 EventSource、定时器与 Modal。

### 9.3 视觉与无障碍

- 设计语言：暖纸色背景、衬线大标题、mono 元信息、靛蓝强调色、lime 高亮；
- 深色主题通过 CSS 变量整体切换；
- 交互元素有 hover/focus 样式、aria-label、键盘操作；
- Toast、空状态、加载态、骨架屏；
- 尊重 `prefers-reduced-motion`；
- 首页、工作室、分享页在 390px / 768px / 1440px 下验证。

---

## 10. 部署与运维

### 10.1 本地启动

```bash
npm install
cp .env.example .env          # 填入 ARK_API_KEY
npm start                     # http://127.0.0.1:4318
```

### 10.2 公网链接

```bash
# 方式一：cloudflared 已安装
./scripts/tunnel.sh 4318

# 方式二：使用随项目准备的二进制（演示环境）
CLOUDFLARED_BIN=./data/bin/cloudflared ./scripts/tunnel.sh 4318
```

- 生成的公开 URL 写入 `data/public-url.txt`；
- 脚本在隧道断开后自动重启（URL 可能变化）；
- Demo 使用 Cloudflare Quick Tunnel，不承诺生产 SLA。

### 10.3 数据与日志

| 路径 | 内容 |
| --- | --- |
| `data/atoms.db` | SQLite 主库（WAL） |
| `data/shots/<project>/<version>.png` | 作品截图 |
| `data/exports/<artifact>.pptx` | 导出缓存 |
| `data/server.log` | 服务日志 |
| `data/tunnel.log` | 隧道日志 |
| `data/public-url.txt` | 当前公网 URL |

备份：停止服务后复制 `data/` 即可；恢复时覆盖回同一路径。

### 10.4 依赖

- Node.js ≥ 22.5（`node:sqlite`）；
- Chrome（截图；可用 `CHROME_PATH` 覆盖）；
- cloudflared（公网隧道，可选）；
- `pptxgenjs` / `express` / `marked`（npm）。

### 10.5 配置

见 `.env.example`：ARK_API_KEY、ARK_MODEL、ARK_BASE_URL、ARK_THINKING、LLM 超时、PORT、DAILY_GENERATION_LIMIT、CHROME_PATH、DATA_DIR、SELF_URL。

---

## 11. 测试与验收

### 11.1 自动化

- `scripts/smoke.js`：健康、首页、分享页、预览注入、atomsStore 往返、PRD/PPTX 下载、单文件 HTML、截图，共 8 项。
- 生成流程 E2E（puppeteer-core）：首页输入 → 工作室 → 生成覆盖层/SSE → 完成 → iframe 预览 → 交付物弹窗 → 分享弹窗。
- 自动验收报告：每个版本 15+ 项检查，服务端真实请求预览与 store API。

### 11.2 实测结果（Demo 环境）

- 冒烟测试：8/8 通过。
- 生成示例「书笺」：约 50 秒，15/15 检查通过，预览与持久化正常。
- 生成示例「水迹」：约 2 分钟（包含一次自动修复），15/15 检查通过。
- Deck 导出：PPTX 可正常解压/打开（约 300–500KB）。
- 分享页、PRD、报告、单文件下载均通过人工与自动化验证。

### 11.3 复现方式

```bash
BASE_URL=https://<当前公网域名> node scripts/smoke.js
```

开发期还使用 `puppeteer-core` 做了真实浏览器回归（首页创建 → SSE → 生成完成 → iframe → 交付物弹窗 → 分享 → 移动端/深色截图），该脚本依赖本机 Chrome 与具体项目 ID，未随仓库分发。

---

## 12. 安全、风险与后续

### 12.1 安全设计

- ARK API Key 仅存在服务端 `.env`，不进入前端 bundle 或接口响应。
- 生成应用运行在 iframe 中，但为同源（为了 atomsStore）；生产环境应改为独立沙箱域 + CORS 白名单。
- 生成代码的 `innerHTML` 风险由提示词约束用户输入转义；平台对 Markdown 渲染做 script/iframe/on* 过滤。
- `atomsStore` 的 key 白名单、单条 64KB、写入频率控制。
- 每日生成上限、全局并发生成上限，避免资源/额度滥用。
- 无登录：任何访问者都可以创建项目；分享开关控制可见性，但不是权限系统。

### 12.2 已知风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 模型生成慢或空流 | 用户等待长 | 流式输出、90s 空闲超时、自动修复、内置兜底 |
| 模型额度耗尽 | 无法继续生成 | 每日限额、Token 日志、必要时切换模型/额度 |
| 生成代码有缺陷 | 应用不可用 | 语法/资源/预览/持久化检查；报告标红 |
| 隧道掉线 | 在线链接失效 | 守护脚本重启；README 提供本地启动 |
| 单机单进程 | 无法水平扩展 | 明确 Demo 定位；未来拆服务/队列 |
| 无鉴权 | 数据被任意访问 | 公开 Demo；生产需登录与项目权限 |

### 12.3 后续路线

1. 用户体系 / 团队空间 / 项目级权限；
2. 独立预览沙箱域与代码安全扫描；
3. 生成任务的持久化队列（Redis/BullMQ）与多实例；
4. 真正的部署能力（自定义域名、CDN、环境变量）；
5. 更多交付物：DOCX、PDF、可编辑 PPT 模板；
6. 应用内数据建模与 CRUD 生成；
7. 版本 diff、评论、协作。

---

## 13. 附录

### 13.1 代码结构

```
atoms-demo-03e4c66d6a03/
├── src/
│   ├── server.js          Express 入口、路由、SSR 分享页
│   ├── db.js              SQLite schema 与 helpers
│   ├── repo.js            项目/版本/消息/交付物数据访问
│   ├── agent.js           Agent 管线、规划/代码/PRD/Deck 提示
│   ├── llm.js             ARK 客户端、流式、超时/重试/用量
│   ├── validate.js        文件解析、校验、预览注入
│   ├── checks.js          自动验收
│   ├── jobs.js            任务与 SSE 事件中心
│   ├── screenshot.js      Headless Chrome 截图
│   ├── pptx.js            PPTX 导出
│   ├── fallback.js        模型不可用时的内置应用
│   └── seeds.js           精选示例数据
├── public/                SPA、CSS、运行时
├── seed/                  三个精选应用的完整源码
├── scripts/               start / tunnel / smoke
├── docs/                  PRD、技术设计、截图
├── data/                  运行时数据（gitignored）
└── package.json
```

### 13.2 关键接口示例

```bash
# 创建应用
curl -X POST http://127.0.0.1:4318/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"做一个个人读书笔记应用"}'

# 订阅生成进度
curl -N http://127.0.0.1:4318/api/jobs/<jobId>/events

# 生成 PRD
curl -X POST http://127.0.0.1:4318/api/projects/<id>/artifacts/prd

# 导出当前版本 HTML
curl -OJ http://127.0.0.1:4318/api/projects/<id>/versions/1/download
```

### 13.3 链接

- 在线 Demo：https://bob-regardless-neither-powered.trycloudflare.com
- 首页：https://bob-regardless-neither-powered.trycloudflare.com
- Focus Flow：https://bob-regardless-neither-powered.trycloudflare.com/s/focus-flow
- 拾光咖啡：https://bob-regardless-neither-powered.trycloudflare.com/s/cafe-ledger
- Habit Loop：https://bob-regardless-neither-powered.trycloudflare.com/s/habit-loop
- 仓库：https://github.com/shishuai2016/AITest
