# 会话轨道协作边界

## 目标

把 SYNC-THINK 的协作行为固定为三种可解释的轨道：

| 轨道 | 动态子 Agent | 普通任务 | Team 成员 |
| --- | --- | --- | --- |
| 模型对话 | 可用，受调度设置限制 | 可用 | 不自动进入 Team |
| Agent 对话 | 不可用 | 可通过设置开启，写入普通任务清单 | 不可用 |
| Team 对话 | 不可用 | 不作为动态委派 | 只使用启动时冻结的 roster |

## 调度设置

设置存储在 `app_setting` 的 `collaboration.orchestration` 键中。默认值为最大嵌套深度 2、每个父 Agent 最多 4 个子 Agent、每轮最多自动委派 3 次、每任务 Token 预算无限制；Agent 普通任务派发和 Agent 间消息默认关闭。

## 调用时机

动态子 Agent 只在模型对话中出现，并且只有模型判断任务适合拆分、当前层级和数量配额仍可用时才调用。单 Agent 对话不创建子 Run；需要拆分时创建普通持久任务。Team 启动时冻结成员名单与依赖，成员执行期间不查询外部 Agent，也不继续创建子 Agent。

## 既有 Agent 与临时 Agent

后续动态委派器先读取 Agent Catalog 的摘要候选，用能力标签、Skill、工具、输入类型、工作区范围和角色人设做匹配。匹配成功时直接引用该 Agent，并在委派瞬间解析一份绑定副本（全局 Agent 是可变定义，副本记录当时的模型、Skill 与工具）；没有合适候选时只在当前 Run 创建临时配置，用户明确保存后才进入 Agent Library。

## 前端表现

模型对话展示子 Agent 卡片、头像、状态和工具执行记录；Agent 对话展示普通任务卡；Team 对话展示冻结成员和 DAG 进度。工具执行记录直接列出命令、网页搜索与 MCP 调用，超过 20 行后收起剩余部分，并提供“展开全部 N 项工具调用”入口。已有 Agent 使用自己的头像，临时 Agent 显示基础头像并带临时标记。

当前基础实现已经接通 `agent_delegate` 的独立 child Run、已有/临时 Agent 选择和配额拒绝，并把结果回填父工具调用；子 Run 内部的命令、网页搜索和 MCP 事件已经投影到独立子 Agent 卡片，卡片显示运行中、已完成、失败和已取消状态。
## 子 Agent 工具执行与事件投影

模型对话调用 `agent_delegate` 后，Runtime 会创建独立 child Run，并复用现有 Provider 工具循环。子 Run 默认只暴露 `read_file`、`list_files`、`search_files`、`git_status`、`git_diff`、`web_search` 和 `web_fetch`；绑定 MCP 时，仅名称被识别为读取、查询、搜索、获取、描述或状态类的工具进入子 Run。工具目录和执行入口都会再次校验，写文件、执行命令、Agent/Skill/Team 管理和继续委派都会被拦截。

child Run 的工具时间线会投影到父 `agent_delegate` 结果的 `toolEvents` 字段，包含工具名、参数、状态、输出和时间边界。桌面端在“执行过程”顶部显示 Agent 卡片：已有 Agent 使用已有身份，临时 Agent 使用临时标识；卡片可展开查看每个工具调用，输出预览统一以 20 行为折叠标准。

这条链路只在当前模型对话中生效，Agent 和 Team 轨道仍遵守各自的协作边界。子 Agent 当前不继续创建下一级子 Agent，因此最大嵌套深度设置仍由父模型轨道的委派准入逻辑保留，后续若开放嵌套需要单独增加子 Run 的事件关联和预算继承规则。
