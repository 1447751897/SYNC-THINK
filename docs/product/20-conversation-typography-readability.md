# 会话字体可读性修复

日期：2026-09-30。基于用户提供的普通工作台/月历截图和智能体聊天截图，以及真实 ShellApp / AgentWorkspace 的离线验收页面。

## 确认的差异

浏览器读取实际 computed styles，而非仅比较 CSS 文件：

| 节点                   | 修复前                              | 修复后                                 |
| ---------------------- | ----------------------------------- | -------------------------------------- |
| 会话侧栏内部标题       | 12px / 16px，未选中时使用次级文字色 | 14px / 20px，使用正文色                |
| 会话日期               | 10px                                | 12px / 18px                            |
| 普通聊天用户气泡       | 13px / 20.15px                      | 14px / 20px                            |
| 普通聊天 Markdown 正文 | 14px / 22.75px                      | 14px / 20px                            |
| 既有会话输入区         | 15px / 22px                         | 14px / 20px                            |
| 智能体正文（基准）     | 14px / 20px                         | 数值保持一致，消费共享排版 Token       |
| 月历任务名称           | 12px                                | 13px / 18px                            |
| 月历时间               | 11px，opacity 0.7                   | 12px / 18px，opacity 1，使用任务标题色 |

两边原本就使用 Inter Variable / Noto Sans SC Variable 字体族，主要差异是实际内层节点的字号、行高和弱化样式。采样时没有发现正文滤镜或缩放导致的模糊。本次没有更改 Windows 缩放、GPU、字体平滑或用户自定义主题。

## 实现边界

- 排版值定义于设计 Token 源文件的 chat-typography 组；运行 pnpm tokens:css 生成 tokens.css。
- 智能体消费同一 --font-sans 与正文字号/行高 Token，既有视觉基准不变。
- workbench-typography.css 在 workbench-design.css / board-chat.css 后加载，只作用于 opt-in 的 normal workspace。
- Sidebar 增加标题、用户名称和版本号的语义样式标识；保留旧版字号 fallback。
- 任务背景、按任务 ID 区分的配色、状态标记和运行逻辑均保留。
- 月历紧凑卡片最小高度 24px、单元格 132px，确保三行放大后的任务文字完整容纳；小窗口通过既有日历滚动区域浏览。
- Markdown 标题、代码的专用样式继续保留。

## 验证

- 回归测试：107 / 107 通过，包含排版合同、工作台和聊天样式隔离、Sidebar、AgentWorkspace、TaskCalendar、ComposerEditor、BoardChatPresentation。
- 变更 TypeScript 文件 ESLint 与新增 CSS / 测试的 Prettier 检查通过。
- 完整桌面构建通过，包含 TypeScript 检查、preload、production renderer；QA 构建通过。
- 生产 initial JS 2,238,335 bytes / 2,240,000；total JS 3,405,420 / 3,500,000，未调整预算。
- 真实 UI：普通聊天的字号、行高、font-family 与智能体正文精确相同；侧栏日期最终为 12px。
- 明暗月历任务名称 13px、时间 12px 且 opacity 1；2026 年 10 月验收数据 84 个任务标签均符合字号，单元格内部零溢出；页脚 12px / 18px。
- 全仓库 design-token 检查仍报告 67 项既有违规，位置在原有 shell.css / 头像 / 供应商配色等；本次新排版样式使用语义 Token，没有把这些历史问题计为通过。

证据位于 .data/typography-readability/：修改前后截图、实际 computed styles 和回归测试 JSON。验收运行时使用内存数据，没有读取或修改用户真实聊天/任务记录。本轮没有自动重启桌面进程。
