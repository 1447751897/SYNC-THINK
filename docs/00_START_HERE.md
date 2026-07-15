# Project Documentation Starter

这是 SYNC-THINK 项目文档入口。AI 助手在开始开发前，必须先阅读本文件，并按流程完成需求澄清与文档工作。

## 0. 本项目当前状态

```text
产品/系统设计：已批准
权威设计文档：docs/superpowers/specs/2026-07-11-sync-think-product-design.md
实现代码：M0 已完成并关闭（2026-07-12）
当前命令阶段：M1 进行中（Workspace IA 后端）
下一步：用户明确授权后进入 M1 多模型对话 Alpha；未授权前不做 M1 业务实现
```

## 1. 启动原则

AI 不能在需求尚未澄清时直接进入开发。对本项目：

1. **不要让用户重新解释原始问题。**
2. **不要重新讨论 Locked 决策。**
3. 必须保持第一原则：**上下文连续性与用户控制模型调度。**
4. 在工作流要求的需求与技术决策确认前，**不要开始实现。**

首次（或新会话）接到任务后，必须先完成：

1. 阅读权威设计文档与 `AI_DEVELOPMENT_RULES.md`。
2. 识别目标用户、核心场景、边界与验收。
3. 确认技术约束与当前阶段（Phase 0/1/2/3）。
4. 更新相关项目文档。
5. 得到用户确认后，再进入开发或 spike。

## 2. 必须产出的文档

项目根目录 `docs/` 与根规则文件：

```text
AI_DEVELOPMENT_RULES.md
docs/
  00_START_HERE.md
  README.md
  product/
    01-requirements-clarification.md
    06-roadmap.md
    15-frontend-design.md
    15-frontend-design-tokens.json
  engineering/
    02-development-principles.md
    04-tech-decisions.md        # on-demand / 选型后
    11-project-structure.md     # on-demand
  development/
    03-feature-changelog.md     # on-demand
    10-current-status.md        # on-demand
    14-decision-log.md          # on-demand
  operations/
    07-local-development.md     # on-demand
    08-deployment.md            # on-demand
  handoff/
    05-handoff-guide.md         # on-demand
  maintenance/
    ...
  superpowers/specs/
    2026-07-11-sync-think-product-design.md   # 已批准权威设计
```

## 3. 新项目 / 新会话对话模板

```text
请先完整阅读 docs/superpowers/specs/2026-07-11-sync-think-product-design.md，再开始回复。

所有标记为 Locked 的内容都是已经确认的需求。不要让我重新解释原始问题，也不要重新讨论已经批准的决定。必须保持第一原则：上下文连续性与用户控制模型调度。

项目已经完成价值评估及产品/系统设计，但尚未开始实现。请继续执行 /zno-init 或对应 zno 命令，只解决第 24 节列出的技术验证项，然后按里程碑制定实施计划。在项目工作流要求的需求和技术决策得到确认前，不要开始实现。
```

## 4. AI 执行流程

AI 必须按以下顺序执行：

1. 需求复述：说明自己理解的项目目标、用户、核心功能和边界。
2. 需求澄清：只问真正影响产品方向、架构、验收或界面设计的问题；**已锁定项不问**。
3. 前端设计：桌面端已有 V3 结构基线与 tokens；最终视觉 refinement 单列，不推翻 IA。
4. 文档初始化/更新：按模板维护 `docs/`。
5. 用户确认：等待用户确认需求、技术方向和设计方向。
6. Phase 0 spike：只解决设计文档第 24 节技术验证项。
7. 实施计划：按里程碑拆分。
8. 进入开发：按 `AI_DEVELOPMENT_RULES.md` 执行代码实现与验证。

如果过程中涉及核心技术选型、重大依赖、架构变化、部署方案或第三方服务，AI 必须先给出 2-3 个候选方案、推荐理由、性能影响和维护成本，等待用户确认后再写入 `engineering/04-tech-decisions.md` 并实现。

## 5. 中途新增需求流程

本规则不仅适用于项目首次启动，也适用于开发过程中的任何新增需求、需求变更、功能调整或技术方案调整。

项目启动后，用户后续提出新需求时，AI 不需要用户重复粘贴启动提示词，也必须自动执行以下流程：

1. 判断这是新功能、功能变更、缺陷修复、体验优化还是技术调整。
2. 用简短语言复述对需求的理解。
3. 如果需求会影响产品范围、业务规则、数据结构、权限、技术方案、部署方式或验收标准，必须先提出澄清问题。
4. 若触及 Locked 决策，明确标注“将修改已批准决策”，并等用户确认。
5. 澄清完成后，先更新相关文档，再进入代码实现。
6. 实现完成后，更新 `development/03-feature-changelog.md`。
7. 如果涉及技术选型或架构调整，更新 `engineering/04-tech-decisions.md`。
8. 如果影响路线图，更新 `product/06-roadmap.md`。
9. 如果影响本地启动或部署，更新 `operations/07-local-development.md` 或 `operations/08-deployment.md`。
10. 如果影响后续接手方式，更新 `handoff/05-handoff-guide.md`。
11. 如果准备切换对话、暂停开发、交接上下文或阶段性完成，更新 `development/10-current-status.md`。
12. 如果影响目录结构、模块边界或关键文件职责，更新 `engineering/11-project-structure.md`。
13. 如果影响产品形态、UI 风格、布局、组件策略、交互状态或前端体验边界，更新 `product/15-frontend-design.md`。
14. 如果涉及核心技术选型或重大依赖，先走技术选型门禁，等待用户确认后再实现。

用户后续只需要直接描述新需求，或使用：

```text
/zno-feature ...
/zno-change ...
/zno-fix ...
/zno-tech ...
/zno-deploy ...
/zno-status ...
/zno-continue ...
/zno-plan ...
/zno-goal ...
/zno-goal --super ...
```

完整命令说明见 `docs/maintenance/13-command-reference.md`（首次需要时 scaffold）。

## 6. Skill 升级流程

当用户使用 `/zno-upgrade`，或发现当前项目缺少新版模板中的文档时，AI 必须执行升级流程：

1. 检查当前项目已有的 `AI_DEVELOPMENT_RULES.md` 和 `docs/` 文档。
2. 对比当前 Skill 模板中的文档清单。
3. 只补齐缺失文件，默认不覆盖已有文档。
4. 如果需要把新规则合并进已有文档，先说明将要追加的位置和内容。
5. 升级后更新 `docs/maintenance/12-upgrade-history.md`。
6. 升级后更新 `docs/development/10-current-status.md`。
7. 如升级涉及项目结构说明，补充或更新 `docs/engineering/11-project-structure.md`。
8. 如升级涉及前端设计规范，补充或更新 `docs/product/15-frontend-design.md`。

## 7. 禁止行为

1. 用户刚给出模糊需求时直接写代码。
2. 没有确认产品目标就决定技术架构。
3. 文档只写空话，不写项目相关内容。
4. 技术选型只写用了什么，不写为什么用。
5. 新增功能后不更新功能变更文档。
6. 部署方式变化后不更新部署说明。
7. 重开 Locked 决策或要求用户重述已批准需求。
8. 在文档与决策确认前开始业务实现。
9. 实现自动全局选模、非官方鉴权提取、团队云等闭测非目标并当作 MVP。

