# SYNC-THINK · Be UI 工作台 Demo

这是独立的本地工作台演示。先进入仓库根目录，运行：

```powershell
python docs/superpowers/demos/sync-think-beui-workbench/server.py --port 8775
```

然后在浏览器中打开 `http://127.0.0.1:8775/`。需要 Python 3 和项目已有的 `rg`、`git` 命令。**不要使用普通 `http.server`**：它只提供静态页面，新的真实执行流程需要 `server.py` 的 API。

进入页面后输入“检查执行过程输出”，可以看到真实的工作区搜索、文件读取和 `git status` 工具事件。包含“创建”“修改”“修复”等词的任务会出现审批卡；批准后只会在此 Demo 的 `.runtime/reports/` 中生成报告。底部终端提供有限的只读命令：`pwd`、`git status --short`、`git log -1 --oneline`、`rg --files` 和限定目录的 `rg -n`。执行卡片显示实际输入、输出、开始时间、退出码和耗时，长输出可打开完整内容。新对话记录保存在当前浏览器的 localStorage；服务重启后既有执行快照仍可查看，新运行由新进程处理。

左侧标有“样例 · ”的旧对话及其他管理页面仍是交互式界面样例，其中 8 个阶段、预设命令、耗时、引用和结果是展示数据。新对话使用本地工具执行器，**不会调用所选 AI 模型、真实浏览器自动化或 SYNC-THINK runtime**；模型选项记录为目标配置，运行内容明确显示“未调用模型”。写入审批仅允许 Demo 自己的报告目录，源码保持原样。这个边界在页面中也会显示。

布局依据：仓库中的 `AbilityCenterPage.tsx`、`AgentLibrary.tsx`、`TeamLibrary.tsx`、`SettingsPage.tsx`、`ModelSettings.tsx`、`DsTabBar.tsx`、`compose-toolbar.tsx` 及用户给出的产品截图。主题借鉴 [Be UI Agents](https://beui.dev/components/agents)。执行过程参考 Cursor 公开的 Agent 工具调用及终端运行方式，采用紧凑的事件行、展开后查看调用与返回、明确的运行状态；不是从 Cursor 复制代码或记录。
