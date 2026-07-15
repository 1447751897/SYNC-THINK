# 外网真实网关 UI 手测清单（M1 退出证据）

> 自动化 dual-http/dual-protocol **不能**替代本清单。  
> 你在本机填完并勾选关键路径后，才能讨论关闭 M1。  
> **不要把真实 API Key 写进本仓库。**

## 前置
- [x] 桌面端已启动，Runtime「已连接」
- [x] 已打开一个任务（会话就绪条任务芯片绿）
- [x] 准备至少 **2 个** 可访问的 Provider 端点（KMKAPI / Unity2.Ai；Unity2.Ai 当前额度不足但端点真实返回 503）
- [x] 准备至少 **3 个** 模型 id（`grok-4.5`、`gpt-5.6-sol`、`gpt-5.5`、Claude Haiku/Sonnet）

## A. Providers 导入与发现
- [x] Provider A：由 CC Switch 导入 KMKAPI 分组，预览后写入安全存储；导入后可编辑名称、Base URL 与协议
- [x] 发现模型：KMKAPI / Unity2.Ai 均出现模型；失败信息可行动，未包含明文 key
- [x] Provider B：由 CC Switch 导入 Unity2.Ai 分组，协议为 `anthropic-messages`
- [x] Providers 顶部「多模型就绪」：Provider ≥2 / 模型 ≥3 变绿

## B. 同任务多模型对话（核心）
- [x] 不重述上下文，同一任务调用 ≥3 个真实模型；Unity2.Ai Claude 因账户池额度返回 503
- [x] 「发送就绪」条：Agent 默认与本轮模型解析正确
- [x] Trace 有中文类别；真实 `gpt-5.6-sol` 运行可停止并写入 `run.cancelled`。该网关在首个增量前可取消，另一次响应以快速批量增量完成，因此不声称保留了外网部分输出
- [x] 每轮后 Manifest 可打开，解析阶梯与 Agent 默认 / Fallback 链位可见

## C. 绑定与 Fallback（若配置）
- [x] Agent 默认 `gpt-5.6-sol` + fallback `gpt-5.5` 保存，重启后恢复为 Agent v12
- [x] 主模型 Unity2.Ai Claude 返回 503 后切换至 `gpt-5.5`；记录 `run.fallback.selected`、`fallbackIndex: 0`，最终回复唯一
- [x] 无可用 fallback 时写入 `run.paused`（`fallback_exhausted` / `no_fallback_configured`），未静默换模

## D. 安全与恢复
- [x] 11 个真实 vault secret 对 255 个 DB/WAL/备份/诊断/日志文件逐字节扫描，明文命中 0；证据导出精确 secret 与 secret-like token 命中均为 0
- [x] 重启应用：任务、32 条消息、Fallback trace、唯一最终回复均恢复；事件计数前后不变
- [x] Unity2.Ai 额度不足 / Claude Code 客户端限制等已知限制可读，未误报为本客户端协议故障

## E. 记录
- 手测日期：2026-07-12 至 2026-07-13（Asia/Shanghai）
- 协议组合：`openai-chat` / `openai-responses` / `anthropic-messages`
- 是否通过核心路径：是（18/18 有直接证据）
- 阻塞问题：Unity2.Ai Claude 账户池当前无额度；不阻塞 fallback、暂停与协议兼容性验收
- 对应 dogfood 日记路径：`docs/development/dogfood/2026-07-12.md`、`docs/development/dogfood/2026-07-13.md`

## 自动化侧已具备（勿与本清单混淆）
- dual-http-gateway / dual-protocol-gateway 测试：本机假网关 ≥2 Provider / ≥3 模型 / Manifest / 密钥擦洗
- 见 `13-plain-selftest-log.md` 第 16 次及更早 dual 记录
