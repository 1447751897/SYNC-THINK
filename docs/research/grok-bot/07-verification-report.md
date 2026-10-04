# 07 · 独立验证报告（WS6 / 红队）

> 验证对象：`docs/research/grok-bot/01~06`（WS1–WS5 产出）+ 根目录三份 v0.47.0 旧文档
> 被测产物：`.tmp-grok-bot/app`（Grok Bot **0.63.0**，只读）
> 本机数据：`%APPDATA%\Grok Bot\sand-client-persistence\`（只读；验证时刻 **2026-10-01T02:06Z / 本地 10:06**）
> 验证脚本：`.tmp-grok-bot/verify/*.mjs`（**全部是我自己写的**，不复用队友脚本做结论；仅在 D12 按要求**运行** WS5 的只读脚本）
> 判定口径：**成立** = 我用独立命令复现出同样结果；**部分成立** = 主体成立但表述/数字需修正；**不成立** = 与产物或数据相反；**无法判定** = 证据不足，不附和、不臆断。

---

## 0. 方法学与两条前置修正

**（0.1）proto 参考文件的编码问题。** `.tmp-grok-bot/scripts/proto-all.txt` 是 PowerShell 重定向产物 → **UTF-16LE 无 BOM**（用 UTF-8 读会看到 `\u0000#\u0000#\u0000`，很多工具会判为 binary 并"读不到行号"）。
我因此**独立重新生成**了一份自己的 dump：

```powershell
node .tmp-grok-bot/scripts/proto-extract.mjs .tmp-grok-bot/app/dist/electron-main/proto.cjs  # 输出重定向到 verify/proto-all-WS6.txt (UTF-8)
```

```
# types=2048 enums=71
WS6 regen types=2048  teammate proto-all types=2048
identical set? true    only in regen: 0    only in teammate: 0
```

→ 队友的 `proto-all.txt` 类型集合与我的独立重生成**逐名一致**（2048/71），可以采信；但我后续所有引用都指向我自己的 `verify/proto-all-WS6.txt`。

**（0.2）`proto-all.txt` 的"类型"列会把 message 引用渲染成 `enum`。** `proto-extract.mjs` 把 `#N` 一律标成 `enum`。实测 protobuf-es 的 `#N` 是**尾随 refs 数组的下标，既可能是 enum 也可能是 message**。例：

```
$(){return["ListGrokBotUserBotMemoriesResponse|1 memories #0*",Mw]}
  ref Mw -> MESSAGE GrokBotMemoryFact          ← 我写 verify/refsem.mjs 解析 refs 数组得到
```

→ 凡涉及"某字段是不是 message / 是什么 message"的判定，我一律回到 bundle 里的**原始 `$()` 描述符 + refs 解析**，不用 `proto-all.txt` 的 type 列。这也是下面若干"队友结论基本对、但字段类型细节需要补"的由来。

**（0.3）本报告的全部脚本**（均在 `.tmp-grok-bot/verify/`，只读 `app/` 与 `%APPDATA%`）：
`v-tools.mjs`（字节级 grep/slice/refscan）、`pq.mjs`（读 UTF-16 proto dump 的段落）、`raw-descriptor.mjs`、`refsem.mjs`、`persist-audit.mjs`、`e13-audit.mjs`、`e13-quant.mjs`、`dump-replica.mjs`、`ws3-check.mjs`、`rpccount.mjs`、`callsites-replica.mjs`、`sessionkind*.mjs`、`slicekey*.mjs`、`ws4-data-check.mjs`、`ws5-anchors.mjs`、`tri-triggers.mjs`、`triggers.mjs`、`last-checks.mjs`、`daemon-grokbot.mjs`。

**（0.4）一次自查返工（保留，因为它改了一条判定）。** 我第一版的 `v-tools.mjs grep <needle> <路径子串>` 用 `/` 拼路径过滤，而 walk 出来的是 Windows 反斜杠绝对路径 → 过滤永不命中，`grep "GrokBot" local-exec-daemon` 假报 **0**。我用"正例对照"（`agent.v1.` 应为非零）发现该 bug 后重跑，真实值是 **922**。因此 A4 的归属判定从"不成立（daemon 无 GrokBot）"改成"**无法判定（无证据）**"，并换用下面三条真正成立的理由（§2.1/A4）。这条返工也顺带**正面佐证了 WS3 §3.1** 的"描述符 vs 调用点"方法论：daemon 里 GrokBot 描述符很密集，但**没有任何调用点**。

---

## 1. 结论摘要（编号 | 被验证的结论 | 判定 | 证据）

| # | 被验证结论（含出处） | 判定 | 关键证据 |
|---|---|---|---|
| **A1** | `PromoteGrokBotMemoriesToTeam` 在 daemon/coordinator 只有 proto 描述符、无调用点；真正调用方在 `main-app.cjs`（02 §3.4/03 §3.1） | **成立**（偏移修正 10B） | `.promoteGrokBotMemoriesToTeam(` 全库 1 处 @1899396；daemon/coordinator 各仅 1 个 service 注册项 + 2 个消息描述符 |
| **A1b** | `GetGrokBotTeamContextSummary` 无实际调用（02 §3.4） | **成立（比原文更强）** | 全 app 只有 proto.cjs/daemon/coordinator 各 3 处描述符；main-app/preload/renderer **0 命中** |
| **A2** | `context-folder-B7_jGHrF.webp` 在全部产物中 0 引用（02 §6） | **成立** | 566 个非 webp 文件**字节级**扫描：`context-folder`=0、`B7_jGHrF`=0；全部 `.webp` 命中仅 MIME 表与内联图 |
| **A2b** | 「511 个 JS/CJS 文件」这个分母（02 §4.1） | **成立** | 实测 `dist/` 下 467 `.js` + 44 `.cjs` = **511** |
| **A3** | `chunk-compact-C8-lyxgK.js` 是 emojibase 表情数据、不是 `/compact`（02 §4.4） | **成立** | 开头 `JSON.parse(\`[{"hexcode":"1F1E6","label":"regional indicator A"…`；`compact`=0、`/compact`=0、`context_usage`=0 |
| **A4** | `PreCompact` hook 存在，输入含 `context_usage_percent` / `messages_to_compact`（02 §4.2） | **成立** | `PreCompactRequestQuery\|1 trigger 9\|2 context_usage_percent 1\|…\|6 messages_to_compact 5\|…` @daemon 2199229 |
| **A4b** | 该 hook 属于 **Grok Bot** | **无法判定（无证据）** | 只在 `local-exec-daemon/main.cjs`（4 处）；`main-app.cjs` 对 `PreCompact` **0 命中**；同表事件为 `beforeShellExecution`/`afterFileEdit`/`beforeTabFileRead`（IDE/CLI agent hook）。注意：daemon 确实内嵌 GrokBot proto 描述符（`GrokBot` 922 处、`GrokBotService` 服务描述符 1 处），所以"daemon 无 GrokBot 字样"**不是**有效论据 |
| **A5** | `ListGrokBotUserBotMemories{agent_id} → memories: GrokBotMemoryFact{fact_id,text,learned_at_ms}`（题面 A4 / 02 §3.3） | **成立** | 原始描述符 + refs 解析：`#0*`→refs[0]=`Mw`=GrokBotMemoryFact |
| **B5** | 不存在 `UpdateGrokBotAgentDefinition` / `PutGrokBotMemoryShard` / `ListGrokBotMemoryShards`（03 §3.2） | **成立**（需补 2 条） | 三名全 app 0 命中；但存在 `AdminGetGrokBotAgentDefinition`（仅描述符）与 `GrokBotAgentDefinitionMemoryShard` **消息类型** |
| **B6** | `UpdateGrokBotAgentRequest` 字段（03 §3.2 版：`…clear_avatar \| avatar_data_url`） | **成立**；题面版 `avatar_data_change` **不成立** | 原始：`7 clear_avatar #0 avatar_change\|8 avatar_data_url 9 avatar_change`，refs[0]=`google.protobuf.Empty` |
| **B7** | 运行时工具 `UpdateAgent`/`CreateAgent`/`SendToAgent` 与拒绝码 `agent-rename/refused` 真实存在（03 §3.3） | **成立（逐字节）** | `SendToAgent`@614499、`UpdateAgent`@614517、`CreateAgent`@614954；`Nm="agent-rename/refused"`@**615906** |
| **B7b** | `update_state` 的 target 仅 `routine\|memory\|skill`（03 §3.3） | **成立** | 5 处 `update_state` 全在 renderer，target 只出现这三个值；action=create/write/resume，memory 带 `tier:"log"` |
| **B8** | `MAX_BOT_SKILLS` / `tooManySkills` 存在（03 §5） | **成立，但数值不可得** | 72 / 32 处命中，均为 **i18n ICU 复数消息**（`["MAX_BOT_SKILLS"]` 是插值占位符，值由服务端下发） |
| **B8b** | 「每 bot 50 routines / 保留 20 条运行记录」在产物中 0 命中（03 §2.3） | **成立** | `50 routines`=0、`20 runs`=0、`run records`=0、`MAX_ROUTINES`=0；proto 无 run-history 类型 |
| **B8c** | `aiserver.v1.GrokBotService` 共 **249** 个 RPC（03 §3.2） | **成立（精确）** | 花括号配平计数：**249**（244 Unary + 5 ServerStreaming）；proto.cjs 全服务方法 406（=03 §3.2 的"406 全解析"） |
| **C9** | turn 协议字段 + Dispatch/Outcome/Intake 枚举（01 §3.1–3.4、04 §2.1） | **成立（逐字节）** | 见 §2.3；`NOT_TEMPORAL=3` 确实存在 |
| **C10** | 房间三件套 RPC 字段、`SessionKind.GROUP=5`、`AgentKind.ROOM`（04 §2.1） | **成立** | `CreateGrokBotRoomRequest@875976`、`SetGrokBotRoomMembersRequest@876780`、`AddGrokBotRoomPeopleRequest@880651`；`GrokBotAgentKind=AGENT=1\|ROOM=2` |
| **C11** | 旧文「群成员四种触发规则（mention/keyword/message/reaction）」是**过度归因**（01 §4.2/4.3、04 §10） | **成立，更正正确** | `"reaction"` 全库仅 1 处 @911833，位于 `{type:"slack",channel,match:EMt}`；UI 文案 `Wake automations on Slack…`@774587；`harnessMayCollect` 属通话记录 schema |
| **D12** | WS5 的解码数字（18 文件 / 7 replica / 61·49·34·14·12·2·2=174 / seq 空洞） | **成立（全部可复现）** | 亲自运行 WS5 只读脚本 + 我自己的独立解码器，逐项一致；见 §2.4 |
| **D12b** | WS5 §6.3「GrokBotService 的 **304** 个方法」 | **不成立（数字错）** | 实测 **249**；304 是"扫描窗口越界到下一个 service"的产物（我的朴素扫描同样得到 304，配平后 249） |
| **E13** | 06 的 staff 说法 vs 02「群聊消息不写入成员 transcript」是否矛盾 | **不矛盾，属"层次不同 (b)"**；02 的**绝对措辞需降级** | 跨成员群文本 0 命中，但 `d4c37f88` 自己有 1 条 `toAgent{kind:"group"}` 组内发言落在同一 seq 序列里；见 §2.5 |
| **E13b** | 有无代码把房间消息写进 `GROUP session` | **不成立（无）** | 唯一消费者是 main-app 的 `Qqt()` 映射器 @1901148，**没有 GROUP 分支**（`default: return null`） |
| **E14-01** | 01 抽样 7 条最重结论 | **7 成立 / 1 分母修正** | §2.6.1 |
| **E14-02** | 02 抽样 8 条最重结论 | **7 成立 / 1 降级 / 2 修正** | §2.6.2 |
| **E14-03** | 03 抽样 7 条最重结论 | **7 成立 / 1 口径修正** | §2.6.3 |
| **E14-04** | 04 抽样 7 条最重结论 | **7 成立 / 1 措辞修正** | §2.6.4 |
| **E14-05** | 05 抽样 7 条最重结论 | **6 成立 / 1 数字不成立 / 1 时效说明** | §2.6.5 |
| **E14-06** | 06 抽样 5 条最重结论 | **3 间接或部分支持 / 1 一致（非证明）/ 1 无法判定** | §2.6.6 |

---

## 2. 逐条详证

### 2.1 A 组（WS2：上下文/记忆）

#### A1 — 记忆 RPC 的"描述符 vs 调用点"

```powershell
node verify/v-tools.mjs exact ../app/dist/electron-main/main-app.cjs ".promoteGrokBotMemoriesToTeam("
node verify/v-tools.mjs exact ../app/dist/local-exec-daemon/main.cjs ".promoteGrokBotMemoriesToTeam("
node verify/v-tools.mjs exact ../app/dist/node-agent-coordinator/main.cjs ".promoteGrokBotMemoriesToTeam("
```

```
../app/dist/electron-main/main-app.cjs :: ".promoteGrokBotMemoriesToTeam(" count=1
1899396
../app/dist/local-exec-daemon/main.cjs :: ".promoteGrokBotMemoriesToTeam(" count=0
../app/dist/node-agent-coordinator/main.cjs :: ".promoteGrokBotMemoriesToTeam(" count=0
```

daemon 里 `PromoteGrokBotMemoriesToTeam` 全部 3 次命中都是描述符形态：

```
@3037151  $(){return["PromoteGrokBotMemoriesToTeamRequest|1 agent_id 9|2 fact_ids 9*"]}
@3037583  $(){return["PromoteGrokBotMemoriesToTeamResponse|1 created #0*|2 already_in_team #0*|3 kept_private_count 13",…]}
@3167624  …listGrokBotUserBotMemories:{name:"ListGrokBotUserBotMemories",…},promoteGrokBotMemoriesToTeam:{name:"PromoteGrokBotMemoriesToTeam",I:zB,O:jB,kind:V.Unary},…
```

调用链（main-app @1899396，我就近截取 900 字节）：

```js
listUserBotMemories: async o => (await r().listGrokBotUserBotMemories({agentId:o}, n)).memories.map(c6),
promoteMemoriesToTeam: async (o,i) => { let a = await r().promoteGrokBotMemoriesToTeam({agentId:o, factIds:[...i]}, {timeoutMs:Bqt});
  return {created:a.created.map(c6), alreadyInTeam:a.alreadyInTeam.map(c6), keptPrivateCount:a.keptPrivateCount} }
```

→ 再经 preload @105784 / renderer @381583、@1368620 走 IPC。**判定：成立。**
**偏移更正**：WS2 §3.4 写 `main-app.cjs @1899406`，实测调用形态起点是 **@1899396**（差 10 字节，属引用精度问题，不影响结论）。

`GetGrokBotTeamContextSummary` 更彻底：

```powershell
node verify/v-tools.mjs grep "GetGrokBotTeamContextSummary"
```
```
proto.cjs n=3 / local-exec-daemon n=3 / node-agent-coordinator n=3     TOTAL = 9
```
main-app、preload、renderer **全部 0**。→ 02 §3.4「无任何调用点」**成立且更强**：这个 RPC 在 0.63.0 桌面端是**完全未接线**的（不是"调用方在别处"）。

#### A2 — 孤立资源 `context-folder-B7_jGHrF.webp`

```powershell
node verify/v-tools.mjs refscan "context-folder-B7_jGHrF"
```
我改用**字节级**扫描（避免 UTF-8 解码破坏二进制文件的匹配）：

```
TARGET context-folder-B7_jGHrF -> total=0
TARGET context-folder -> total=0
TARGET B7_jGHrF -> total=0
```
分母：`total files=567`（`dist/renderer/assets/` 519、`.js` 467、`.cjs` 44）。→ **判定：成立**（0 引用）。
补充：`.webp` 文件名之外的 `.webp` 字符串命中只有 MIME 表（`".webp":"image/webp"`）与内联 data-URI，与 `context-folder` 无关。

#### A3 — `chunk-compact-*.js` 的真实身份

```powershell
node -e "const s=require('fs').readFileSync('app/dist/renderer/assets/chunk-compact-C8-lyxgK.js','utf8');
  console.log(s.length); console.log(JSON.stringify(s.slice(0,180)));
  for(const k of ['emojibase','/compact','compact','context_usage','PreCompact']) console.log(k, s.split(k).length-1);"
```
```
len=546185
"y};\nconst e=JSON.parse(`[{\"hexcode\":\"1F1E6\",\"label\":\"regional indicator A\",\"unicode\":\"🇦\"},…
emojibase 0   /compact 0   compact 0   context_usage 0   PreCompact 0
tail: …{"group":9,…,"label":"flag: Wales","order":5225,…}]`);export{e as defaul
```
→ **判定：成立**，是 emojibase 的 compact 表情数据集（5225 条），与"上下文压缩"无关。
**口径更正**：02 §4.4 写"571,490 字节"= 磁盘文件大小；我读到的是 **546,185 个字符**（emoji 多字节，字节数>字符数）。两者都对，但必须标注口径（字节 vs 字符），否则两个数字看起来互相矛盾。

#### A4 — `PreCompact`：存在性 vs 归属

存在性：

```powershell
node verify/v-tools.mjs grep "PreCompact"            # 只在 local-exec-daemon，n=4
node verify/v-tools.mjs grep "context_usage_percent" # 只在 local-exec-daemon，n=1
node verify/v-tools.mjs grep "messages_to_compact"   # 只在 local-exec-daemon，n=1
```
daemon @2199229 原始描述符：
```
PreCompactRequestQuery|1 trigger 9|2 context_usage_percent 1|3 context_tokens 3|4 context_window_size 3|
5 message_count 5|6 messages_to_compact 5|7 is_first_compaction 8|8 conversation_id 9?|9 generation_id 9?|
10 model 9?|11 model_id 9?|12 model_params #0*
PreCompactRequestResponse|1 user_message 9?
```
02 §4.2 的字段表**逐字正确**。

归属（这条是**红队重点**，我在这一条上返工过一次）：

```powershell
# ❌ 错误做法（我第一版）：路径过滤用了 "/"，而 walk 返回的是 "D:\...\dist\local-exec-daemon\main.cjs" → 恒不命中，假报 0
node verify/v-tools.mjs grep "GrokBot" "../app/dist/local-exec-daemon"      # → TOTAL 0  ← 假阴性
# ✅ 正确做法：用能匹配绝对路径的子串
node verify/v-tools.mjs grep "GrokBot" "local-exec-daemon"
node verify/v-tools.mjs grep "PreCompact" "local-exec-daemon"
node verify/v-tools.mjs grep "PreCompact" "electron-main"          # main-app / main-core / proto.cjs
node verify/v-tools.mjs grep "PreCompact" "renderer"
```
```
TOTAL "GrokBot" = 922            ← daemon 里 GrokBot 描述符很密集（我第一版报 0 是工具 bug）
TOTAL "PreCompact" = 4           ← 只在 daemon
main-app/main-core/proto.cjs：0 个 PreCompact        renderer：0 个 PreCompact
```
daemon 里 `GrokBotService` 只有 2 处（`verify/daemon-grokbot.mjs`）：

```
@1987899  …{prod:{variant:"prod",appName:"Grok Bot Computer Use",bundleId:"co.anysphere.grok-bot-computer-use",executable:"CUGrokBotService"}…
@3157299  var Qje={typeName:"aiserver.v1.GrokBotService",methods:{ensureSandBox:{name:"EnsureSandBox",I:mM,O:p7,kind:V.Unary},…}}
probe "createClient" n=2（均与 GrokBotService 无关）  probe "GrokBotService," n=0   → 没有客户端实例化
```

同一张 hook 事件表里还有（同一 bundle）：
```
beforeTabFileRead n=4 / afterFileEdit n=3 / beforeShellExecution n=4 / workspaceOpen n=4
PreCompact 与 PreToolUse / UserPromptSubmit / SubagentStop / SessionStart / SessionEnd 并列
```
→ **判定：**「`PreCompact` 存在」**成立**；「它属于 Grok Bot 的压缩机制」**无法判定 / 无任何支持证据**。成立的三条理由是：(i) `main-app.cjs`（真正调用 `GrokBotService` 的进程）对 `PreCompact` **0 命中**；(ii) 同表兄弟事件是 **Cursor IDE/CLI agent 的 hook 名**；(iii) 本机 7 个 Grok Bot agent 的 harness 全是 `temporal`（云端 box），不走 `local-exec-daemon`。**"daemon 里没有 GrokBot 字样"不是有效论据**（daemon 内嵌了整套 GrokBot proto 描述符，922 处）。
02 §4.2 把它写成"**真正的**压缩机制"是**过度归因**（详见 §3 更正 #2）；正确写法是"本地 agent 运行时存在该 hook 协议，是否作用于 Grok Bot 未证实"。

#### A5 — `ListGrokBotUserBotMemories` 的字段与类型

```powershell
node verify/raw-descriptor.mjs ../app/dist/electron-main/proto.cjs ListGrokBotUserBotMemoriesResponse
node verify/refsem.mjs       ../app/dist/electron-main/proto.cjs ListGrokBotUserBotMemoriesResponse
```
```
$(){return["ListGrokBotUserBotMemoriesResponse|1 memories #0*",Mw]}
refs = ["Mw"]   ref Mw -> MESSAGE GrokBotMemoryFact
$(){return["GrokBotMemoryFact|1 fact_id 9|2 text 9|3 learned_at_ms 3"]}
```
→ **判定：成立。**（若只看 `proto-all.txt` 的 type 列，`memories` 会被显示成 `enum` —— 这正是 §0.2 的方法学坑。）

#### A 组附加发现（不推翻任何结论，但终稿应用）

`GrokBotAgentDefinition.memory_shards[].folder` 的 `logs` 字段在 v0.47.0 旧文档里**不存在**：

```
旧文 grok-bot-context-sharing-research.md:191
  5  memory_shards[] : GrokBotAgentDefinitionMemoryShard {scope, scope_key, version, box_backfilled, folder{profile}}
0.63.0 原始描述符
  GrokBotMemoryFolder|1 profile 9|2 logs 9,9      ← logs（repeated string）是 0.63.0 才有
```
这与 `update_state target "memory" … tier "log"`（renderer @708737）完全对应：**0.63.0 把记忆从"单份 profile"扩成"profile + 追加式 logs"两层**。三份旧文档、以及 02/03 都没有点名这条版本差异，建议写进终稿。

---

### 2.2 B 组（WS3：自进化）

#### B5 — 三个"不存在"符号

```powershell
foreach ($k in 'UpdateGrokBotAgentDefinition','PutGrokBotMemoryShard','ListGrokBotMemoryShards','GrokBotMemoryShard')
  { node verify/v-tools.mjs grep $k }
```
```
TOTAL "UpdateGrokBotAgentDefinition" = 0
TOTAL "PutGrokBotMemoryShard" = 0
TOTAL "ListGrokBotMemoryShards" = 0
TOTAL "GrokBotMemoryShard" = 0
```
我的 2048 类型 dump 里同样 `NOT FOUND`。→ **判定：成立。**
**但必须补两条**（否则终稿会漏掉协议面）：
1. 存在 **`AdminGetGrokBotAgentDefinition`**：`Request{1 agent_ref 9|2 identity_only 8}` → `Response{1 identity|2 definition|3 refusal 9}`；只在 proto.cjs/daemon/coordinator 各 3 处描述符，**0 调用点**（管理面，未接线）。
2. 存在 **`GrokBotAgentDefinitionMemoryShard`** 消息类型（不是 RPC）：
```
$(){return["GrokBotAgentDefinitionMemoryShard|1 scope 9|2 scope_key 9|3 version 13|4 box_backfilled 8|5 updated_at_ms 3|6 folder #0",rD]}
```
→ "记忆 shard"作为**数据类型**仍然存在，消失的只是 shard 的**读写 RPC**。

#### B6 — `UpdateGrokBotAgentRequest` 的精确字段（**题面 vs 产物不一致**）

```powershell
node verify/raw-descriptor.mjs ../app/dist/electron-main/proto.cjs UpdateGrokBotAgentRequest
node verify/refsem.mjs       ../app/dist/electron-main/proto.cjs UpdateGrokBotAgentRequest
```
```
$(){return["UpdateGrokBotAgentRequest|1 id 9|2 name 9|3 description 9|4 title 9|5 avatar_shape 9|
6 avatar_color 9|7 clear_avatar #0 avatar_change|8 avatar_data_url 9 avatar_change",yt]}
refs = ["yt"]   ref yt -> MESSAGE google.protobuf.Empty
```
结论：
- 字段共 **8 个**：`id, name, description, title, avatar_shape, avatar_color, clear_avatar, avatar_data_url`。
- **`avatar_change` 是 oneof 组名**（出现在 7、8 两个字段尾部），**不是字段名**。
- **`avatar_data_change` 这个字段名在 0.63.0 不存在**（题面里的写法有误；WS3 §3.2 写的是 `clear_avatar | avatar_data_url`，**WS3 是对的**）。
- `clear_avatar` 的类型是 **`google.protobuf.Empty`**（oneof 里的标记消息），不是 bool —— 02/03 都没写清这一点。
- → **判定：WS3 版成立；题面版不成立。**

#### B7 — 运行时工具与拒绝码（逐字节）

```powershell
node -e "…在 renderer/index.eager-app-B5P3neeI.js 中逐个 indexOf…"
```
```
=== SendToAgent  @614499 :: …case"SendToAgent":case"UpdateAgent":{const r=n==="SendToAgent"?"sending":"messaging",…
=== UpdateAgent  @614517 :: （同一 switch-case）
=== CreateAgent  @614954 :: …case"CreateAgent":case"ReactToMessage":case"SendIMessage":return at("messaging","messaging","Messaging","person-chat-bubble");
=== agent-rename/refused @615906 :: const cme=255,WS="box",u5="temporal";…const Wr="temporal-creation-refused",Nm="agent-rename/refused";
```
WS3 §3.3 的三个偏移（614516/614953/614498）与 `Nm`@**615906** **完全命中**（差 ≤1 字节）。→ **判定：成立（逐字节级）。**
补充：这三个工具名只出现在**渲染端"工具→UI 文案"的 switch**里（客户端需要认识工具名才能画活动标签），**函数体/实现不在桌面产物内** —— 与 03 §3.3 的判断一致。

`update_state`：
```powershell
node verify/v-tools.mjs grep "update_state"     # 只在 renderer，n=5，偏移 707773/708737/708934/709950/711470
```
5 处全文里的 target 取值：`"routine"`（create/resume）、`"memory"`（write，`tier "log"`）、`"skill"`（create）。**没有第四种 target。** → **判定：成立。**

#### B8 — skill 上限：存在但数值不可得

```powershell
node verify/v-tools.mjs grep "MAX_BOT_SKILLS"   # 72 处，跨 32 个 chunk-core-* + index.eager-app
node verify/v-tools.mjs grep "tooManySkills"    # 32 处
```
en 文案原文（index.eager-app @99538）：
```json
"WnW32b":[["tooManySkills","plural",{"one":["#"," file was skipped because this Bot already has ",["MAX_BOT_SKILLS"]," skills"],…}]]
```
→ `MAX_BOT_SKILLS` 是 **ICU 消息的插值占位符**（`["MAX_BOT_SKILLS"]`），**不是数值常量**；具体数字由服务端下发，**产物内不可得**。→ **判定：存在=成立；数值=不可得**（若 03 §5 写了任何具体数字，需要删掉/标注）。

`50 routines / 20 runs`：`50 routines`、`20 runs`、`run records`、`routineRun`、`maxRoutines`、`MAX_ROUTINES` **全部 0 命中**；proto 侧 `GrokBotAgentAutomation{automation_id, record_json}`，RPC 只有 `List / Set…Enabled / Delete…`，**无 run-history 类型**。→ **判定：成立**（"代码里核实不了"是正确表述）。

#### B8c — RPC 计数（WS3 vs WS5 冲突的仲裁）

```powershell
node verify/rpccount.mjs
```
```
GrokBotService typeName @1034904    methods:{ @1034933    methods object end @1056923  length=21982
GrokBotService methods = 249  distinct=249  kinds={"Unary":244,"ServerStreaming":5}
services with methods tables = 7: AgentStoreService, AiService, BackgroundComposerService, DashboardService, AnalyticsService, GrokBotService, SandBoxService
ALL service methods in proto.cjs = 406, distinct = 351
```
→ 03 §3.2 的 **249** 与 **406** 都精确成立；05 §6.3 的 **304** 不成立（见 §3 更正 #4）。

#### B 组附加：触发器联合逐字核对

```
main-app @913922 webhook / @913978 cron / @911995 slack / @912085 github / @912385 origin
        / @912639 microsoftTeams / @913219 linear / @913371 sentry / @913547 pagerduty / @913732 email
@914272  OMt=(0,p.rpcObject)({type:(0,p.rpcLiteral)("group"),listeners:PMt}),DMt=(0,p.rpcUnion)(TTe,OMt),
         ETe=(0,p.rpcObject)({name:…,prompt:…,trigger:DMt,isEnabled:…})
@913979  TTe=(0,p.rpcUnion)(BMt,CMt,bMt,IMt,vMt,wMt,TMt,RMt,xMt,MMt)   ← 恰好 10 类叶子
         PMt=Si("at least two triggers", …)
```
03 §2.2 的 10 类触发器、`group` 组合器、"至少两个触发器" **全部成立**。

---

### 2.3 C 组（WS1/WS4：协议与成员）

#### C9 — turn 协议（原始描述符逐字）

```powershell
node verify/raw-descriptor.mjs ../app/dist/electron-main/proto.cjs \
  RequestGrokBotRoomMemberTurnRequest DeliverGrokBotRoomMemberTurnResultRequest \
  GrokBotRoomMemberTurnRoom GrokBotRoomMemberTurnPeer GrokBotRoomMemberTurnMessage GrokBotRoomPost
```
```
@980611 RequestGrokBotRoomMemberTurnRequest|1 nonce 9|2 room #0|3 member_agent_id 9|4 peers #1*|
        5 new_messages #2*|6 is_winding_down 8|7 deadline_ms 3|8 parent_request_id 9?|9 root_parent_request_id 9?
@982885 DeliverGrokBotRoomMemberTurnResultRequest|1 room_id 9|2 nonce 9|3 member_agent_id 9|4 outcome #0|
        5 messages 9*|6 error 9|7 posts #1*
@978641 GrokBotRoomMemberTurnRoom|1 id 9|2 name 9|3 description 9
@979050 GrokBotRoomMemberTurnPeer|1 id 9|2 name 9|3 description 9
@979495 GrokBotRoomMemberTurnMessage|1 speaker_kind #0|2 speaker_name 9|3 is_self 8|4 text 9|5 reply_to #1?
@982412 GrokBotRoomPost|1 text 9|2 message_json 9
```
枚举（我自己的 dump，`verify/proto-all-WS6.txt`）：
```
13680 GrokBotRoomMemberTurnDispatch    = UNSPECIFIED=0|ACCEPTED=1|DUPLICATE=2|NOT_TEMPORAL=3|TARGET_NOT_FOUND=4|TEMPORAL_UNAVAILABLE=5
13682 GrokBotRoomMemberTurnOutcome     = UNSPECIFIED=0|SENT=1|PASS=2|SKIPPED=3|TIMEOUT=4|CANCELLED=5|ERROR=6
13683 GrokBotRoomMemberTurnResultIntake= UNSPECIFIED=0|ACCEPTED=1|UNKNOWN_NONCE=2|HOST_UNAVAILABLE=3
```
→ 01 §3.1–3.5、04 §2.1 **逐字段成立**；`NOT_TEMPORAL=3` **确实存在**（01 §3.2 的"0.63.0 才有"无法用单版本产物自证，但取值存在这一点成立）。

调用点/命中数复核（我用 WS3 同一启发式 + 严格点号调用两种口径）：

```
node verify/callsites-replica.mjs
===== RequestGrokBotRoomMemberTurn      → 三 bundle 各 desc=1，strict=0
===== deliverGrokBotRoomMemberTurnResult→ 两 bundle 各 desc=1，strict=0
===== watchGrokBotTranscripts           → coordinator call=1 desc=1    ← 客户端唯一真正接线的 transcript 通道
===== commitGrokBotTranscriptEntries    → 全 0 调用点
```
```
node verify/v-tools.mjs grep "RequestGrokBotRoomMemberTurn"   → 9（3 bundle × 3）
node verify/v-tools.mjs grep "speaker_kind" / "speakerKind"   → 各 6，合计 12
node verify/v-tools.mjs grep "is_winding_down" / "isWindingDown" → 各 3，合计 6
```
→ 01 §5.1 那张"命中数"表**逐格可复现**（9/9/9/12/12/6）。**判定：成立。**

#### C10 — 房间 RPC、会话枚举

```
@875976 CreateGrokBotRoomRequest|1 agent_id 9|2 name 9|3 description 9|4 member_agent_ids 9*|5 human_member_user_ids 5*
@876780 SetGrokBotRoomMembersRequest|1 agent_id 9|2 member_agent_ids 9*
@880651 AddGrokBotRoomPeopleRequest|1 agent_id 9|2 user_ids 5*
@942921 SendGrokBotAgentMessageRequest|1 from_agent_id 9|2 to_agent_id 9|3 message_id 9|4 text 9|5 sent_at_ms 3
13654 GrokBotAgentKind = UNSPECIFIED=0|AGENT=1|ROOM=2
13656 GrokBotAgentSessionKind = UNSPECIFIED=0|MAIN=1|SLACK_DM=2|SLACK_THREAD=3|DM=4|GROUP=5
```
→ 04 §2.1 的字段表**逐字成立**（我引用的偏移与 04 只差 1 字节，是"锚在引号还是锚在名字"的差别）；`GROUP=5` 存在、`ROOM=2` 存在。
UI 侧限制也复核通过：
```
index.eager-app @616232  const h5=6,m5=3,jS=20,ume=jS-1;
index.eager-app @624459  function wme(e,t){…return{candidates:…,maxMembers:n?m5:h5}}   （n=Pf(e)，含人类→3）
index.eager-app @624459  function bme(e,t){…if(n.length===0||n.length>=jS)return[]…}   （人类上限 20）
chunk-prompt-editor @45978  const rt="__everyone__"; … keywords:["all"], icon:{type:"everyone"}
          条件：(t.allowEveryone?.()??!0) && n.length+s.length>=2
```
→ 04 §3.2 的 3/6/20 与 §3.4 的 `__everyone__`（关键字**只有** `["all"]`）**成立**；旧文写的 `keyword ["everyone","all"]` 在 0.63.0 **不成立**。

#### C11 — "四种触发规则"到底归谁（**本次最重要的纠错之一**）

```powershell
node verify/tri-triggers.mjs
```
```
electron-main/main-app.cjs  "reaction" n=1  911833
electron-main/main-app.cjs  "mention"  n=1  911651
node-agent-coordinator/main.cjs  "reaction" n=1  595565
renderer/index.eager-app n=1  683334；local-exec-daemon  "reaction" 0
```
main-app @911800 上下文（**只有一个宿主**）：
```js
…overheard:(0,p.rpcOptional)(…),harnessMayCollect:(0,p.rpcOptional)((0,p.rpcBoolean)())}),   ← 通话记录 schema 尾部
EMt=(0,p.rpcUnion)((0,p.rpcObject)({kind:(0,p.rpcLiteral)("mention")}),
     (0,p.rpcObject)({kind:(0,p.rpcLiteral)("keyword"),keyword:(0,p.rpcString)()}),
     (0,p.rpcObject)({kind:(0,p.rpcLiteral)("message")}),
     (0,p.rpcObject)({kind:(0,p.rpcLiteral)("reaction"),emoji:…,bySelf:…})),
CMt=(0,p.rpcObject)({type:(0,p.rpcLiteral)("slack"),channel:(0,p.rpcString)(),match:EMt}),
bMt=(0,p.rpcObject)({type:(0,p.rpcLiteral)("github"),repo:…,events:…}),
IMt=(0,p.rpcObject)({type:(0,p.rpcLiteral)("origin"),repo:…,events:…})
```
UI 文案 @774587：`"Wake automations on Slack messages, mentions, and reactions."`；renderer 里**唯一**消费处 @683206：
```js
function r9(e,t){const n=s9(e,t.channel);switch(t.match.kind){
  case"mention":return e({id:"JYlvtP",…}); case"keyword":return e({id:"EK3uKs",values:{0:t.match.keyword,…}}); case"reaction":…}}
```
`harnessMayCollect` @911535 = 通话记录字段；renderer @799411 赋值处：
```js
rs=T=>{e.desktop.getCursorPrivacyModeEnabled().then(ee=>{p.current===T&&(T.harnessMayCollect=!ee)},…)}
```
→ **判定：**
- 「`mention|keyword|message|reaction` 的宿主是 **Slack 渠道自动化的 `match` 条件**」**成立**（全库 only-1 处 union 定义、唯一消费点是 `t.match.kind`）。
- 「`harnessMayCollect` 是**语音通话**的隐私采集开关」**成立**。
- 旧文 `grok-bot-groupchat-internals-research.md:158/169/425/441` 的「成员四种触发规则 / 每个成员可配不同触发条件 / 这解释了群聊不抢话」在 0.63.0 **不成立**（无任何代码把它绑到 room 成员）。
- 但**因果表述要谨慎**：WS1 §4.2 的"旧文因果解释不成立"我同意；"群聊不抢话只能由 turn 编排 + PASS 解释"是**推断**（0.63.0 客户端确实只有 turn 协议 + `PASS` 枚举），应标注为推断。

---

### 2.4 D 组（WS5：持久化）— 亲自运行脚本

**运行 WS5 的只读脚本（原样，未修改、未改动其输出目录）：**

```powershell
node .tmp-grok-bot/scripts/decode-persistence.mjs
node .tmp-grok-bot/scripts/analyze-transcripts.mjs
```
```
# files: 18, total bytes: 107930
# base32 alphabet: abcdefghijklmnopqrstuvwxyz234567 (RFC4648 lowercased, unpadded)
V      24  <DECODE-ERROR: bad base32 char "." in ".migrated-from-local-storage">
V      9321  …roster.last-roster
V      27340 …transcript.replicas.bd530ad7-…
…（17 个 V + 1 个标记 = 18）
# snapshot at 2026-10-01T02:06:16.094Z   (replicas: 7)
db2f7e9d  29294  61  1-77  …contiguous=false
bd530ad7  27340  49  1-49  …contiguous=true
d4c37f88  19246  34  1-39  …contiguous=false
ab2c2a47   9348  14  1-14  accepted=11 epochHint=568e2886-6d1a-45f6-8d01-82910c29a9ca:0
1d2a1a9f   9808  12  1-17  …contiguous=false
50ba98ed   1202   2  1-2   contiguous=true
801c18df   1230   2  1-2   contiguous=true
# TOTALS  entries total: 174   bytes total: 97468
```

**我自己的独立解码器（`verify/persist-audit.mjs`，自写 base32，不 import 队友代码）：**

```
files=18 totalBytes=107930
… entries=12/2/2/14/49/34/61
1d2a1a9f gaps=[2,6,10,13,16]  d4c37f88 gaps=[7,10,15,23,28]
db2f7e9d gaps=[4,8,12,15,18,21,24,28,31,35,39,48,54,58,64,68]   ← 16 个空洞
author=28 只在 bd530ad7；其余 6 个副本 author=0
sessionField(entries 内 sessionId/session_id)=0（全部 7 个副本）
epochHint/accepted 非 null 的只有 ab2c2a47
```
**逐项对比 WS5 §3.3 的表：61/49/34/14/12/2/2、字节数 29294/27340/19246/9348/9808/1202/1230、seq 空洞、`epochHint` 值、`acceptedSequenceHint:11`、`174` 总数 —— 全部一致。判定：成立。**
WS5 §3.3 的 kind 分布（`send-message 31/message 27/user-attachment 3` 等）也一致；汇总 `send-message=103, message=63, user-attachment=8, 合计 174`，与 02 §3.7 的数字**逐项一致**。

**数据时效性（必须写进终稿）：** 三个不同时刻的真实字节数——
| 来源 | 值 | 时刻 |
|---|---|---|
| WS5 §1.1 | 18 文件 / **100,052** B | 更早一次运行 |
| WS2 §3.7 | 18 文件 / **104,347** B | 更早一次运行 |
| WS5 §1.2 快照 | 17 文件 / **107,906** B | 01:55:35Z |
| **本次（WS6）** | 18 文件 / **107,930** B | **02:06Z** |
→ 都不是错，但**不能跨小节直接对比**（WS5 自己已声明这一点，做得对）。终稿引用时必须带时刻。

**`GrokBotService` 方法数更正：** 见 B8c / §3 更正 #4。

**其他复核：**
```
commitGrokBotTranscriptEntries → 全 0 调用点                      （05 §4.8 成立）
watchGrokBotTranscripts        → coordinator 1 调用点              （05 §4.7 成立）
coordinator xr="" @99448 / function Bt(t,e) @542097 / cursorTooOld @555294
        server-transcript-tail-retry @542779                       （05 §4.5/4.7 锚点成立）
renderer function zDe(t) @1895015 … t.registry.registerMap(MS)      （05 §4.5 锚点成立）
main-app sand_memory_dreaming:{client:!0,default:!1} @1082638       （05 §6.3 成立）
main-app client_speculative_summarization_config:…TokenUsageThresholdPercentage:70,
        tolerancePercentage:5,inflightMaxAgeMinutes:5,speculativeStreamTimeoutMinutes:5 @1183513
                                                                   （02 §4.4 的 70/5/5/5 成立）
```
补充一条 05 未写的实现细节：coordinator 还有 **`Bb(t)`**（与 `Bt` 并列）：

```js
var xr="";var pU="transcript:",mU="\0";
function Bb(t){ return t.sessionId===xr ? Zs(t.agentId) : `${pU}${t.agentId}${mU}${t.sessionId}` }
```
即"主会话 → `transcript:<agentId>`，其它会话 → `transcript:<agentId>\0<sessionId>`"。这与 05 §4.5 的结论（内存按 (agent,session)、落盘只有 agentId）方向一致，但**多了一条可引用的一手证据**，建议补进 05。

**并且我找到了 05 §4.5 缺的那条"最硬证据"**（`index-C0KKXNsc.js`，`function zDe(t)` 内部）：
```js
b = async ({agentId:S, accountSlot:w, workGeneration:j}) => {
      const C = await e.readSub({accountSlot:w, subKey:S});   // subKey 直接就是 agentId
}
// 同段：readSub n=1 / writeSub n=2 / subKey n=4
```
`readSub` 的 `subKey` 由 `agentId` 原样传入，函数签名里没有 session 参数 → **"落盘副本每 agent 一份"是代码级事实**，不再是仅凭 7 个文件名推断。建议 05 补上这一行。

---

### 2.5 E13 — 跨文档仲裁：「一份 conversation/memory」 vs 「群聊不写入成员 transcript」

**两方原文（我逐字读的）**

- **06 §5.2**（staff Colin，forum.cursor.com/t/status-beat-leaks-between-bots/170523）：
  > "Each bot has one conversation and one memory, and that single history spans both its 1:1 chat with you and every group it is a member of." / "…Group turns are tagged internally so the bot knows which room it is speaking in, but it is expected to draw on everything it knows, including its 1:1 history, and its saved memories belong to the bot, not to a chat."
- **02 §5.3**（【数据】结论）：群组 `bd530ad7` 49 条 vs 成员副本 `author` 字段 0 命中 → "群聊消息**不**写入成员工作 transcript"。

**我跑的四组独立证据**

**(1) 跨成员群文本是否出现在成员副本里 —— 决定性测试**
```powershell
node verify/e13-audit.mjs
```
```
group entries with author: 28
distinct authors in group: ["绿毛仔:db2f7e9d","前端熬夜仔:d4c37f88","优化到起飞仔:50ba98ed","偷感十足仔:801c18df"]
--- For each non-group replica: entries whose text is a group message authored by SOMEONE ELSE ---
1d2a1a9f  cross-member-group-text entries = 0
50ba98ed  cross-member-group-text entries = 0
801c18df  cross-member-group-text entries = 0
ab2c2a47  cross-member-group-text entries = 0
d4c37f88  cross-member-group-text entries = 0
db2f7e9d  cross-member-group-text entries = 0
```
43 条群文本（含人类消息，长度≥12）在 6 个非群副本里**逐条精确匹配 = 0**（唯一 1 条"命中"是发言人自己的副本，见 (3)）。同时：
```
"拼死拼活组正式成立了" / "你们好" 在 6 个非群副本里 = false；只在 bd530ad7 = true
```
→ **02/04 的核心【数据】结论成立：房间的人类消息与其他成员的群消息，确实不在成员的落盘 transcript 里。**

**(2) 成员副本里有没有"群"的痕迹 —— 有，而且只有一处**
```powershell
node verify/e13-quant.mjs
```
```
d4c37f88  target tally = {"from(无kind)":3, "to:agent":9, "none":21, "to:group":1}
   -> GROUP: seq=37 id=t2a5 kind=message role=assistant to=拼死拼活组
             "@everyone 双行标签已改到 DESKTOP-Q094PDB 的 D:\projects\SYNC-THINK…"
db2f7e9d  target tally = {"none":49, "to:agent":3, "from(无kind)":9}
inbound group entries (fromAgent.kind==="group") in member replicas = NONE
group replica entries with toAgent/fromAgent = 0 ; kinds = {message:16, send-message:28, user-attachment:5}
```
**(3) 该条 `t2a5` 就是发言人自己的组内发言，且与群副本同文**
```
group  t14s2 send-message author={d4c37f88,前端熬夜仔} seq=45  "@everyone 双行标签已改到 …"
member t2a5  message role=assistant toAgent={bd530ad7,拼死拼活组,kind:"group"} seq=37  同一文本
```
**(4) 成员副本是"一条 seq 序列"而不是"按会话分区"**（`verify/dump-replica.mjs d4c37f88`）：
```
seq= 1 message   role=user      <-绿毛仔          （对端私信进来，显示成 user 角色）
seq= 5 send-message ·                             （它与用户的 1:1 对话）
seq=19 send-message ·  seq=20 message role=assistant ->绿毛仔   （私信收发交错）
seq=36 send-message ·  ← 1:1
seq=37 message   role=assistant ->group:拼死拼活组  ← 组内发言，插在同一序列里
seq=38 message   role=assistant ->agent:绿毛仔      ← 私信
seq=39 send-message ·  ← 1:1
```
**(5) 代码侧：GROUP=5 在客户端根本没有映射**
```powershell
node verify/sessionkind2.mjs
```
```
local-exec-daemon  enumVar Qze：token occurrences = 3（定义 / protobuf 默认值 / $() refs 数组）
node-agent-coordinator enumVar KC：token occurrences = 3（同上）
唯一使用它的消息：GrokBotAgentSession{1 agent_id 9|2 session_id 9|3 kind #0|4 created_at_ms 3|…}
```
而 main-app（**唯一**消费者）@1901148：
```js
var VVe="main",HVe="slack_dm",qVe="slack_thread",jVe="dm";
function Qqt(e){switch(e){case y.GrokBotAgentSessionKind.MAIN:return VVe;
  case …SLACK_DM:return HVe; case …SLACK_THREAD:return qVe; case …DM:return jVe;
  case …UNSPECIFIED:return null; default:return null}}      ← GROUP 落到 default → null
function Gqt(e){return{agentId,sessionId,kind:Qqt(e.kind),…}}
listSessions: o => (await r().listGrokBotAgentSessions({agentId:o},n)).sessions.map(Gqt)
```
落盘 key 也不含 session（代码 + 数据双重）：
```
renderer index.eager-app @339866  const Xo="sand.client.slice.",Er="account",ZP=["transcript.replicas"],…
   function is(e,t){…`${Xo}${Er}.${Ok(t)}.${e.slice}`}   function wi(e){…`${Xo}${Er}.${Ok(e)}.`}
   stage(t){return this.port.stage({…exclude:[…, …ZP.map(n=>`${wi(t)}${n}.`)]})}   ← 前缀里没有 session 位
数据：7 个文件名后缀 = roster 的 7 个 agent id，无 `:`/`\0`；value 里无 sessionId
```
**最硬的一条代码证据**（`index-C0KKXNsc.js`，`function zDe(t)` 内部，`subKey` 直接取自 `agentId`）：
```js
b = async ({agentId:S, accountSlot:w, workGeneration:j}) => {
      const C = await e.readSub({accountSlot:w, subKey:S});   // ← subKey === agentId，函数签名里根本没有 session
      …
}
// 同段内 readSub n=1 / writeSub n=2 / subKey n=4
```
→ **落盘副本"每 agent 一份、键里没有 session"是代码级事实**（不只是"数据看起来像"），这与 05 §4.5 的结论一致，也与 05 §4.5 引的 coordinator 内存键 `Bt(agentId, sessionId)`（内存里分 session、落盘不分）形成完整闭环。

**判定（我的独立结论）：**

> **两者不矛盾；主因是 (b) 层次不同，(a) 版本差异不是主因，(c) 单方出错不成立。但 02 §5.3 的绝对措辞必须降级。**

理由链：
1. **06 的那句话说的是"模型侧看到的那个 conversation/history"**（服务端 agent runtime 的 working set）。而 **02 的【数据】说的是"客户端落盘的 transcript 分区"**。0.63.0 桌面产物里**根本没有上下文组装代码**（`RequestContext*`/`memory_shards` 在 daemon 里只有类型定义，见 02 §1.3 —— 我复核 `scope_key` 仅 3 处、`memory_shards` 仅 3 处，全是描述符），所以**"模型侧一份历史"这件事在本产物里无法判定**。
2. **06 自己引用的话已经区分了这两层**：同一个 06 §4 落差 3 里，staff deanrie 说"when you use a new group chat with the same Bot, **the old 1:1 transcript isn't pulled into the working set**"——**"history/memory 属于 bot"** 与 **"working set 按会话"** 是两句并存的官方说法，本来就要求分层阅读。06 把这两句放在同一节但**没有点明这个分层**，是终稿需要补的关键一句。
3. **数据其实部分支持 staff 的"一份历史"**，而不是反驳它：成员 `d4c37f88` 的落盘副本是**一条 seq 序列**（1..39），同时含 ①它与用户的 1:1 `send-message`、②与同僚的私信 `fromAgent`/`toAgent`、③**它自己发往群的 `toAgent:{kind:"group"}` 条目（seq=37）**。且 staff 那句"**Group turns are tagged internally so the bot knows which room it is speaking in**"在数据里有**逐字对应物**：`toAgent.kind = "group"` + `name:"拼死拼活组"`。
4. **02 §5.3 说错的部分**：它写"**群聊发言不写入发言者自己的工作 transcript** → ✅ 仍然成立"，但它的证据只查了 `db2f7e9d`（绿毛仔，恰好 0 条组内发言）。`d4c37f88`（前端熬夜仔）有 **1 条**反例 `t2a5`。正确表述应为：
   > **其他成员的群聊消息（以及房间内的人类消息）不写入本成员的落盘 transcript（43 条群文本 × 6 个成员副本 = 0 命中）；但本成员自己发往群的消息会以 `toAgent:{kind:"group",name:<房间名>}` 留在自己的副本里（实测 1 条）。**
5. **另一个必须写清的事实**：房间是**独立 agent 实体**（`isGroup:true`、自己的 uuid、自己的 `/home/box/sand-data/agents/<roomId>/store.db`、自己的 49 条 transcript）。因此"each bot has one conversation"若按字面读，与"群有自己的一份 transcript"冲突；**只有按"模型侧 history vs 客户端落盘分区"分层读才自洽**。
6. **GROUP=5 的实际使用位置**：只有 `GrokBotAgentSession.kind` 的类型槽位，**没有任何代码把房间消息写进 GROUP session**；桌面端唯一的 kind 消费者 `Qqt()` 连 GROUP 分支都没有（→ `null`）。所以"成员会不会有一个 GROUP session"在本产物里**无法判定**（更可能是服务端行为，客户端不表达）。

---

### 2.6 E14 — 01~06 每份抽查（≥5 条最重结论）

#### 2.6.1 文档 01（WS1：通信与群聊）— 抽查 7 条

| # | 结论 | 判定 | 我的证据 |
|---|---|---|---|
| 1 | §3.1 `RequestGrokBotRoomMemberTurnRequest` 9 字段 | **成立** | 原始描述符 @980611（§2.3） |
| 2 | §3.2 `Dispatch.NOT_TEMPORAL=3` 存在 | **成立** | 枚举 @13680 行 |
| 3 | §3.4 `Deliver…Request` 7 字段 + `messages 9*` / `posts #1*` | **成立** | 原始描述符 @982885 |
| 4 | §5.1 命中数表（9/9/9/12/12/6） | **成立** | `v-tools.mjs grep` 逐格复现 |
| 5 | §4.2 四种触发规则 → Slack automation `match` | **成立** | `"reaction"` 全库 1 处；唯一消费点 `t.match.kind` |
| 6 | §4.3 `harnessMayCollect` = 通话隐私开关 | **成立** | @911535 通话 schema；renderer @799411 赋值 |
| 7 | §4.4 `targeted.answerAt/forUser` 只读不构造 | **成立**（抽样） | `chunk-group-chat-connect-waiting-BHr16qfO.js` 全文 2 行，只有解构函数 |
| — | §5.1 "全量 **513** 个文件" | **分母修正** | 实测 567 个文件（511 `.js`+`.cjs`） |

#### 2.6.2 文档 02（WS2：上下文与记忆）— 抽查 8 条

| # | 结论 | 判定 | 我的证据 |
|---|---|---|---|
| 1 | §1.3 `update_state` 只出现在渲染端模板提示语 | **成立** | 5 处全在 index.eager-app |
| 2 | §3.3 全部记忆 RPC 字段 | **成立** | 原始描述符 + refs 解析 |
| 3 | §4.4 `chunk-compact` = emojibase，不是 `/compact` | **成立** | 文件头 + 关键字 0 命中 |
| 4 | §5.2 `SessionKind` 更正（旧 DM=2 → 新 SLACK_DM=2/GROUP=5） | **成立** | 旧文 `grok-bot-context-sharing-research.md:27-34` 原文对照 |
| 5 | §5.3 群组 49 条 / 成员 author 0 命中 / 成员 61 条等 | **成立** | 我自己解码（§2.4） |
| 6 | §5.3 "**群聊发言不写入发言者自己的工作 transcript**" | **部分不成立 → 降级** | `d4c37f88` `t2a5` 反例（§2.5） |
| 7 | §6 `context-folder-*.webp` 0 引用、无 `ContextFolder` 类型 | **成立** | 字节级 refscan 0；2048 类型里无 |
| 8 | §4.1 七个 `@anysphere/*` 工作区包在 dist 中 0 命中 | **成立** | 七个具名包（`agent-summarization`、`@anysphere/context`、`context-rpc`、`agent-kv`、`agent-store-sync`、`@anysphere/grok-bot`、`grok-bot-harness`）只在 `app/package.json`；`agent-transcript` 仅 daemon 3 处沙箱目录名。对照组：`@anysphere/dune`、`@anysphere/ui`、`@anysphere/local-exec`、`@anysphere/agent-exec` **确实**被打进 dist → "只打包被引用部分"的推断成立 |
| — | §3.6 "`scope_key` 在整个 app/dist 中只出现 1 次" | **数字修正** | 实测 3 次（proto.cjs/daemon/coordinator 各 1，均为同一描述符）；不影响"无字面量取值"的结论 |
| — | §4.2 PreCompact 的归属 | **过度归因** | §2.1/A4 |

#### 2.6.3 文档 03（WS3：自进化）— 抽查 7 条

| # | 结论 | 判定 | 我的证据 |
|---|---|---|---|
| 1 | §1.2 `GrokBotAgentDefinition` 9 字段 + 各子类型 | **成立** | 原始描述符 + refs 全部解析成功（sessions→Session、routines→**GrokBotAgentAutomation**、recipe_skills→DefinitionSkill、mcp_settings→GrokBotUserMcpSettings…） |
| 2 | §1.5 `publishSkill` 真实签名无 `agentId` | **成立** | coordinator `publishSkill:A().args({workflowId:d(),teamId:ne()})`@604439；main-app `publishSkill:w().args({workflowId:rpcString(),teamId:rpcNumber()})`@926261 |
| 3 | §2.2 十类叶子触发器 + `group` 组合器 + "至少两个" | **成立** | @913979/914272 逐字 |
| 4 | §2.3 「50 routines / 20 条运行记录」代码里核实不了 | **成立** | 关键词 0 命中；proto 无 run-history 类型 |
| 5 | §3.2 不存在 `UpdateGrokBotAgentDefinition` 等 | **成立**（补 2 条，见 B5） | 全库 0 命中 |
| 6 | §3.3 三工具 + `agent-rename/refused` 偏移 | **成立（逐字节）** | 614499/614517/614954/615906 |
| 7 | §3.1 调用点表 `promoteGrokBotMemoriesToTeam` = "2 调用点" | **口径修正** | 严格 `.name(` = **1**；第 2 处是 IPC 路由注册。结论（只在 main-app）不变 |
| — | §3.2 "GrokBotService 共 249 个 RPC / 406 全解析" | **成立（精确）** | 花括号配平 249（244+5）；全服务 406 |

#### 2.6.4 文档 04（WS4：动态成员）— 抽查 7 条

| # | 结论 | 判定 | 我的证据 |
|---|---|---|---|
| 1 | §2.1 房间三件套 / turn 三件套字段表 | **成立** | 原始描述符（偏移差 ≤1B） |
| 2 | §2.1 `NOT_TEMPORAL` / `SessionKind.GROUP` / `AgentKind.ROOM` | **成立** | 枚举行 13654/13656/13680 |
| 3 | §3.2 成员上限 3（含人类）/ 6（无人）/ 人类 20 | **成立** | `h5=6,m5=3,jS=20`@616232；`wme()`@624459 |
| 4 | §3.4 `__everyone__`、关键字 `["all"]`、`allowEveryone!==false` 且 ≥2 人 | **成立** | `rt="__everyone__"`@45978 + `keywords:["all"]` |
| 5 | §9 群副本 49 条 / kind 16+28+5 / 成员发言 13+13+1+1 | **成立（逐项）** | 我的解码完全一致 |
| 6 | §9 成员副本不含房间人类消息（0 命中） | **成立** | "拼死拼活组正式成立了"/"你们好" 在 6 个非群副本 = false |
| 7 | §9 两个新人各 2 条 `send-message` 且同 `requestId` | **成立** | 50ba98ed: `8b707623…`×2；801c18df: `2e7214a1…`×2 |
| — | §9 "成员只存自己的 `send-message`" | **措辞修正** | 成员副本另有 12 条 `fromAgent` + 13 条 `toAgent` 的私信条目；该措辞应限定为"就**群内参与**而言" |

#### 2.6.5 文档 05（WS5：持久化与同步）— 抽查 7 条

| # | 结论 | 判定 | 我的证据 |
|---|---|---|---|
| 1 | §1.1 文件名 = base32(key)，17 值 + 1 标记 | **成立** | 原样运行其脚本 + 我的独立解码器 |
| 2 | §3.3 7 个 replica 的 entries/字节/seq 空洞/epochHint | **成立（全部数字）** | 独立复现，逐项一致 |
| 3 | §4.5 落盘 subKey 只有 agentId、value 无 sessionId | **成立** | 代码 `wi()`/`stage()` 前缀 + 7 个文件名 + `sessionField=0` |
| 4 | §4.8 桌面端只读不写（`CommitGrokBotTranscriptEntries` 0 调用点） | **成立** | `callsites-replica.mjs`：strict=0 |
| 5 | §4.7 `WatchGrokBotTranscripts` 已接线、`cursorTooOld`→强制 rehydrate | **成立** | coordinator `watchGrokBotTranscripts` 1 调用点；`cursorTooOld`@555294 |
| 6 | §6.3 `PutGrokBotMemoryShard` / `ListGrokBotMemoryShards` 不存在 | **成立** | 全库 0 命中 |
| 7 | §6.3 "GrokBotService 的 **304** 个方法" | **不成立（数字）** | 实测 **249** |
| — | §1.1 的 100,052 B / §1.2 的 107,906 B | 时效说明 | 本次 02:06Z 实测 107,930 B；三者都不是错，须带时刻引用 |

#### 2.6.6 文档 06（官方文档与公开叙事）— 抽查 5 条

> **前置限制（必须写进终稿）**：本环境**无法访问外部网络**验证 06 的来源。`web_fetch https://docs.x.ai/grok-bot/memory.md` 直接失败：
> ```
> Error: URL hostname "docs.x.ai" resolves to a non-public IP address
> ```
> `web_search` 也没有返回任何能直接佐证 docs.x.ai/grok-bot 页面清单或 forum.cursor.com 帖子的结果。因此 06 的**外部事实类结论我一律判"无法判定"**，只做"内部一致性 + 能否被产物佐证"的检查。

| # | 结论 | 判定 | 说明 |
|---|---|---|---|
| 1 | §4 落差 3 的员工原话（一份 conversation 横跨 1:1 与所有群） | **部分支持（分层后）** | 数据侧有逐字对应物：`toAgent.kind="group"` 的"群轮次内部标记"；但"模型侧一份历史"在 0.63.0 桌面产物中**无法判定**（§2.5） |
| 2 | §4 落差 5「官方文档叫 skill、公告叫 routine」 | **间接成立** | 产物侧类型级证据：`GrokBotAgentDefinition.routines[]` 的元素类型是 **`GrokBotAgentAutomation`**，UI 文案用 "Routines"（03 §2.1）→ 术语确实一词两用 |
| 3 | §4 落差 6「记忆是 Bot 电脑上的纯文本文件（profile + 每月 memory-log）」 | **间接支持** | 产物内 `memory/profile.md`、`memory/log` **0 命中**（在远端 box，符合预期）；但 proto 形状与之吻合：`GrokBotMemoryFolder{1 profile, 2 logs}` + 写入指令 `target "memory" tier "log"`（§2.1 A 组附加） |
| 4 | §4 落差 2「没有 in-place compact；接近上限才自动摘要」 | **一致（非证明）** | `PreCompact` 只在本地 agent 运行时出现、renderer 无任何 compact 原语（`/compact`/`autoCompact` 0 命中）；与"客户端没有 compact 能力"一致，但服务端策略不可证 |
| 5 | §1.1「21 个官方文档页面」/ §6.1「`memory.md` 404」等 URL 与状态码 | **无法判定** | 网络受限（上述报错）；不附和也不否定 |

---

## 3. 被推翻 / 降级的结论清单（点名到节，并给正确表述）

> 排序：先"必须改"（会误导读者），再"建议改"（精度问题）。

**#1 【必须改】`02-context-and-memory.md` §5.3 表格第 2 行 —— 降级为"部分成立"**
- 原文：「群聊发言**不**写入发言者自己的工作 transcript → ✅ 仍然成立；证据：绿毛仔副本 `db2f7e9d`（61 条）中 `author` 出现 0 次」。
- 事实：该证据只覆盖了一个成员。`d4c37f88`（前端熬夜仔）副本第 **37** 条（`t2a5`）就是它发往 `拼死拼活组` 的群内发言，`role:"assistant"`、`toAgent:{id:bd530ad7,name:"拼死拼活组",kind:"group"}`，与群副本 `t14s2`（author=前端熬夜仔）同文。
- **正确表述**：*「**其他成员**的群聊消息与房间内的人类消息**不**写入本成员的落盘 transcript（43 条群文本 × 6 个成员副本 = 0 命中）；但**本成员自己发往群的消息会留在自己的副本里**（实测 1 条，`toAgent.kind="group"`）。因此'群聊不写入成员 transcript'应限定为**入向内容**。」*

**#2 【必须改】`02-context-and-memory.md` §4.2 标题与结论 —— 归属降级**
- 原文：「**真正的压缩机制：`PreCompact` hook + `ConversationSummary`**」「hook 挂载点（0.63.0 完整 hook 事件表）」。
- 事实：`PreCompact` 及整张 hook 表**只存在于 `local-exec-daemon/main.cjs`**（4 处），同表事件是 `beforeShellExecution`/`afterFileEdit`/`beforeTabFileRead`/`workspaceOpen` 这类 **IDE/CLI agent** hook 名；**真正调用 `GrokBotService` 的 `main-app.cjs` 对 `PreCompact` 0 命中**。（**注意**：不能拿"daemon 没有 GrokBot 字样"当理由——daemon 内嵌了整套 GrokBot proto 描述符，`GrokBot` 出现 **922** 次、`typeName:"aiserver.v1.GrokBotService"` 1 处，但**没有任何 GrokBot 调用点**。）
- **正确表述**：*「0.63.0 的本地 agent 运行时（local-exec-daemon）定义了 `PreCompactRequestQuery{…context_usage_percent…messages_to_compact…}` 这一压缩前 hook 协议；**它是否作用于 Grok Bot 的会话未被证实**（该 bundle 无任何 Grok Bot 代码，main-app 亦无引用）。压缩/摘要的**服务端**实现不在桌面产物内。」*

**#3 【必须改】`05-memory-persistence-and-sync.md` §6.3 —— 数字 304 → 249**
- 原文：「`ws5-rpcaudit.mjs` 对 `aiserver.v1.GrokBotService` 的 **304 个方法**做全量正则过滤」。
- 事实：花括号配平计数 = **249**（244 Unary + 5 ServerStreaming，对象体 21,982 字符）；304 是"固定长度扫描窗口越界到下一个 service"的产物（我用同样的朴素扫描**也得到 304**，可复现该错误来源）。249 与 03 §3.2 一致。
- **正确表述**：*「`aiserver.v1.GrokBotService` 共 **249** 个方法（244 Unary + 5 Server-Streaming）；`proto.cjs` 全部 7 个服务合计 406 个方法。」*

**#4 【必须改】终稿若沿用题面字段名 `avatar_data_change` —— 不存在**
- 产物：`UpdateGrokBotAgentRequest|…|7 clear_avatar #0 avatar_change|8 avatar_data_url 9 avatar_change`。
- **正确表述**：*「字段 8 名为 **`avatar_data_url`**；`avatar_change` 是 **oneof 组名**（字段 7、8 共用）；`clear_avatar` 的类型是 `google.protobuf.Empty`（标记消息）。」*（03 §3.2 已经写对，终稿不要退回题面写法。）

**#5 【建议改】`02-context-and-memory.md` §3.6 —— "`scope_key` 出现 1 次" → 3 次**
- 实测：`scope_key` 在 proto.cjs / local-exec-daemon / node-agent-coordinator **各 1 次**，共 3 次，全部是同一个 `GrokBotAgentDefinitionMemoryShard` 描述符。
- 结论（"0.63.0 无字面量取值/无枚举"）**不变**，只需改数字并注明"每 bundle 1 次"。

**#6 【建议改】`03-self-evolution-and-adaptation.md` §3.1 调用点口径**
- 原文表：`promoteGrokBotMemoriesToTeam` → "main-app **2** 调用点"。
- 实测：严格点号调用 `.promoteGrokBotMemoriesToTeam(` = **1**（@1899396）；第 2 处是 IPC 路由注册 `promoteGrokBotMemoriesToTeam:({agentId,factIds})=>…`（@1972885）。两者统计口径不同，建议表头改成"调用形态命中数（含 IPC 路由注册）"，或直接给"RPC 调用点 / IPC 注册点"两列。
- 结论（daemon/coordinator 全为 0、只在 main-app）**不变**。

**#7 【建议改】`01-communication-and-groupchat.md` §5.1 —— "全量 513 个文件" → 567**
- 实测：`app/` 下 567 个文件；`.js` 467 + `.cjs` 44 = 511；另有 1 `.mjs`。命中数表格本身**完全正确**，只是分母写错。

**#8 【建议改】`04-dynamic-membership.md` §9 —— "成员只存自己的 `send-message`"**
- 实测：成员副本除 `send-message` 外还有 12 条 `fromAgent`（对端私信进入，`role:"user"`）与 13 条 `toAgent`（自己发出的私信，`role:"assistant"`），另有 1 条 `toAgent.kind="group"`。
- **正确表述**：*「就**群内参与**而言，成员的落盘副本只有它自己发往群的消息（1 条）；房间的人类消息与其他成员的群消息均不落在成员副本里。成员副本另有 bot↔bot 私信条目（`fromAgent`/`toAgent`）。」*

**#9 【建议改】`02` §4.4 与 `05` §1.1/§1.2 —— 大文件与内存数字的口径/时效**
- `chunk-compact-C8-lyxgK.js`：**571,490 字节**（磁盘）vs **546,185 字符**（UTF-8 解码后）；同一文件两个数字并存容易被误读为矛盾，建议标注单位。
- 持久化目录总字节：**100,052**（WS5 早先）/ **104,347**（WS2 早先）/ **107,906**（WS5 01:55Z）/ **107,930**（WS6 02:06Z）——建议终稿统一成"快照时刻 → 值"的形式。

**#10 【建议改】旧文档（不改文件，但终稿引用时需注明已被推翻）**
- `grok-bot-groupchat-internals-research.md:158/169/425/441`：「成员的四种触发规则（mention/keyword/message/reaction）/ 每个成员可以配不同的触发条件 / 这解释了群聊里 bot 不会全部抢答」——**0.63.0 不成立**（该 union 是 Slack automation 的 `match`，`harnessMayCollect` 是通话隐私位）。
- `grok-bot-context-sharing-research.md:27-34`：`DM=2 / SLACK_DM=3 / SLACK_THREAD=4`、「枚举里没有 ROOM/GROUP」——**0.63.0 已过时**（`SLACK_DM=2 / SLACK_THREAD=3 / DM=4 / GROUP=5`；`GrokBotAgentKind` 有 `ROOM=2`）。
- `grok-bot-context-sharing-research.md:198`：`ListGrokBotMemoryShards` / `PutGrokBotMemoryShard`——**0.63.0 不存在**。
- `grok-bot-context-sharing-research.md:191`：`folder{profile}`——**0.63.0 已扩为 `{profile, logs[]}`**（新增点，建议终稿显式列出）。

---

## 4. 无法判定清单（+ 原因）

| # | 事项 | 为什么无法判定 |
|---|---|---|
| 1 | 模型侧 prompt 的真实组装顺序（系统提示→记忆→技能→工具→历史） | 组装在服务端；桌面产物里 `RequestContext*`/`memory_shards`/`recipe_skills` 只有类型定义，无读取/拼接代码。02 §1 的分层表是**合理推断**，应保持【推断】标注 |
| 2 | 「一个 bot 只有一份 conversation，横跨 1:1 与所有群」 | 同理，服务端行为；本地只能证明"落盘副本按 agent 一份"，不能证明模型侧会话边界（§2.5） |
| 3 | 成员 agent 是否存在 `GrokBotAgentSession.kind=GROUP` 的会话 | 该枚举在桌面端唯一消费者 `Qqt()` **没有 GROUP 分支**（→`null`）；daemon/coordinator 的枚举变量只有 3 次引用（定义/默认值/refs）。**客户端不表达**，故不可判定 |
| 4 | `PreCompact` 是否作用于 Grok Bot | 仅在 `local-exec-daemon`（本地 agent 运行时）中定义；`main-app`/`preload`/`renderer`/`proto.cjs` 全 0 命中；且 daemon 里没有任何 GrokBot 调用点、Grok Bot agent 的 harness 是云端 `temporal`。**无正面证据，也无反面证据** |
| 5 | `MAX_BOT_SKILLS` 的数值、"每 bot 50 routines / 20 条运行记录" | 前者是 i18n 插值占位符；后者 0 命中且无 run-history 类型。两者都可能是服务端限制 |
| 6 | `memory_shards[].scope` / `scope_key` 的取值集合 | 全库无枚举、无字面量写入点（我复核：`scope_key` 共 3 处描述符） |
| 7 | box 侧 `store.db` 的实际内容、记忆文件（`memory/profile.md` 等） | 在云端 box，本机不可读；产物内 0 命中该路径 |
| 8 | 06 的全部外部来源（docs.x.ai 页面清单与状态码、forum.cursor.com 帖子原文、媒体报道） | 本环境网络受限：`web_fetch docs.x.ai` → `resolves to a non-public IP address`；`web_search` 无直接佐证结果。**不附和、不否定** |
| 9 | 「每轮把完整 transcript 重发给模型」是否在 0.63.0 仍成立 | 属服务端行为；本机只能证明客户端没有 compact 原语（`/compact`、`autoCompact`、`compactContext` 全 0 命中） |
| 10 | `ConversationSummary.strategy` / `PreCompactRequestQuery.trigger` 的取值集合 | 类型是 string，无枚举、无字面量 |

---

## 5. 对最终报告的三条建议

**建议 1：把"客户端可观测事实"与"模型侧推断"在版式上强制分开，别让读者把前者读成后者。**
具体做法：终稿每个涉及"上下文/记忆/一份历史"的结论，都加一个前缀标签之一 —— `【客户端落盘实测】`/`【桌面产物代码】`/`【服务端行为·推断】`。至少要给这三条加上：
① 「一个 bot 一份 conversation 横跨 1:1 与所有群」→ `【服务端行为·推断，0.63.0 桌面产物不可判定】`；
② 02 §1 的上下文组装顺序表 → 整表标 `【推断】`（02 现在只在个别行标了）；
③ 「群聊是上下文边界 / 不是上下文边界」→ 明确写"就**客户端落盘分区**而言不是共享通道；就**模型侧**而言不可判定"。
这一条直接决定 E13 那个矛盾在读者眼里是"矛盾"还是"分层"，是本次调研最容易翻车的地方。

**建议 2：所有"命中数/偏移/文件数"统一口径并给出可复现命令，同时删掉三处会打架的数字。**
- 分母统一：`app/` 共 **567** 文件（`.js` 467 + `.cjs` 44 = **511**）；凡引"511 个 JS/CJS"就写"511 个 JS/CJS（全量 567 文件）"。
- 把方法数类数字统一为实测值：`GrokBotService = 249`、全服务 `= 406`；删掉 304。
- 大文件统一"字节（磁盘）/字符（解码后）"双写，至少对 `chunk-compact-C8-lyxgK.js`（571,490 B / 546,185 字符）。
- 本机数据统一"快照时刻 → 值"：`01:55:35Z → 17 文件/107,906 B`、`02:06Z → 18 文件/107,930 B`、`174 entries / 7 replicas`。

**建议 3：把"过度归因"的三条从结论区移到明确的"已排除假设"区，并把一条真实的版本增量提上来。**
- 移出结论（降级为"已在 0.63.0 排除的假设"）：① 群成员四种触发规则 → 实为 Slack automation `match`；② `harnessMayCollect` → 实为通话隐私位；③ `PreCompact` → 实为本地 agent 运行时 hook，未证实作用于 Grok Bot。
- 提上来（这是三份 v0.47.0 文档都没有、且我这次实测确认的**真实版本增量**）：**`GrokBotMemoryFolder` 在 0.63.0 从 `{profile}` 扩成 `{profile, logs[]}`**（旧文 `grok-bot-context-sharing-research.md:191` 只有 `profile`），并与运行时指令 `update_state target "memory" action "write" tier "log"` 严格对应 —— 记忆从"单份画像"变成"画像 + 追加式流水"，这是 0.63.0 记忆架构最实打实的一处变化，比"新增 `GROUP=5` 枚举"更值得放在摘要里（`GROUP=5` 在客户端**连映射都没有**，实际影响力要弱得多）。

---

## 附：本报告用到的全部可复现命令

```powershell
# 0) 独立重生成 proto 参考（避免 UTF-16LE 与 grep 工具的坑）
node .tmp-grok-bot/scripts/proto-extract.mjs .tmp-grok-bot/app/dist/electron-main/proto.cjs   # → verify/proto-all-WS6.txt (UTF-8)

# A 组
node .tmp-grok-bot/verify/v-tools.mjs exact  .tmp-grok-bot/app/dist/electron-main/main-app.cjs ".promoteGrokBotMemoriesToTeam("
node .tmp-grok-bot/verify/v-tools.mjs grep   "GetGrokBotTeamContextSummary"
node .tmp-grok-bot/verify/v-tools.mjs refscan "context-folder-B7_jGHrF"
node .tmp-grok-bot/verify/v-tools.mjs grep   "PreCompact"
node .tmp-grok-bot/verify/v-tools.mjs grep   "PreCompact" "electron-main"        # 0
node .tmp-grok-bot/verify/v-tools.mjs grep   "GrokBot"   "local-exec-daemon"    # 922（描述符）
node .tmp-grok-bot/verify/daemon-grokbot.mjs                                        # 无 GrokBotService 客户端实例化
node .tmp-grok-bot/verify/raw-descriptor.mjs .tmp-grok-bot/app/dist/electron-main/proto.cjs ListGrokBotUserBotMemoriesResponse
node .tmp-grok-bot/verify/refsem.mjs         .tmp-grok-bot/app/dist/electron-main/proto.cjs ListGrokBotUserBotMemoriesResponse

# B 组
node .tmp-grok-bot/verify/v-tools.mjs grep "UpdateGrokBotAgentDefinition"
node .tmp-grok-bot/verify/v-tools.mjs grep "MAX_BOT_SKILLS"
node .tmp-grok-bot/verify/rpccount.mjs
node .tmp-grok-bot/verify/callsites-replica.mjs
node .tmp-grok-bot/verify/triggers.mjs
node .tmp-grok-bot/verify/ws3-check.mjs

# C 组
node .tmp-grok-bot/verify/raw-descriptor.mjs .tmp-grok-bot/app/dist/electron-main/proto.cjs RequestGrokBotRoomMemberTurnRequest DeliverGrokBotRoomMemberTurnResultRequest
node .tmp-grok-bot/verify/pq.mjs verify/proto-all-WS6.txt find "^GrokBotRoomMemberTurn"
node .tmp-grok-bot/verify/tri-triggers.mjs
node .tmp-grok-bot/verify/sessionkind2.mjs

# D 组（先跑队友只读脚本，再跑我自己的独立实现）
node .tmp-grok-bot/scripts/decode-persistence.mjs
node .tmp-grok-bot/scripts/analyze-transcripts.mjs
node .tmp-grok-bot/verify/persist-audit.mjs
node .tmp-grok-bot/verify/ws5-anchors.mjs
node .tmp-grok-bot/verify/dump-replica.mjs d4c37f88

# E13 / E14
node .tmp-grok-bot/verify/e13-audit.mjs
node .tmp-grok-bot/verify/e13-quant.mjs
node .tmp-grok-bot/verify/ws4-data-check.mjs
node .tmp-grok-bot/verify/slicekey.mjs
node .tmp-grok-bot/verify/ws3-check.mjs
node .tmp-grok-bot/verify/last-checks.mjs
```
