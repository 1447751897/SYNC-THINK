# SYNC-THINK 前端替换预演

一个 demo，回答一个问题：**第三方组件接进 SYNC-THINK 会替换掉哪里、会丢什么。**

```powershell
node demo/serve.mjs
```

会自动打开 `http://127.0.0.1:4173/`。首次运行如果 `.data/renderer-builds/qa` 不存在，
`serve.mjs` 会先跑一次 `pnpm --filter @sync-think/desktop build:shell:qa`。

> 为什么必须走服务器，不能双击 HTML：真实 shell 的 `shell.js` 是 ES module，Chrome 在
> `file://` 下拒绝加载；而且这个页面要加载应用自己的 `shell.css`、并内嵌应用自己的 QA
> shell，两者必须与 demo 同源。

## 它和上一版的区别

上一版是一个**手写的 SYNC-THINK 外壳仿制品**，所以对不上。这一版不再重画任何真实 UI：

| 内容 | 来源 |
| --- | --- |
| 「现状 · 真实组件」页签 | 应用自己的 QA shell 构建（`build:shell:qa` → `qa-entry.tsx` → `Phase3VisualFixture.tsx`），渲染真实的 `MarkdownContent` / `InlineProcessFlow` / `ChatView` 等组件 |
| 代码块对比的「现有」一侧 | `CodeBlock.tsx` 的真实 class 名，样式来自应用自己的 `shell.css`，外面套真实的 `.shell-md` 作用域 |
| 页面配色 | 应用自己的 `--color-*` token（加载的 `shell.css`），明暗跟随同一个开关 |
| 头像的「真实调用点」 | `AgentLibrary.tsx` 里真实的 `agent-card__avatar` 包裹层和真实辉光样式 |

也就是说：**只要 `build:shell:qa` 跟得上源码，这一页就不会和 SYNC-THINK 脱节。**

页签：

| 页签 | 内容 |
| --- | --- |
| 现状 · 真实组件 | 16 个真实 visual case 任选，iframe 内嵌真实 shell |
| 智能体头像 | [libraries.dev/bots](https://libraries.dev/bots) 对照 `AgentAvatarView.tsx` + `avatar-gen.ts` |
| 代码块 | [beui.dev/.../code-block](https://beui.dev/components/agents/code-block) 对照 `CodeBlock.tsx` |
| 替换面地图 | 两个候选合并后的受影响文件表 + 依赖差量 |

头像页可以试：**鼠标在页面上移动**，每个头像都会转头、转眼珠去看指针（1 个身位内跟随
权重 1，3 个身位外 0）；**点任意头像**会做一次带转体的跳跃；旁边有逐帧真实姿态读数。

代码页可以试：同时流式喂给两边，再点「模拟读者向上滚动」—— 现有版本会尊重你把滚动条
往上拉，beUI 每次渲染都会把你拽回底部。

## 文件

| 文件 | 说明 |
| --- | --- |
| `index.html` | demo 页面；加载 `/qa/shell.css`（应用自己的样式表）+ `preview.css` |
| `serve.mjs` | 静态服务器：`/` → `demo/`，`/qa/` → `.data/renderer-builds/qa/` |
| `frontend-preview.js` | 页面装配：四个页签、头像矩阵、代码块 A/B、替换面地图 |
| `preview.css` | 只补应用 `shell.css` 里没有的：页面外壳、canvas 头像槽位、beUI 那一侧 |
| `preview/bot-avatars.js` | 头像渲染器（原创几何 + 复刻库的动画模型） |
| `preview/legacy-svg-avatar.js` | 现有 `avatar-gen.ts` 的浏览器副本，仅用于并排对比 |
| `preview/code-blocks.js` | 两个代码块渲染器：现有的是 `CodeBlock.tsx` 的真实 markup，候选的是 beUI |
| `verify.mjs` | 无头自检 **39 项** + 5 张截图 |

```powershell
node demo/verify.mjs
```

校验分两层：先证明**真实组件真的渲染出来了**（iframe 里 `.shell-md-code` 存在、`code.hljs
language-*` 已接线、`--color-page` 是真实 token），再证明预演自己的每条结论成立。

## 三个必须说清楚的边界

1. **两个候选的实现都是原创近似。** libraries.dev 和 beUI 都是付费产品；`bot-avatars.js`
   复刻的是它们的**动画模型**（三状态权重混合、注视点游走、指针跟随、点击转体），
   `code-blocks.js` 里的候选一侧复刻的是**表面和机制**。要上线得先买授权再替换实现，
   外部接口保持不变。
2. **代码高亮在这个预演里是替身。** 真实两边分别是 highlight.js 和 shiki，都没法在这个
   页面里加载，所以「现有」和「候选」共用同一个极简分词器。对比的是表面和机制
   （流式稳定性、跟随行为、折叠、上限、插槽、主题承载方式），引擎替换的成本单独列在
   「替换面地图」页签里。
3. **头像页的矩阵不是应用截图。** 它是按真实调用点尺寸摆的状态/形态/尺寸矩阵；应用里
   目前没有智能体库的 visual case，所以那一块没有真实渲染可嵌。真实外壳请看第一个页签。

## 一个踩过的坑

不要用 PowerShell 改仓库里带中文的文本文件。`Get-Content -Raw` 会按系统代码页读 UTF-8，
再 `Set-Content` 回去就是双重编码损坏（这次把 `frontend-preview.js` 写坏过一次，
`node --check` 报 `Invalid or unexpected token`）。这类改动只走 UTF-8 安全的工具。
