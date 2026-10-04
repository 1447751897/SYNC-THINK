# Agent Thinking 接入说明

参考：[BoardUI Agent Thinking](https://www.boardui.com/components/agent-thinking)。
来源：`BoardUI/boardui/components/application/agent-thinking/agent-thinking.tsx`。
MIT 许可及版权通知保留在 `AgentThinking.tsx` 顶部；构建会输出 `.LEGAL.txt`。

## 接入范围

组件位于 `apps/desktop/src/renderer/shell/AgentThinking.tsx`，样式为同目录
`agent-thinking.css`，已由 `shell.css` 导入。没有新增 npm 包、整站 CSS、Next.js
别名或 BoardUI 模板国际化依赖；使用已有的 React、clsx 和本项目主题 token。

```tsx
<AgentThinking
  variant="wave"
  tone="primary"
  label="等待模型响应"
  elapsedLabel={durationLabel}
  showTimer={Boolean(durationLabel)}
/>
```

- `variant`: `wave`（默认九点斜向波纹）、`spin`（九点旋转）、`stars`（星光）、
  `infinity`（无穷符号彗星）。
- `label`: 本项目默认「思考中」；宿主必须传入真实活动文案。
- `tone`: `subtle` / `default` / `primary` / `accent`，映射本项目语义颜色。
- `shimmer`: 是否开启流光文字，默认开启。
- `elapsedLabel`: 优先显示宿主真实运行计时，不因重新挂载、展开面板而重置。
- `showTimer`: 默认开启。独立使用且未传 `elapsedLabel` 时显示自挂载起的秒表；
  真实任务没有可靠起始时间时传 `false`，不要伪造运行计时。

## 真实执行过程

`InlineProcessFlow` 底部的 `ProcessActivityRow` 按 `deriveCurrentActivity` 的真实活动类型切换动画，
统一使用 `primary` 文本色调，保证深色背景可读性：

- 等待模型响应（`waiting`）→ `wave`。
- 模型思考（`thinking`）→ `infinity`，底部固定显示「正在思考中」，不显示具体推理摘要。
- 调用工具（`tool`）→ `spin`；有运行中的工具时优先于推理内容。
- 正在回复（`answering`）和其他运行提示（`status`）→ 保留 `wave`。

映射由 `PROCESS_ACTIVITY_VARIANTS` 集中定义，不根据文案猜测状态；暂未新增设置面板。
同一轮运行中自动切换，保留真实执行计时，不重置秒表；并非所有运行都叫「思考中」。
等待响应、实际工具名称、正在回复的文案保留；详细推理仍在可展开的 Think 行中，不重复到活动状态栏。
等待批准使用静态盾牌；完成、失败、暂停和停止时移除活动指示器。
网络研究仍使用已有的研究轨迹，不重复添加第二个活动指示器。

动画遵守系统和应用的减少动态效果设置，隐藏文档和非活动 KeepAlive
层停止九点动画；秒表不重复播报给屏幕阅读器，且卸载后释放定时器。

## 验收

QA 构建：`pnpm --filter @sync-think/desktop build:shell:qa`。
在 QA 预览中打开 `index.html?phase3-visual=agent-thinking&theme=light&motion=full`（或 `dark`）。
可切换真实执行组件的等待、思考、工具、批准以及终止状态，并检查四种变体。
