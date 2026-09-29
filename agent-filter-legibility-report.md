# 智能体库筛选条：字号可读性修复

日期：2026-09-21
状态：已修复 → 已构建 → 已重启实测验证

## 问题

用户反馈智能体库页筛选条「字太小、看不清、很模糊」。

## 根因

筛选条所在的一组控件，字号**长期偏离应用自身的 13px 基线**：

| 控件 | 类名 | 原字号 |
|---|---|---|
| 可用范围 / 写入策略 / 状态（说明文字） | `.ability-hub__filter-label` | **9.5px** |
| 全部 15 / 只读 8 / 继承当前会话 7 …（chip） | `.ability-hub__security-filter button` | 12px，min-height 24px |
| chip 内计数 | `.ability-hub__security-filter button small` | 11px |
| 按最近活跃（排序） | `.ability-hub__sort` | 12px |
| 能力页范围药丸 | `.ability-hub__scope-pill` | **9.5px** |

对照：搜索框输入 13px、catalog tabs 13px —— 说明 13px 才是这套 shell 的标准正文尺寸。

**「模糊」来自字号本身**：9.5px / 12px 的中文在 125% DPI 缩放下落在亚像素栅格上，字形边缘被重采样，视觉上就是发虚。已排除的其它可能：

- 生产 main 未设置 `force-device-scale-factor`（该 flag 只存在于 `scripts/fixtures/`、`phase3-visual-capture`、`windows-brand-assets` 三个**截图/资源脚本**中，用于让截图稳定）
- 未做全局 UI zoom（`setZoomFactor` 只用于 BrowserPanel 的内嵌网页缩放）
- 未做 `-webkit-font-smoothing` 干预

## 改动

单文件：`apps/desktop/src/renderer/shell/shell.css`，在文件末尾新增一段覆盖（**不修改原规则**，避免动到 `:root[data-image-theme]` 等主题变体）。

```css
.ability-hub__filter-label              { font-size: 13px; letter-spacing: .01em; }
.ability-hub__security-filter button    { min-height: 30px; padding: 0 10px; font-size: 13px; line-height: 19px; }
.ability-hub__security-filter button small { font-size: 12px; line-height: 18px; }
.ability-hub__organize, .ability-hub__sort { min-height: 30px; font-size: 13px; line-height: 19px; }
.ability-hub__filter-note               { font-size: 12.5px; }
.ability-hub__scope-pill                { min-height: 30px; padding: 0 11px; font-size: 13px; }
```

设计取舍：

- 全部对齐到 **13px 应用基线**，而不是各自随意放大 —— 与搜索框、catalog tabs 视觉统一
- chip 计数 **12px**（低一档），保持 chip 自身文案的层级
- chip 高度 24→30px 给字号留出呼吸空间，也让 chip 与 34px 搜索框、33px 视图切换在视觉上齐平
- chip padding 仅 9→10px，控制横向增量（6 个范围 chip 合计约 +40px），避免挤爆 scope 行

## 范围说明

`.ability-hub__filter-label` 经核验**只被 `AgentLibrary.tsx` 使用**（三处：可用范围 / 写入策略 / 状态）。
`.ability-hub__security-filter`、`.ability-hub__search input` 为智能体库与能力中心共用，因此两页同步受益；已回归核验能力页布局完好。

## 验证

| 项 | 结果 |
|---|---|
| `AgentLibrary.test.tsx` | 16 passed（测试按 role/aria 定位，不受字号影响） |
| `pnpm typecheck` | 22/22，exit 0 |
| `pnpm build` | 13/13，exit 0 |
| 产物核验 | `dist/renderer-shell/shell.css` 末尾含全部新规则，层叠顺序正确（新规则在旧的 9.5/12px 之后） |
| Electron 实测 | 已重启，智能体库 + 能力页截图确认：字号明显放大、无溢出、无破版 |

实测截图：`agent-filter-before-after.png`（改前/改后对比）、`agent-library-filter-legible.png`（改后特写）。

## 遗留

- 工作区仍有大量未提交改动，HEAD 停在 09-18，建议尽快提交保护性快照
- 本次为纯前端（renderer）改动，未触碰 runtime / daemon，未触发 DB 迁移
