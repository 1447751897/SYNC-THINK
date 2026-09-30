# 桌面主工作区 · 智能体聊天视觉统一

日期：2026-09-29

## 本轮范围

这是实际桌面工作区的第一版整体视觉改造，不是单独的首页概念稿。现有会话、导航、模型选择、文件、审批及工作台业务逻辑保留。

| 区域 | 本轮实现 |
| --- | --- |
| 全局布局 | 白/深灰外底、柔和面板、24px 大容器圆角、12px 外边距、16px 主区域间距 |
| 左侧栏 | 默认 260px；保留用户保存宽度；新建主操作、搜索、双列次级工具、轻量会话列表 |
| 顶部和标签 | 项目圆角标签；会话和文件标签同一控件家族；收敛旧式连体标签装饰 |
| 首页 | 问候、说明、输入区、场景、辅助提示分级；提示轮播降级到输入区之后 |
| 聊天 | 用户/回复气泡、代码与执行容器、元信息、底部输入和审批宽度统一 |
| 工作台 | 右侧/底部独立面板；真实文件预览；窄面板时文件列表移到预览下方 |
| 浮层 | 模型菜单、右键菜单、新建资源菜单、确认框、Toast、设置公共控件 |
| 外观 | 深浅色；命名/自定义/壁纸主题保留；关键文本和主按钮对比度 >= 4.5:1 |

## 实现边界

- 样式集中于 apps/desktop/src/renderer/shell/workbench-design.css，全部限定在 html[data-shell-design=agent]。
- 页面主体进一步限定于 .shell-normal-workspace，保留智能体工作区正在进行的独立改动。
- Portal 浮层使用文档级设计标记；不依赖必须位于 ShellApp DOM 树下的假设。
- theme/apply-workbench-appearance.ts 在普通主题映射后应用新默认配色；切换时清理本轮拥有的变量，不覆盖用户的命名、自定义与壁纸配色。
- docs/product/16-shell-design-tokens.json 新增 workbench-agent 配色，tokens.css 由生成器产生。
- 整理了原有 JSON 与已交付 CSS 的漂移：将源文件补齐到原有 CSS 的变量值。逐项比较，本轮保留了全部原有浅/深色变量值，避免官网和内嵌演示被默认 token 再生成意外改变。
- 二级页面本轮联动公共颜色和控件；未重做每个二级业务表单的信息结构。终端和浏览器的运行引擎不变。
- 本轮没有重启、发布或安装桌面应用，也没有提交其他聊天正在修改的文件。

## 真实组件验收

WorkbenchVisualFixture.tsx 直接挂载 ShellApp，而不是手绘外壳。只有 QA 入口加载该夹具；使用确定的示例数据、内存设置和隔离 bridge，不调用真实模型或修改用户项目。

构建：

~~~powershell
pnpm --filter @sync-think/desktop build:shell:qa
# 使用现有 Playwright 浏览器；若默认版本不存在，可指定本地可执行文件。
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = 'C:\Users\Administrator\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe'
node scripts/verify-workbench-design.mjs
pnpm --filter @sync-think/desktop build:shell
~~~

- 浏览器验收：38 项通过，包含两套主题的首页、真实聊天、模型 Portal、右键菜单、重命名对话框、文件预览、960px 紧凑布局、768px 收起侧栏布局、底部面板、设置，以及命名主题和壁纸。
- 截图及机器可读结果：.data/workbench-design-preview/，verification.json。
- TypeScript 类型检查、新增文件 ESLint、生产前端构建通过。
- 最终综合回归：14 个测试文件，201 项中 200 通过，1 项智能体历史导航失败。新增对比度契约已计入并通过。
- 生产构建测量：initial JS 2,239,861 bytes；total JS 3,456,573 bytes。没有提高构建预算；初始包离阈值较近，后续应继续避免增加启动依赖。

## 既有检查问题

1. ShellApp.test.tsx 中“resumes agent history in its own space and fresh chat does not discard a model draft”期望导航到 a-latest，实际返回 fresh: true。用改造前 ShellApp 的临时副本和同一测试也复现；临时对照文件已删除。没有借视觉改版修改智能体导航行为。
2. 全仓设计 token 检查存在旧文件中的 67 项硬编码色值与外部变量告警。新 workbench-design.css 通过无硬编码色值、全选择器作用域和无 !important 的独立契约检查；没有批量改写其他功能的旧代码来掩盖告警。

这些问题意味着仓库尚非全绿；本报告不宣称全仓检查通过。

## 收尾状态

```yaml
ROUTER_SUMMARY:
  stage: Finish
  artifacts:
    - D:/projects/MYSELF/SYNC-THINK/docs/product/17-agent-family-workbench-refresh.md
  needs_human_review: true
  blocked: true
  block_reason: "既有智能体历史导航测试失败；全仓 token 检查存在 67 项告警。复现：pnpm --filter @sync-think/desktop exec vitest run src/renderer/shell/ShellApp.test.tsx；node scripts/check-design-tokens.mjs"
  notes: "视觉第一版已实现，38 项浏览器检查通过；全仓收尾门禁未全绿，不进入合并或发布。"
```