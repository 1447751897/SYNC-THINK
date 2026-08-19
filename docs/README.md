# SYNC-THINK Docs

本目录是 SYNC-THINK 的项目文档。权威产品/系统设计见：

```text
docs/superpowers/specs/2026-07-11-sync-think-product-design.md
```

## 目录结构

```text
project-root/
  AI_DEVELOPMENT_RULES.md
  docs/
    00_START_HERE.md
    README.md
    product/
      01-requirements-clarification.md
      06-roadmap.md
      15-frontend-design.md
      16-shell-design-tokens.json
    engineering/
      02-development-principles.md
      04-tech-decisions.md        # on-demand
      11-project-structure.md     # on-demand
    development/
      03-feature-changelog.md     # on-demand
      10-current-status.md        # on-demand
      14-decision-log.md          # on-demand
      16-retrospective.md         # on-demand
    operations/
      07-local-development.md     # on-demand
      08-deployment.md            # on-demand
    handoff/
      05-handoff-guide.md         # on-demand
    maintenance/
      09-zno-project-start-prompt.md
      12-upgrade-history.md
      13-command-reference.md
    superpowers/specs/
      2026-07-11-sync-think-product-design.md
```

## 文档分类

### 核心规则

| 文档 | 作用 |
| --- | --- |
| `AI_DEVELOPMENT_RULES.md` | 项目长期 AI 开发总规则 |
| `00_START_HERE.md` | 启动与中途需求流程；禁止确认前实现 |
| `engineering/02-development-principles.md` | 项目级产品/技术/UI/API/数据/安全/质量原则 |

### 需求与计划

| 文档 | 作用 |
| --- | --- |
| `superpowers/specs/2026-07-11-sync-think-product-design.md` | **已批准**产品与系统设计真源 |
| `product/01-requirements-clarification.md` | 中文需求澄清摘要、验收、边界 |
| `product/06-roadmap.md` | Phase 0-3 与 Later 路线图 |

### 设计与技术

| 文档 | 作用 |
| --- | --- |
| `product/15-frontend-design.md` | 桌面端 UI 方向、IA、状态、禁忌 |
| `product/16-shell-design-tokens.json` | 可执行设计 token（`pnpm tokens:css` 生成 shell/tokens.css） |
| `engineering/04-tech-decisions.md` | 技术选型对比与结论 |
| `engineering/11-project-structure.md` | 目录与模块地图 |

### 开发过程

| 文档 | 作用 |
| --- | --- |
| `development/03-feature-changelog.md` | 功能/变更/修复历史 |
| `development/10-current-status.md` | 跨对话接续快照 |
| `development/11-implementation-plan.md` | 里程碑实施计划（M0–M3） |
| `development/14-decision-log.md` | 高自治与关键决策 |


### 运行与交付

| 文档 | 作用 |
| --- | --- |
| `operations/07-local-development.md` | 本地开发与调试 |
| `operations/08-deployment.md` | 构建、签名、分发、回滚 |

### 交接与维护

| 文档 | 作用 |
| --- | --- |
| `handoff/05-handoff-guide.md` | 接手指南 |
| `maintenance/*` | 启动提示词、升级历史、命令参考 |

## 建议工作流

1. 阅读权威设计文档与 `AI_DEVELOPMENT_RULES.md`。
2. `/zno-init` 完成文档（当前阶段）。
3. 用户确认需求、设计方向与文档。
4. 完成第 24 节技术 spike，写入 `04-tech-decisions.md`。
5. 产出里程碑实施计划。
6. 按 Phase 1→2→3 实现；Runtime/权限/恢复优先 TDD。
7. 每次功能/选型/部署/结构变化更新对应文档。
8. 暂停或换会话前 `/zno-status`；新会话 `/zno-continue`。

## 跨对话接续

```text
/zno-status 总结当前开发进度
/zno-continue 继续上次开发
```

## 第一原则

> Context continuity is more important than automation.  
> 上下文连续性优先；用户控制模型调度。
