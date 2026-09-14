# Makepad 调研

## 结论

Makepad 是一个以 Rust 为核心的跨平台应用和游戏开发平台，不是单独的 UI 组件库。它把高性能 UI runtime、2D/3D GPU 渲染、可实时编辑的 UI DSL、跨平台构建工具和 Makepad Studio 组合在一起。

## 能做什么

- 使用 Rust 构建原生桌面应用，并编译到 WebAssembly/WebGL。
- 支持 macOS/Metal、Windows/DX11、Linux/OpenGL，并通过 `cargo-makepad` 管理 wasm、iOS、tvOS、Android 等非标准目标。
- 提供 widgets、文本输入、Markdown、滚动条、导航、Dock、文件树、代码编辑器、DataGrid、浏览器和媒体相关能力。
- 提供 2D/3D 渲染、glTF、地图、XR 和音视频示例。
- 仓库包含 AI Chat 示例、共享聊天 UI、AI hub，以及流式对话和语音相关模块。
- Makepad Studio 用于运行、检查和实时迭代示例与项目。

## 和 SYNC-THINK 的关系

当前 SYNC-THINK 是 Electron + React + TypeScript 的桌面应用，Makepad 则是 Rust 原生 UI/runtime 体系。它不能直接替换当前的 `message-scroller` 或 React 组件；若采用，需要把 renderer/UI 层大范围改写为 Rust/Makepad，并重新接入现有 runtime、IPC、Markdown、浏览器和文件工作流。

更适合把 Makepad 作为未来 Rust 原生版 SYNC-THINK 的技术底座，或单独用于高性能视觉界面、2D/3D 工具和跨平台新应用。若目标只是优化当前消息滚动，继续在现有 React/Electron 架构内改造更直接。

## 官方来源

- 项目主页与 README：https://github.com/makepad/makepad
- 根 Cargo workspace：https://raw.githubusercontent.com/makepad/makepad/dev/Cargo.toml
- Makepad widgets 配置：https://raw.githubusercontent.com/makepad/makepad/dev/widgets/Cargo.toml
- AI Chat 示例配置：https://raw.githubusercontent.com/makepad/makepad/dev/examples/aichat/Cargo.toml
- 共享聊天 UI 配置：https://raw.githubusercontent.com/makepad/makepad/dev/libs/chat_ui/Cargo.toml
- 构建工具配置：https://raw.githubusercontent.com/makepad/makepad/dev/tools/cargo_makepad/Cargo.toml
