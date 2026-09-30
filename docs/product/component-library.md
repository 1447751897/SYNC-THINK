# SYNC-THINK 组件库与主题预览

## 入口

- 开发者工具：组件库不再出现在桌面产品的侧栏或主舞台中。开发、设计与验收使用下面的独立入口；普通用户无需接触组件实现和主题调试工具。
- 独立预览：在仓库根目录运行 `pnpm design:dev`，打开 `http://127.0.0.1:4318`。
- 静态构建：`pnpm design:build`，输出到 `apps/desktop/dist/design-system/`。
- 开发脚本为一次构建加本地静态服务，不是 HMR；修改源码后运行 `pnpm design:build` 并刷新即可。

## 数据来源与覆盖范围

`docs/product/16-shell-design-tokens.json` 是 token 数据源。组件库读取其中所有桌面分组，不包含独立官网的 `website` 分组，不修改自动生成的 `tokens.css`。

`pnpm design:catalog` 使用 TypeScript AST 扫描桌面 shell 和历史 UI Kit 的公开 TSX 组件文件，生成 `apps/desktop/src/renderer/shell/design-system/catalog.generated.ts`。目录记录文件、公开导出、分类及样例状态。构建桌面 shell 和独立预览时自动更新；可用 `pnpm design:catalog --check` 检查漂移。

当前覆盖：

- 231 个桌面 token，可搜索、按分组过滤并编辑 CSS 值。
- 122 个现役组件文件，以及单独标记的 23 个历史 UI Kit 文件。
- 122 个现役组件均接入可视化场景：基础控件、消息、执行过程、文件、智能体、任务、浏览器、设置与应用框架。分类卡片直接展示 UI；详情默认进入「设计与交互」，实现说明在次级页签。
- 大多数场景直接导入原组件。ShellApp、compose-toolbar、CitationContext、KeepAliveLayer、FileDiffSurface、BrowserPanel 是明确标记的组件组合；不把组合场景声称为完整业务启动。浏览器正文为本地离线示例，工具栏为原组件。内联可视化的 Electron guest 在展示站适配为隔离 iframe；保留原组件的加载、错误与展示容器，但不执行 Electron 行为。
- 23 个历史 UI Kit 使用原 React 组件结构，因仓库已无旧样式表，另加隔离的归档展示样式，并显著标明「历史结构复原 · 非现役样式」。它们不计入 122 个现役设计。
- 这里覆盖的是公开组件文件与代表性场景，不声称穷尽全部业务状态与系统级行为。

## 分类文档导航

页面采用顶栏、分类侧栏、文档主区、主题工作台的布局。现役组件按用途分为：对话与输入、消息与内容、工具与执行、基础交互、文件与工作台、智能体与能力、浏览器与接管、任务与活动、设置与模型、应用框架。历史 UI Kit 独立归档。

- 总览每类显示前 6 项；“查看全部”进入完整分类，左侧可展开每个组件。
- 每个组件有中英文用途说明、源码位置、公开导出、同类前后项导航。所有现役项均有 LIVE 场景。缩略图通过 IntersectionObserver 只挂载可见预览，滚出视口后卸载；详情只挂载所选组件。
- 顶栏可切换组件、主题 Token、全部设计场景；全局搜索覆盖组件名称、用途、导出与路径，包括历史项。
- Hash 路由支持刷新、深链接和浏览器前进/返回，如 `#ds/category/conversation`、`#ds/tokens`。组件深链接使用编码后的源码路径，避免同名歧义。
- 窄屏使用可开关的分类导航和主题面板，Escape 关闭浮层。
- 用途分类与排序显式维护在 `apps/desktop/src/renderer/shell/design-system/catalog.ts`，不依靠文件名猜测。新增公开组件会先进入“待归类”，分类测试检查重复、遗漏和过期条目。扫描器排除组件库自己的实现目录。

## 主题编辑行为

- 默认配色取自 Token JSON；Azure / Claude 使用现有命名主题表映射到 shell 语义变量。
- CSS 自定义属性只设置在组件库根节点，并通过校验来源的 postMessage 同步到独立 iframe 文档；明暗切换保留组件交互状态。不调用应用外观设置 API，不写入生产外观偏好。
- 手动覆盖优先于预设；浅色/深色覆盖独立保存。切换预设不会丢弃手动值，重置则恢复默认主题并清空覆盖。
- 颜色支持取色器与 CSS 值输入。其余分组可编辑尺寸、字体、阴影、动效等。Enter / blur 应用；Escape 取消当前未提交输入。
- 草稿存放于独立 localStorage 键 `sync-think.design-system.draft.v1`。JSON 可往返导入；CSS 导出包含限定在 `.design-system-theme` 下的明暗两套完整变量，不会直接覆盖 `:root`。
- 导入限制版本、已知变量名、CSS 语法和文件大小；存储不可用时提示导出保留。
- 用户自由配色可能降低对比度；前景/背景 token 均可单独调整，本工具不声称自动保证任意组合的可访问性。

## 样例约束

真实组件通过本地 props/state 和独立内存 Runtime 演示。发送、审批、保存不调用真实工作区或原生桥接；`installPreviewRuntime()` 只在独立预览文档安装，localStorage/sessionStorage 为内存存储，CSP 禁止网络连接和表单提交。`window.open` 不打开外部页面。

`fixtures/Showcase.tsx` 维护现役场景，`LegacyShowcase.tsx` 维护历史场景。生成器从现役 registry 的 AST 读取覆盖信息，不再手工维护 9 项白名单。新增源组件必须补分类和演示场景，覆盖测试会提示遗漏。

`design-preview.html` 是独立构建入口，与桌面主 bundle 分离。每个预览都运行在自己的 iframe，避免弹窗、全局事件、样式和订阅互相污染。Excalidraw、Mermaid 和终端 vendor 随静态构建附带。构建输出 `design-preview-build.json` 记录独立预览 JS 体积。

本地回归入口 `design-preview.html?audit` 顺序挂载全部 145 个场景，记录未捕获异常、React 渲染错误和超时；它是渲染冒烟检查，不等同于每个业务动作的端到端验证。

## 验证

```sh
pnpm --filter @sync-think/desktop typecheck
pnpm --filter @sync-think/desktop exec vitest run src/renderer/shell/design-system/theme.test.ts src/renderer/shell/design-system/catalog.test.ts src/renderer/shell/DesignSystemPage.test.tsx src/renderer/shell/Sidebar.test.tsx src/renderer/shell/shell-state.test.ts
pnpm design:catalog --check
pnpm design:build
pnpm --filter @sync-think/desktop build:shell
```

独立组件库的目录数据采用 compact tuples，组件库主页面仅由开发预览入口加载；桌面 ShellApp 已移除该舞台和 lazy import。本次视觉展览升级保持已有 shell 预算不变。2026-09-28 测量：shell initial 2,229,381 bytes；shell total 3,394,356 bytes。独立预览模块约 7.48 MB（未压缩 JS，另含已存在的 vendor），不进入应用启动入口，仅在打开组件库的可见场景时加载。这部分体积单独报告，不混称为 shell 总体积。

仓库现有 `lint:tokens` 仍报告其他 shell 文件中的 58 处原有裸色/外部变量，本次没有扩大扫描器豁免或修改这些既有问题。

