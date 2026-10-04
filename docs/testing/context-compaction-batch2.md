# Native 上下文压缩：第二批实施与验收

## 交付状态与范围

本批代码已实现并完成自行验证。Runtime、Protocol、Desktop 均构建成功；构建没有重启用户现有进程。真实用户数据库、会话内容、浏览器登录态和服务保持原状。测试使用临时 SQLite、受控 provider、实际 Runtime RPC/管道以及隔离的生产组件预览。

参考策略来自已核对的 DeepSeek Harness 提交 `639ed015397290b3745d163aafe02ffee4aa3f84`，不是对 Claude Code 内部实现的推断，也不是完整移植上游引擎。本项目保留85%软触发，外部 Claude Code / Codex 内核继续自行管理压缩。

## 已完成的修改

### 1. 一个计量器，一份请求预算

- 候选请求快照、Native 请求前检查、裁剪后复测使用相同的 UTF-8/工具消息估算与预算；工具调用参数计入输入。
- 总窗口 W、输出预留 O、安全余量 S、固定输入 F 分开；可用历史为 W−O−S−F，F 只扣一次。
- 默认软触发为 floor(min(0.85W, W−O−S))，不是固定70%，也不是达到85%必定调用摘要模型。先整理较早工具返回，再复测，需要时才生成摘要。
- 模型 limitsJson.maxOutputTokens 约束实际发送的 maxOutputTokens 与预算预留；切换/回退模型重新读取容量和输出上限。

### 2. 请求绑定的实际输入校准

- 从正常结束的 Native 业务请求读取 provider 的规范化 tokensIn；不把输出、缓存命中或累计计费再次叠进输入占用。
- 保存线程/路由绑定和系统头/工具定义指纹；相同信封下以实际输入锚点加候选历史的有符号估算差量校准。压缩/整理产生的负差量允许降低占用。
- 保守策略：provider 输入低于对应估算时继续使用估算；不同模型、路由或固定信封使旧锚点失效。摘要辅助调用与假 provider 不校准业务请求。
- 锚点是独立持久事件，不写入提示词、凭据或浏览器 cookie；重启后按任务索引恢复。计费事件仍单独记账。
- 卡片区分“请求估算，非累计计费用量”和“实际输入校准，增量估算”。分类也经对齐，分类之和等于总占用；分类和新内容差量仍是估算，不冒充精确 tokenizer。

### 3. 摘要中断、重启与重复提交

- 会话压缩操作保存操作 ID、模型绑定、来源/边界指纹、所有者与有效期；同线程的在途调用去重。
- 提交前检查所选原始消息、边界、模型绑定、所有权与取消信号。区间外新增消息保留，所选区间被编辑时拒绝旧摘要提交。
- Runtime 停止时取消在途摘要；新 Runtime 接管后把旧所有者的未完成操作记为中断，不自动重新发付费摘要。失败/取消不推进活动覆盖边界。
- 这是现有 RPC 内异步模型调用的持久生命周期，不是新建独立后台服务或无等待任务队列。

### 4. 跨轮复用自动 checkpoint

- Native 根运行的自动摘要若对应完整的规范消息前缀，校验后保存为会话级 checkpoint；下一轮读取该摘要与未覆盖原文，不再为同一旧前缀重新生成摘要。
- 当前用户原文保持在摘要之外；一条规范消息展开为多条 provider 消息时，切口须对齐整个单位。
- 当前运行继续使用稳定的系统前缀；临时工具链、图像投影、群聊成员/委派运行、非规范切口维持运行级 checkpoint，不盲目提升成其他运行共享的会话摘要。
- 原始消息保留；再次手工压缩没有新可摘要区间时直接跳过。

### 5. 修复回归和卡片加载

- 修复继承写权限的委派子任务漏过 Token 预算检查；只读派发、MCP 写工具检查继续生效，没有放开权限掩盖问题。
- 过程分页即使整页装得下，也返回 total/version；全部已返回时不制造无意义 nextOffset。
- 上一批7项失败有实际实现问题，也有陈旧测试前提：只读测试显式指定只读；最终消息测试使用有效假模型；定时模型任务通过真实 RPC 建立有效绑定，并核对改目标创建独立会话；OCR 断言与显式 fallback 开关一致。断言、类型检查和权限守卫仍保留。
- 卡片懒加载，保留展开动效、减弱动画偏好、Escape 关闭/焦点回归和窄屏定位；详情来源说明更清楚。
- 设计目录生成器不再重写内容未变的文件，避免 Windows 文件占用造成生成失败；没有改 ACL、安全设置或 node_modules。

## 自动验证结果

最终生产代码上的结果：

- Runtime 全量：**314个文件，3062项通过，2项跳过，0项失败**。
- Protocol 全量：**27个文件，229项通过**，其中包含40项上下文状态协议校验。
- Desktop 相关：**4个文件，73项通过**。这是相关回归，不代表执行了桌面全部测试。
- Runtime、Protocol、Desktop 完整构建：**通过**。
- Desktop 首屏 JS：**2,231,135 / 2,240,000字节**；总 JS：**3,499,665 / 3,500,000字节**。没有放宽构建上限，总包余量仍很小。

关键覆盖：模型输出上限、缓存输入不重复计量、计量分类对齐、usage 锚点重启恢复及换模型失效、摘要失败/取消/重复调用、时钟回拨与摘要期间追加/编辑、未完成操作重启清理、跨轮自动摘要只调用一次、当前用户与工具配对保护、继承权限子任务预算、过程分页与定时任务绑定。

日志目录（机器本地时区命名）：D:/projects/SYNC-THINK/.data/verify/context-compaction-20261003/。

- runtime-final-full-tests.log：最后生产补丁后的全量结果。
- runtime-reproducible-full-tests.log：使用仓库内可复现验证配置再次全量运行。
- protocol-final-tests.log、desktop-final-tests.log：协议全量及桌面相关结果。
- runtime-final-build.log、protocol-final-build.log、desktop-final-build.log：完整构建。
- browser-qa.json：隔离组件预览检查记录。

### 浏览器检查的实际范围

Browser 插件和相应 browser 技能未提供；使用已有的 bundled Node Playwright 与本机 Chrome，无安装步骤。Python 环境未包含 Playwright。测试为独立临时浏览器 profile 和本地静态服务，不使用用户已登录的浏览器。

检查了生产组件的深浅色、0.22秒展开动画、关闭/再展开、入口懒加载、Escape 关闭与焦点返回、390px视口下弹层宽374px且左右8px、无横向溢出及 reduced-motion。浏览器/本地测试服务均已关闭。

截图属于组件 fixture，不是用户真实上下文数字或付费模型执行证据。初始预览捕获一条未归属的资源404；重新载入及新上下文检查没有资源错误或 pageerror，未把这条记录擦掉。

## 可复现的开发测试

在 D:/projects/SYNC-THINK 打开终端，使用项目要求的 Node 20：

```powershell
pnpm --filter @sync-think/runtime test -- --config vitest.verification.config.ts --maxWorkers 2 --minWorkers 1
pnpm --filter @sync-think/protocol test
pnpm --filter @sync-think/desktop test -- src/renderer/shell/agent-limits-card.test.tsx src/renderer/shell/compose-toolbar.test.tsx src/renderer/shell/ChatView.usage.test.tsx src/renderer/shell/ChatView.history-navigation.test.tsx
pnpm --filter @sync-think/protocol build
pnpm --filter @sync-think/runtime build
pnpm --filter @sync-think/desktop build
```

验证配置位于 D:/projects/SYNC-THINK/apps/runtime/vitest.verification.config.ts。Windows 上默认 esbuild 曾在大型 runtime.ts 的临时文件清理中报 Access is denied，因此显式验证配置只把该文件交给 TypeScript.transpileModule；其余转换、生产代码、测试发现和断言不变。完整 TypeScript build 另外执行。普通开发启动与生产构建不使用该配置。

## 用户手工验收

1. 保存手头任务并正常退出 Sync-Think，再从原有启动入口重启 **Runtime 和 Desktop**。只刷新窗口未必加载新的 Runtime。确认使用 Native 内核；外部内核不是这套宿主压缩的验收对象。
2. 点击输入框旁的上下文用量入口，展开“窗口与压缩详情”。检查软水位为85%或受实际输入预算限制的更低水位；输出预留、安全余量、固定输入成本、历史预算彼此一致。首次无有效锚点应显示估算，条件满足后显示实际输入校准；并非每个模型都会转为校准。
3. 新建隔离验收会话，发送：“请记住：小说主角林舟；只维护 story.md；结尾保持悬念；未确认前不发邮件；未完成事项是第二章大纲。”用若干轮较长素材填充上下文，然后执行已有 /compact 操作。
4. 紧接着问：“继续之前的任务，先复述硬约束和未完成事项。”核对主角、文件路径、邮件限制与第二章大纲；近几轮补充也应保留。不要以卡片数字变小代替内容验收。
5. 没有新增旧区间时再次 /compact，应跳过重复摘要；继续一轮后应使用已有 checkpoint。重启再询问同样事项，持久约束/尾部应继续可读；切换模型时容量和输出上限重新计算，旧路由锚点不套用。
6. 自动85%触发需要足够长的会话；“没有达到水位就没生成摘要”属于预期。需要明确看到输出上限效果，可选择 limitsJson 已配置较小 maxOutputTokens 的测试模型。别在真实重要会话中故意制造崩溃：取消/重启/来源冲突的异常路径已在临时数据库中验证。

### 仍需明确的边界

- 未调用用户付费真实模型进行摘要语义质量验收；结构、事务、预算和持久化链路已通过受控 provider 集成测试，真实模型是否完整保留事实应按上述手工场景检查。
- 未引入所有 provider 的精确 tokenizer，也未接通套餐服务额度；卡片区分估算、校准和未接入状态。
- 没有宣称把全部 DSH 机制或 Claude Code 私有机制移植完成；本批范围以已修改代码与上述验证为准。
