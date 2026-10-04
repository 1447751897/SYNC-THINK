# Native 上下文保留与预算回归记录

> 本文件保留第一批历史结果。第二批已处理下述7项失败并通过最新全量 Runtime；usage 校准、模型输出上限及持久生命周期也已实施。最新验收与测试方法见 D:/projects/SYNC-THINK/docs/testing/context-compaction-batch2.md。

实施日期：2026-10-02 至 2026-10-03（Asia/Shanghai）。实施依据：本项目的 DeepSeek Harness 源码对照方案。

## 本轮落地

- 会话级 checkpoint 覆盖 **Message.sequence 的明确前缀**；与 Event.sequence 分开存储，旧事件专用历史保存 coveredEventSequences。原始消息和事件不删除。
- 后续请求保留覆盖区间以外的原文；同一时间戳、时钟偏移和摘要期间新增消息都不会因为 compactedAt 被误排除。
- 再次压缩输入包含旧 checkpoint；八段摘要保留目标、路径、约束、未完成工作、当前工作和下一步。验证结构及正常结束；中断、取消、无明显缩小或所选区间变化时不提交新覆盖边界。结构验证并不保证模型事实保留质量。
- Native 每次模型调用前执行压力检查：低压力不整理；到软水位后先整理较早工具结果，再用同一计量器重测，仍有压力时生成 checkpoint。工具调用/返回配对和当前用户原文受保护。外部 Claude Code / Codex 内核继续自己管理压缩。
- 压力水位为 min(85% × 窗口, 窗口 − 输出预留 − 安全余量)。输入历史预算为 窗口 − 输出预留 − 安全余量 − 固定输入成本；每个固定字段只扣一次。
- 默认输出预留为 min(8192, max(256, floor(窗口 × 6%)))，并显式传给 Native provider。安全余量默认为 min(8192, max(256, floor(窗口 × 3%)))。近期原文预算为 min(可用历史预算, floor((窗口 − 输出预留) × 16%))。显式 keepRecent 仍兼容。
- 没有新增可压缩原文时，重复 /compact 直接跳过，不为只重新摘要旧 checkpoint 再发一次模型请求；折叠数量只计原始消息，不计 checkpoint 节点。
- 原来的 82% 静默裁剪和读取过程中按 1.25×窗口静默丢头已撤下。仍有 100 页 × 100 条的单次读取上限；达到上限显式报错而非假装读取完整。
- Native 运行级 checkpoint 绑定线程、模型、运行与源消息指纹，持久化到已有运行日志，可重放恢复。它不是完整 DSH surfaceOp 事务引擎，也不是会话级跨运行 checkpoint 的替代物。
- Provider 明确报告上下文溢出时，仅在尚无用户可见输出且请求实际缩小后恢复重试一次；认证错误、没有缩小或再次溢出不会形成同请求无限重试。
- 桌面详情显示输出预留、安全余量、固定输入成本和可用历史预算，使用 Runtime 返回的水位。保持既有首屏包上限，未放宽构建约束。

## 已验证场景

1. 12 条消息压缩前 4 条，后 8 条原文进入下一请求；重复压缩带上旧摘要。
2. 相同时间戳、较早墙钟时间的新消息、摘要期间追加与区间内编辑冲突。
3. 旧 timestamp + keepRecent 边界兼容、旧事件专用历史、缓存重载与指纹失配。
4. 少于 8 条但文本很长时按 Token 保留尾部。
5. 工具链配对、先整理后降压免付费摘要、低压免摘要、固定成本超额硬检查。
6. 摘要中断、失败、取消不覆盖原文；运行增量日志重放与坏 checkpoint 丢弃。
7. 一次实际缩小后的溢出恢复；没有缩小与认证故障不重试。
8. 卡片预算数据、模型/智能体实际路由、请求快照与展示分项、历史导航。
9. 旧事件历史中图片转写后的当前请求替换原文，避免把原文和带描述的请求重复加入。图片Runtime相关11项另外通过。

## 计量与验证边界

所有 Native 预算、请求快照和卡片共用 UTF-8 字节 / 4 的文本估算与现有图像估算。它不是 provider tokenizer 的精确输入计数，也没有实现 DSH TokenMeter 的同请求信封 usage 锚点校准。工具剪枝保留的是模型输入投影，原始工具事件保持可追溯。摘要 token 用 provider.usage + purpose=compaction 单独记账。

本轮模型行为使用受控 provider 夹具与真实 SQLite / Runtime RPC 验证，没有发起付费模型语义评测。未写入用户数据库，未重启用户运行中的 Runtime、daemon 或桌面进程；构建产物需在 Runtime 和桌面均重启到新版本后启用；本轮没有执行该重启。

## 复核命令与环境

Node 20.20.2。命令在 D:/projects/SYNC-THINK 根目录执行：

- pnpm --filter @sync-think/runtime build
- pnpm --filter @sync-think/desktop build
- pnpm --filter @sync-think/protocol test -- src/conversation-get-context-status.test.ts
- pnpm --filter @sync-think/runtime test -- --config D:/projects/SYNC-THINK/.data/verify/context-compaction-20261002/vitest.config.ts --maxWorkers 2 --minWorkers 1

Windows 下默认 esbuild 转换大型 runtime.ts 时出现临时文件删除 Access is denied。隔离验证配置仅对该文件用 TypeScript.transpileModule 转换，所有 Runtime 行为代码与测试夹具不变；其余文件仍使用默认转换器，另外执行完整 TypeScript 构建。未修改系统安全设置、ACL 或 node_modules。此配置保存在 .data/verify/context-compaction-20261002/vitest.config.ts。

日志目录：D:/projects/SYNC-THINK/.data/verify/context-compaction-20261002/。

## 验证结果

- 最后补丁后相关 Runtime（包含图片路径）：12 个文件、190项通过。
- 桌面相关：4 个文件、72 项通过。
- 上下文协议：39 项通过。
- Runtime、Desktop、Protocol 构建：通过。Desktop 首屏 JS 2,239,985 字节，现有上限 2,240,000 字节，余量非常小；设计预览大包继续不在首屏加载。
- 最近一次全量 Runtime（2026-10-03 00:07 起跑，位于最后一次重复摘要防护补丁之前）：311 个文件，306 个通过 / 5 个未通过；3041 项通过 / 7 项失败 / 2 项跳过。耗时217.46秒。未将局部通过视为全仓库绿色。

### 全量尚未通过项（观察结果，未在此轮宣称已定位根因）

- tests/commands.test.ts：定时任务触发应 fired=true，实际 false。
- tests/conversation-content.test.ts：过程分页 steps.total 应240，实际未返回。
- tests/conversation-final-messages.test.ts：追加消息遇到 MODEL_BINDING_UNAVAILABLE。
- tests/conversation-transient-stream.test.ts：3项委派只读工具、MCP守卫和预算断言未通过。
- tests/platform-host-tools.test.ts：默认工具目录未出现该测试要求的 ocr_image。

上述为后续排查项，未用调低测试要求、跳过失败用例或放开权限来掩盖。最后一次重复摘要防护补丁后已再次通过190项相关回归并重新构建Runtime；未在该最后补丁后再跑一轮完整3051项。未完成的高级工作还包括 provider tokenizer / 同信封usage校准、模型输出上限元数据联动和持久异步压缩调度。

## 手工验收

在重启到此构建后的 Native 会话里设定可核对的约束（例如仅修改 story.md、主角林舟、待确认才发邮件），进行多轮长对话，执行 /compact，再要求继续和复述未完成事项。展开上下文详情核对四项预算；近期原文、当前用户要求和旧摘要应继续出现在后续请求。

默认参数下 272,000 窗口的软边界为 231,200，而非旧的 190,400。若输出预留或安全余量较高，边界会被实际输入预算压低，这是容量约束而非重新写死 70%。外部内核显示其自身管理状态，不被宿主再摘要一次。
