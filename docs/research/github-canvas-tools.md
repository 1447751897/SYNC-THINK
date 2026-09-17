# GitHub 开源画布工具调研

> 调研日期：2026-09-10  
> 范围：适合嵌入 Web / Electron 桌面应用的开源画布、白板和节点编辑器。数据仅取自项目 GitHub 仓库、官方文档、LICENSE 与官方 npm 页面。Stars 为调研时快照，会随时间变化。

## 结论摘要

1. **SYNC-THINK 当前应继续以 Excalidraw 作为通用白板，不建议替换。** 项目已经固定使用 `@excalidraw/excalidraw@0.18.1`，并完成独立 vendor bundle、场景文件同步、防抖序列化以及 PNG/SVG 导出；继续补齐适配层、资源文件和协作能力，成本最低、迁移风险最小。
2. **若要增加 Agent 流程、思维链路、工作流 DAG 等节点编辑能力，首选 React Flow / xyflow。** 它与现有 React 技术栈匹配，节点/边模型、保存恢复与协作示例完整，且 MIT 许可清晰。
3. **不建议当前直接采用 tldraw。** 产品能力很强、维护活跃，但仓库使用自定义许可证，生产使用存在商业许可约束；在已有 Excalidraw 的情况下，收益不足以覆盖许可和迁移成本。
4. **Fabric.js、Konva、PixiJS 都不是开箱即用白板。** Fabric.js / Konva 适合高度定制的图片标注、排版或设计器；PixiJS 适合超大规模、高帧率 2D 渲染。采用它们意味着自行建设选择、变换、历史记录、序列化、快捷键和协作语义。
5. **draw.io 与 AntV X6 是有价值的补充候选。** draw.io 适合以 iframe 隔离接入完整图表编辑器；X6 可作为 React Flow 的节点引擎备选，但不应在首期同时维护两套节点编辑器。

## 快照对比

| 项目 | GitHub stars | 许可证 | 调研时最新版本 | 定位 | 对 SYNC-THINK 的建议 |
|---|---:|---|---|---|---|
| [Excalidraw](https://github.com/excalidraw/excalidraw) | 131,533 | [MIT](https://github.com/excalidraw/excalidraw/blob/master/LICENSE) | [`0.18.1`](https://www.npmjs.com/package/@excalidraw/excalidraw/v/0.18.1)，2026-04-21 | 手绘风白板 | **保留并完善，作为默认白板** |
| [tldraw](https://github.com/tldraw/tldraw) | 50,232 | [自定义 tldraw License](https://github.com/tldraw/tldraw/blob/main/LICENSE.md) | [`5.4.1`](https://www.npmjs.com/package/tldraw/v/5.4.1)，2026-09-08 | 完整白板 SDK | 暂不采用；先解决商业许可问题 |
| [React Flow / xyflow](https://github.com/xyflow/xyflow) | 38,318 | [MIT](https://github.com/xyflow/xyflow/blob/main/LICENSE) | [`12.11.6`](https://www.npmjs.com/package/@xyflow/react/v/12.11.6)，2026-09-01 | React 节点/流程编辑器 | **新增工作流画布首选** |
| [Fabric.js](https://github.com/fabricjs/fabric.js) | 31,434 | [MIT](https://github.com/fabricjs/fabric.js/blob/master/LICENSE) | [`7.4.0`](https://www.npmjs.com/package/fabric/v/7.4.0)，2026-05-18 | Canvas 对象模型 | 仅在需要定制设计器/标注器时采用 |
| [Konva](https://github.com/konvajs/konva) | 14,778 | [MIT](https://github.com/konvajs/konva/blob/master/LICENSE) | [`10.5.0`](https://www.npmjs.com/package/konva/v/10.5.0)，2026-09-08 | 2D Canvas 场景图 | 仅在轻量、高定制交互画布中采用 |
| [PixiJS](https://github.com/pixijs/pixijs) | 48,141 | [MIT](https://github.com/pixijs/pixijs/blob/dev/LICENSE) | [`8.20.1`](https://www.npmjs.com/package/pixi.js/v/8.20.1)，2026-08-26 | WebGL/WebGPU 2D 渲染器 | 只用于性能驱动的专用渲染场景 |
| [draw.io](https://github.com/jgraph/drawio) | 8,031 | [Apache-2.0；部分图标资产例外](https://github.com/jgraph/drawio/blob/dev/LICENSE) | [`31.4.5`](https://github.com/jgraph/drawio/releases/tag/v31.4.5)，2026-09-08 | 完整流程图/架构图编辑器 | 复杂图表需求可 iframe 隔离接入 |
| [AntV X6](https://github.com/antvis/X6) | 6,698 | [MIT](https://github.com/antvis/X6/blob/master/LICENSE) | [`3.1.8`](https://www.npmjs.com/package/@antv/x6/v/3.1.8) | 图编辑引擎 | React Flow 的备选，不同时引入 |

Stars 数值来自各仓库的官方 GitHub 页面/API 快照：[Excalidraw](https://api.github.com/repos/excalidraw/excalidraw)、[tldraw](https://api.github.com/repos/tldraw/tldraw)、[xyflow](https://api.github.com/repos/xyflow/xyflow)、[Fabric.js](https://api.github.com/repos/fabricjs/fabric.js)、[Konva](https://api.github.com/repos/konvajs/konva)、[PixiJS](https://api.github.com/repos/pixijs/pixijs)、[draw.io](https://api.github.com/repos/jgraph/drawio)、[AntV X6](https://api.github.com/repos/antvis/X6)。

## 逐项分析

### 1. Excalidraw

- **主要能力**：无限画布、自由绘制、基础图形、箭头、文本、图片、库元素以及场景导入导出；官方提供可嵌入的 React 组件和导出 API。来源：[仓库 README](https://github.com/excalidraw/excalidraw)、[组件文档](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation)。
- **框架依赖与嵌入**：以 `@excalidraw/excalidraw` React 组件嵌入，安装文档列出 React / React DOM peer dependencies；适合现有 React renderer，也适合在 Electron renderer 中懒加载。[官方安装文档](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation)
- **持久化与协作**：组件通过 `initialData`、`onChange` 和 imperative API 交由宿主保存场景；Excalidraw 官方应用具备端到端加密协作，但 npm 组件不会替宿主管理业务存储和协作后端。[官方 API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/)、[官方协作说明](https://github.com/excalidraw/excalidraw#collaboration)
- **维护活跃度**：仓库 131,533 stars；npm `0.18.1` 于 2026-04-21 发布，社区体量和发布节奏均足以支撑长期嵌入。[npm](https://www.npmjs.com/package/@excalidraw/excalidraw/v/0.18.1)
- **明显风险**：组件体积较大；内部场景格式不应被当作 SYNC-THINK 通用领域模型；实时协作仍需额外服务、冲突处理和资源文件同步。

**SYNC-THINK 现状**：`apps/desktop/package.json` 已固定 `@excalidraw/excalidraw@0.18.1`；`apps/desktop/src/renderer/shell/ExcalidrawPreview.tsx` 与 `excalidraw-vendor.tsx` 已实现独立 vendor bundle、约 300ms 防抖序列化、文件场景同步和 PNG/SVG 导出。这已经越过了最主要的集成成本，因此继续增强比替换更合理。

### 2. tldraw

- **主要能力**：完整无限画布 SDK，覆盖形状工具、选择/变换、相机、历史记录、资源、多人状态以及自定义 shape / tool。[官方仓库](https://github.com/tldraw/tldraw)、[官方文档](https://tldraw.dev/)
- **框架依赖与嵌入**：官方 SDK 面向 React，通过 `tldraw` npm 包和 `<Tldraw />` 组件嵌入；扩展点比纯白板组件更深。[npm](https://www.npmjs.com/package/tldraw)、[快速开始](https://tldraw.dev/quick-start)
- **持久化与协作**：官方文档提供 store snapshot、IndexedDB / 自定义后端持久化路径，以及同步/协作方案；服务端与部署仍由接入方负责。[持久化](https://tldraw.dev/docs/persistence)、[协作](https://tldraw.dev/docs/collaboration)
- **维护活跃度**：50,232 stars；`5.4.1` 于 2026-09-08 发布，近期维护非常活跃。[npm](https://www.npmjs.com/package/tldraw/v/5.4.1)
- **明显风险**：根许可证不是 OSI 常见宽松许可证，并对生产使用设置商业条款；必须在选型前完成许可评估。它与 Excalidraw 的功能重叠也会造成双份包体、文件格式和交互维护成本。[官方 LICENSE](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)

### 3. React Flow / xyflow

- **主要能力**：节点、边、端口、缩放平移、选择、连线、分组、自定义 React 节点和大规模流程交互，定位明确为 node-based UI。[官方仓库](https://github.com/xyflow/xyflow)、[React Flow 文档](https://reactflow.dev/)
- **框架依赖与嵌入**：`@xyflow/react` 是 React 组件库，与 SYNC-THINK 的 React 18 renderer 直接匹配；宿主拥有节点 UI、业务规则和状态模型。[npm](https://www.npmjs.com/package/@xyflow/react)
- **持久化与协作**：可通过实例 `toObject()` 保存 viewport、nodes 和 edges，官方有保存/恢复示例；协作示例展示了多人状态集成，但不内置数据库或协作服务。[保存与恢复](https://reactflow.dev/examples/interaction/save-and-restore)、[协作示例](https://reactflow.dev/examples/interaction/collaborative)
- **维护活跃度**：38,318 stars；`12.11.6` 于 2026-09-01 发布，近期持续发布。[npm](https://www.npmjs.com/package/@xyflow/react/v/12.11.6)
- **明显风险**：它不是自由绘制白板；自动布局通常要组合 Dagre、ELK 等库；复杂业务节点的版本迁移、复制粘贴和 schema 兼容需由 SYNC-THINK 负责。部分高级能力和模板可能属于 React Flow Pro，应在采用前逐项确认。

### 4. Fabric.js

- **主要能力**：在 HTML Canvas 上提供可选择、可变换的对象模型，支持文本、图片、SVG、分组、序列化和事件，适合图片标注、海报/模板编辑器。[官方仓库](https://github.com/fabricjs/fabric.js)、[官方文档](https://fabricjs.com/docs/)
- **框架依赖与嵌入**：框架无关，直接创建 `Canvas` 实例；在 React 中需要自行处理实例生命周期和声明式状态之间的边界。[npm](https://www.npmjs.com/package/fabric)
- **持久化与协作**：对象树可序列化为 JSON / SVG 并恢复；不附带实时协作协议或后端。[序列化介绍](https://fabricjs.com/docs/old-docs/fabric-intro-part-3/)
- **维护活跃度**：31,434 stars；`7.4.0` 于 2026-05-18 发布。[npm](https://www.npmjs.com/package/fabric/v/7.4.0)
- **明显风险**：不是成品白板，菜单、工具系统、快捷键、历史记录、文件兼容和协作均需自建；Canvas 对象与 React 状态双向同步容易形成复杂状态源。

### 5. Konva

- **主要能力**：HTML Canvas 2D 场景图、分层、事件、拖拽、变换和动画，适合交互式图形、标注和轻量设计器。[官方仓库](https://github.com/konvajs/konva)、[官方文档](https://konvajs.org/docs/)
- **框架依赖与嵌入**：核心框架无关；React 项目可使用官方生态的 [`react-konva`](https://github.com/konvajs/react-konva) 做声明式封装。
- **持久化与协作**：Stage 可序列化，但官方文档建议复杂应用只保存应用状态后重建视图；实时协作需自行设计。[官方序列化文档](https://konvajs.org/docs/data_and_serialization/Serialize_a_Stage.html)
- **维护活跃度**：14,778 stars；`10.5.0` 于 2026-09-08 发布。[npm](https://www.npmjs.com/package/konva/v/10.5.0)
- **明显风险**：同样缺少成品编辑器能力；大量图元下仍受 Canvas 2D 和命中检测成本影响；直接持久化整个 Stage 会使格式与渲染实现强绑定。

### 6. PixiJS

- **主要能力**：面向 WebGL / WebGPU 的高性能 2D 渲染，擅长精灵、粒子、滤镜、动画和超大规模可视对象。[官方仓库](https://github.com/pixijs/pixijs)、[官方文档](https://pixijs.com/)
- **框架依赖与嵌入**：核心是框架无关的渲染引擎，以 `Application` 挂载到 DOM；不是 React 编辑器组件。[npm](https://www.npmjs.com/package/pixi.js)
- **持久化与协作**：没有编辑器级场景持久化、撤销栈或协作协议；需要宿主定义领域模型并把模型投影到 Pixi 场景。
- **维护活跃度**：48,141 stars；`8.20.1` 于 2026-08-26 发布。[npm](https://www.npmjs.com/package/pixi.js/v/8.20.1)
- **明显风险**：引入它只是获得渲染层，选择框、控制柄、文本编辑、无障碍、文件格式和多人协作都要自行实现；用于普通白板属于明显过度建设。

### 7. draw.io（补充候选）

- **主要能力**：成熟的流程图、架构图、UML 和大量图形库，是完整图表编辑器而非底层组件。[官方仓库](https://github.com/jgraph/drawio)
- **框架依赖与嵌入**：最稳妥方式是使用官方 embed mode，以 iframe 加载编辑器并通过 `postMessage` 交换 XML、导出和生命周期事件，可与主应用进程/依赖隔离。[官方嵌入文档](https://www.drawio.com/doc/faq/embed-mode)
- **持久化与协作**：宿主保存 draw.io XML；官方仓库说明当前构建本身不提供实时协作，协作需依赖外部方案。[官方仓库](https://github.com/jgraph/drawio)
- **维护活跃度**：8,031 stars；`31.4.5` 于 2026-09-08 发布。[官方 release](https://github.com/jgraph/drawio/releases/tag/v31.4.5)
- **明显风险**：iframe 通信和安全边界要严格定义；编辑体验难与 SYNC-THINK 原生 UI 深度统一；Apache-2.0 之外，仓库 LICENSE 明示部分图标资产有单独限制。[官方 LICENSE](https://github.com/jgraph/drawio/blob/dev/LICENSE)

### 8. AntV X6（补充候选）

- **主要能力**：基于 TypeScript 的图编辑引擎，覆盖节点、边、端口、路由、连接器、插件和自定义视图，适合流程图和拓扑图。[官方仓库](https://github.com/antvis/X6)、[官方文档](https://x6.antv.antgroup.com/)
- **框架依赖与嵌入**：核心不锁定 React，可在容器中实例化 Graph，并通过扩展支持 React 节点；因此比 React Flow 更底层、也更灵活。[npm](https://www.npmjs.com/package/@antv/x6)
- **持久化与协作**：支持 `toJSON()` / `fromJSON()`；不内置协作后端，协作状态、冲突和权限需自行实现。[官方序列化文档](https://x6.antv.antgroup.com/tutorial/basic/serialization)
- **维护活跃度**：6,698 stars；npm 最新 `3.1.8`。[npm](https://www.npmjs.com/package/@antv/x6/v/3.1.8)
- **明显风险**：生态体量小于 React Flow；API 更偏引擎层，React 状态整合与编辑器产品能力仍需较多工程投入。

## 面向 SYNC-THINK 的接入建议

### 推荐组合

| 业务场景 | 引擎 | 理由 |
|---|---|---|
| 通用白板、草图、图文表达 | Excalidraw | 已完成接入，MIT，文件和导出链路已存在 |
| Agent 编排、任务 DAG、节点工作流 | React Flow | React 原生、节点/边语义清晰、MIT、可独立演进 |
| 企业架构图、UML、复杂制图 | draw.io（按需） | 以 iframe 隔离引入完整编辑器，避免重造图形库 |
| 图片标注或模板设计器 | Fabric.js / Konva（二选一，按需） | 只有出现明确产品需求时再投入底层编辑能力 |

### 统一适配层

不要把任一第三方场景 JSON 直接提升为 SYNC-THINK 的通用画布模型。建议定义薄的 `CanvasAdapter` 边界，统一处理：

- `load(document, assets)`：加载引擎自己的版本化文档；
- `serialize()`：输出原生场景与 schema version；
- `export(format)`：统一 PNG / SVG / JSON 等导出能力声明；
- `setReadonly()`、`focus()`、`dispose()`：统一宿主生命周期；
- `onDirtyChange`、`onSelectionChange`：只向 shell 暴露稳定事件；
- `capabilities`：声明 `freehand`、`nodes`、`collaboration`、`exportSvg` 等能力，避免大量引擎判断散落在 UI 中。

文件层建议继续保留 `.excalidraw` 作为 Excalidraw 原生项目文件；节点工作流使用 SYNC-THINK 自有、带 `schemaVersion` 的 JSON，内部包含 React Flow 的 nodes / edges 以及业务元数据。两类文档不要强行互转。

### 分阶段落地

1. **阶段一：加固现有 Excalidraw**  
   保留当前独立 vendor bundle 和懒加载边界；补齐错误边界、资源文件持久化、场景版本迁移测试，以及连续输入/外部文件变化的冲突提示。
2. **阶段二：抽象适配器**  
   从现有 `ExcalidrawPreview` 提取宿主生命周期与文件 I/O 接口，但不重写 Excalidraw 内部数据模型；确保已有 PNG/SVG 导出与 300ms 防抖行为不回退。
3. **阶段三：以独立功能接入 React Flow**  
   为 Agent/任务编排新建单独文档类型和独立 bundle；先实现节点/边 schema、保存恢复、撤销重做和导出，再考虑自动布局与多人协作。
4. **阶段四：协作按引擎分别实现**  
   统一房间、身份、权限、连接状态和资产服务；画布操作的 CRDT/同步适配仍由各引擎 adapter 负责。不要假定 Excalidraw 场景与 React Flow 节点图能共享同一套操作协议。

## 最终建议

**现在不替换 Excalidraw。** 短期投入应放在现有接入的稳定性、资产持久化和文件冲突处理；新增“节点式 Agent 工作流”时，再以独立文档类型接入 React Flow。该组合在许可证、React/Electron 兼容性、现有投入复用和后续维护成本之间最均衡。tldraw 只有在其独特 SDK 能力成为硬需求且商业许可已落实后才值得重新评估。
