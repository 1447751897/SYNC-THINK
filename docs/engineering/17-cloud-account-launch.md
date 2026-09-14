# 官网与云端账号上线方案

日期：2026-09-07。用户已确认方案 A：使用现有服务器，自托管 Node.js + Better Auth，以邮箱和密码登录，SMTP 负责验证及密码重置邮件。

本文记录已批准的方向、交付边界和验收清单。本地代码、接口及浏览器流程已通过验收；目标服务器、HTTPS 和真实邮件投递尚待实施。桌面端现有能力以代码和发布记录为准。

本地证据：`pnpm test:cloud` 共 27 项通过（开启实际首页 iframe 回归）；云端 typecheck、两包 lint 与 `pnpm build:cloud` 通过。独立浏览器流程覆盖注册、验证、登录、退出、密码重置、刷新链接和关闭注册。SMTP 使用内存邮件夹具。官网与嵌入演示在桌面/手机尺寸检查，当前本地预览未配置 SMTP，因此保持注册关闭。

## 1. 目标与产品边界

首期将官网、下载入口和云端账号连接起来。用户从官网了解 SYNC-THINK，下载 Windows 桌面端，或注册并登录自己的云端账号。登录后的账号页负责显示真实身份、验证状态和退出入口；桌面端设备配对、同步和服务器运行任务属于后续阶段。

| 表面            | 首期职责                                             | 数据归属                               |
| --------------- | ---------------------------------------------------- | -------------------------------------- |
| `apps/website/` | 介绍、产品演示、下载、文档、注册、登录及账号相关页面 | 公开静态资源；浏览器会话由账号服务管理 |
| `apps/cloud/`   | 身份验证、邮件验证、密码重置、会话和注册开放策略     | 服务器独立账号数据库                   |
| `apps/desktop/` | 本机工作区、模型配置、对话和交互                     | 当前用户本机                           |
| `apps/runtime/` | 本机任务执行、事件和检查点、工具与审批               | 当前用户本机                           |

官网不展示未经实现和验证的云任务、自动同步、团队席位、钱包或充值状态。现有 Windows `0.1.0-rc.4` 发布仍是未签名 Alpha，安装包和发布说明继续由 GitHub Releases 提供。

## 2. 已确认的技术选择

| 方案                                            | 适用目标                         | 成本与维护取舍                                                                                               | 本次决定                 |
| ----------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------ |
| A：自托管 Node.js + Better Auth + SQLite + SMTP | 自有服务器上的邮箱账号与会话     | 复用 Node.js 技术栈；自行承担邮件、数据库、HTTPS、备份和服务维护。单实例起步，增长后再评估数据库及多实例部署 | 用户已确认               |
| B：GitHub OAuth                                 | 主要面向已有 GitHub 账号的开发者 | 减少本地密码找回流程；仍需自己的账号映射、会话和后端，并依赖用户的 GitHub 账号及 OAuth 应用配置              | 暂缓，可作为后续登录方式 |
| C：Supabase Auth                                | 希望采用托管身份及数据库能力     | 提供身份服务和 PostgreSQL 集成；引入额外平台配置、托管账单及迁移边界                                         | 暂缓                     |

选择依据是已有服务器与现有 Node.js 技术经验。SQLite 账号库只承担首期独立账号服务，不复用桌面事件库，也不提前承诺多实例横向扩容。

能力核对来源：[Better Auth 邮箱与密码](https://better-auth.com/docs/authentication/email-password)、[Better Auth 数据库](https://better-auth.com/docs/concepts/database)、[GitHub OAuth 授权流程](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[Supabase Auth](https://supabase.com/docs/guides/auth)。实现细节以锁定的包版本及其集成测试为准。

## 3. 部署与数据边界

```text
浏览器
  |
  | HTTPS，同一公开域名
  v
反向代理：TLS、请求大小限制、边缘限流
  |
  +-- 官网和账号页面 --> apps/website 静态资源
  |
  +-- /api/auth/* ----> apps/cloud 账号服务 --> 独立 auth.sqlite
                             |
                             +--> SMTP 验证与重置邮件

Windows Desktop --> 本机 Runtime --> 本机 workspace / SQLite / DPAPI vault
                    首期保持本地执行
```

生产环境由一个公开 HTTPS Origin 提供页面与账号 API，降低跨域 Cookie 和重定向配置的复杂度。静态资源可以由反向代理提供，也可以使用账号服务已有的静态资源入口；以最终部署配置为准。账号服务只监听内部地址或受控网络，数据库和环境文件存放在网站静态目录之外。

独立账号库保存身份、验证和会话数据，使用独立迁移、备份及保留规则。桌面 `sync-think.db` 中的消息、任务、事件、文件和本地 Provider 凭据均不因网页登录而上传。密码、会话 Token、SMTP 密码和邮件验证链接从日志及诊断输出中排除。

### Linux 上的 Runtime 前置条件

`apps/runtime/src/persistence.ts` 的 `createRuntimeSecureStore()` 在默认配置下仅为 Windows 创建 DPAPI 后端；非 Windows 平台会在安全存储初始化时退出。`packages/secure-store/src/backends/windows-dpapi-backend.ts` 使用 Windows CurrentUser DPAPI，其密文和用户环境相关。

因此 Linux 服务器本期运行独立账号服务，桌面 Runtime 继续在 Windows 本机运行。后续云执行需要单独实现服务器密钥管理、执行隔离及平台工具适配，开发用 XOR 后端不承担生产密钥保存。将账号服务部署到 Linux 不代表完整桌面 Runtime 已通过 Linux 兼容性验收。

## 4. P0：官网与账号闭环

### 账号与页面验收

- [ ] 官网移动端和桌面端无重叠、无横向溢出；Logo、演示图片、下载和文档链接正常。
- [ ] 注册由服务器开放策略控制；关闭注册时直接调用 API 也被阻止，已注册用户仍可登录。
- [ ] 邮箱与密码注册、邮箱验证和重发验证邮件形成完整流程；未验证账号按服务器策略限制登录。
- [ ] 重复注册、错误密码及密码找回响应不泄露额外账号存在信息；输入校验与错误文案一致。
- [ ] 邮件链接使用受控公开 Origin，验证及重置 Token 有有效期，错误、过期和重复使用都经过测试。
- [ ] 登录产生服务器验证的会话；账号页读取真实身份；刷新和重启后的行为符合会话有效期。
- [ ] 生产 Cookie 的 `HttpOnly`、`Secure`、`SameSite`、作用域及过期配置通过真实 HTTPS 验证；跨站请求及非受信重定向被拒绝。
- [ ] 密码重置完成后旧密码失效，并按本期合同撤销旧会话；退出登录后原 Cookie 再次访问受保护内容失败。
- [ ] 身份读取、缺失配置、SMTP 故障和服务不可用时显示真实状态，预览模式不建立模拟登录会话。
- [ ] 公开提供运营主体、联系反馈和账号数据处理说明；账号导出、注销及保留期限具有明确处理入口和流程。

### 服务器上线验收

- [ ] 独立域名和 HTTPS 正常；公开 Origin、可信来源、代理转发及回调地址一致。
- [ ] 随机账号服务 Secret 至少满足实现要求，环境文件只对服务账户可读；Secret 不写入 Git、网页或日志。
- [ ] SMTP 服务、发件地址与域名配置完成，使用真实外部收件箱核对验证及重置邮件投递。
- [ ] 注册、登录、邮件重发和找回密码具有限流；代理身份只从受信代理读取，不能由公网请求头任意覆盖。
- [ ] 账号 SQLite 使用持久目录和专用权限，备份采用 SQLite 一致性备份或停机快照；恢复到独立目录后核对账户及会话行为。
- [ ] 生产账号库与本机开发库分离；数据库迁移前有恢复点，记录实际数据库版本和应用版本。
- [ ] 进程自启动、健康检查、请求错误及 SMTP 失败监控具备；日志有容量与保留限制。
- [ ] 注册默认关闭或按明确策略开放；公开开放前完成滥用与容量验收。
- [ ] 发布包、反向代理配置、账号库备份和回退步骤可复现；真实服务器部署结果单独记录。

服务集成的自动测试与真实服务器验收应分别记录。内存邮件夹具通过不等于 SMTP 实际投递通过，本机 HTTP 会话通过也不等于 HTTPS 代理部署通过。

## 5. P1：桌面账号、设备与有限同步

- [ ] 明确桌面登录方式：在系统浏览器登录，通过短时一次性设备配对凭据绑定当前安装；敏感长期凭据留在 Main/系统安全存储。
- [ ] 账号页与桌面端均能查看设备、最后活动时间及授权范围，支持撤销单设备；被撤销设备续期和后续云请求失败。
- [ ] 配对确认展示账号、设备与用途，限制配对码有效期和尝试次数，避免静默绑定错误账号。
- [ ] 定义首批同步对象的白名单，例如用户主动选择的 Agent/Skill 定义及界面偏好，并区分元数据与正文。
- [ ] 每个同步对象具有 owner、版本、更新时间、删除标记和幂等标识；离线编辑、并发修改及冲突保留有明确策略。
- [ ] 首次绑定、解绑、换账号和删除云副本的本地数据行为明确；同步范围由用户选择并可撤回。
- [ ] Provider API Key、SecureStore 内容、环境变量、终端历史和整个工作区不自动同步；若将来引入凭据迁移，另行设计和明确授权。
- [ ] 备份、同步和协作分别定义产品承诺，不把备份覆盖当作冲突合并。

本期官网账号登录不会提前打开桌面端尚无后端合同的云同步控件。

## 6. P2：云端执行与团队能力

- [ ] 定义组织、成员角色及服务端权限，所有任务、文件、运行记录和下载按租户及资源 owner 验证。
- [ ] 云端工作目录、网络、工具、进程和密钥按租户隔离；补齐 Linux 凭证后端及跨平台工具能力。
- [ ] 明确任务队列、重试、取消、幂等、并发控制及服务重启恢复，避免重复执行外部副作用。
- [ ] 实现租户配额与资源限制，包括运行时间、并发、CPU/内存、磁盘、附件和模型用量。
- [ ] 审计登录、配对、权限变更、工具审批、云运行、密钥引用及管理操作，并明确审计保留期限。
- [ ] 明确模型费用由谁承担、计量口径与超额策略；支付和商业化在实际结算合同形成后再上线。
- [ ] 通过多租户越权、隔离、故障恢复和资源耗尽测试后开放云执行。

## 7. 当前代码入口与配置合同

现有本地执行边界：

- [`apps/runtime/src/persistence.ts`](../../apps/runtime/src/persistence.ts)：本地持久化与默认 SecureStore 创建。
- [`packages/secure-store/src/backends/windows-dpapi-backend.ts`](../../packages/secure-store/src/backends/windows-dpapi-backend.ts)：Windows DPAPI 后端。
- [`scripts/assemble-beta-public.mjs`](../../scripts/assemble-beta-public.mjs)：现有安装包下载页装配流程。
- [`docs/operations/beta-public/BETA-TESTER-GUIDE.md`](../operations/beta-public/BETA-TESTER-GUIDE.md)：既有桌面测试范围，云账号上线后需要结合阶段更新。

本次账号服务约定入口为 `apps/cloud/src/main.ts`，具体命令以该包 `package.json` 与 `README.md` 为准。配置合同如下，最终校验行为由实现和集成测试确认：

| 变量                                                          | 用途                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| `CLOUD_ORIGIN`                                                | 网站与账号 API 的公开 Origin；生产使用 HTTPS              |
| `CLOUD_HOST` / `CLOUD_PORT`                                   | 服务监听地址和端口，开发默认 `127.0.0.1:4175`             |
| `CLOUD_AUTH_SECRET`                                           | 启用真实账号服务的随机 Secret；至少 32 字符               |
| `CLOUD_DB_PATH`                                               | 独立账号 SQLite 路径，开发默认 `.data/cloud/auth.sqlite`  |
| `CLOUD_ALLOW_SIGNUP`                                          | 是否开放注册，默认关闭                                    |
| `CLOUD_TRUST_PROXY`                                           | 是否采信受信代理身份，默认关闭；启用范围须核对服务实现    |
| `CLOUD_EMBED_ORIGINS`                                         | 允许嵌入 `/demo` 的外站 HTTPS Origin 列表；默认只允许同源 |
| `CLOUD_SMTP_HOST` / `CLOUD_SMTP_PORT` / `CLOUD_SMTP_SECURE`   | 邮件服务器与传输参数                                      |
| `CLOUD_SMTP_USER` / `CLOUD_SMTP_PASSWORD` / `CLOUD_SMTP_FROM` | 邮件凭据与发件地址                                        |

缺少账号 Secret 时仅开放网站预览，账号请求应返回明确未配置状态。邮件或注册参数不完整时应保持对应入口关闭，不用测试成功状态替代真实流程。

## 8. 交互演示与素材来源

官网通过 `<iframe src="/demo">` 嵌入完整 ChatApp 组件演示，入口为 `apps/desktop/src/renderer/shell/WebsiteChatDemo.tsx`，内存会话模型为 `website-demo-state.ts`，静态 HTML 为 `apps/website/demo.html`。不再维护旧 `demo.js` / `demo.css` 仿制界面。任务、问询、审批、代码、差异、工作台、接管与需求队列直接导入桌面组件；样式和字体使用原始 shell 资源。左侧提供 13 个演示场景，执行过程为内存模拟，不调用真实模型、Runtime、账号或命令；手动选择的图片仅保留在页面内存，不上传。文件使用原生右侧工作台（窄屏下方停靠），保留会话区、标签、文件列表及尺寸调整。输入栏复用添加、权限、技能、身份、模型/思考强度和上下文菜单，隐藏输入面板的滚动条外观但保留滚动操作。

`/demo` 单独设置 frame-ancestors；其他页面继续禁止嵌入。官网提供复制嵌入代码；部署到其他网站前先设置 `CLOUD_EMBED_ORIGINS`。演示适配无 `allow-forms` 的 iframe 沙箱；保留 `connect-src 'none'`、`script-src 'self'` 和 `form-action 'none'`。仅在 `/demo` 允许内联样式，以支持原始 CodeMirror 编辑器与动态几何样式；没有放宽内联脚本或网络访问。账号页 CSP 不变。

`pnpm --filter @sync-think/website build` 同时打包真实组件和桌面样式，通过 workspace source exports 直接构建源码，不依赖预先存在的 desktop/shared dist。构建需要仓库开发依赖，发布目录仍只是 `apps/website/dist`；无需启动 Electron 或打包安装程序。构建拒绝引入 `ChatView` / `ShellApp` / QA runtime，所有 JS 合计限制 3 MiB，并输出非公开的 `demo-build-manifest.json` 记录实际组件及字节数。官网 iframe 保持惰性加载，字体子集按需下载。

首屏使用手绘雪山 `hero-alpine-painted.webp`。下载按钮下展示目前支持的 Claude Code / Codex 内核条。工作台预览叠在首屏绘画上。演示墙纸分别为花田、云海、花野、草地，页脚与收尾使用独立的 `footer-meadow-painted.webp`，不再复用雪山。采用本地 Instrument Serif 字体，OFL 许可证随产物分发，页面没有字体 CDN 请求。参考 Multica 的绘画全幅与内核条布局，保留 SYNC-THINK 文案与左对齐标题。官网嵌入 `/demo.html`，云端同时接受 `/demo`。

以下实际桌面截图作为产品资料留档，已由交互演示取代官网中的静态大图：

`apps/website/assets/workspace-preview.png` 直接复制自现有 `.data/phase3-visual/current/workspace-file-light.png`。源图由 `Phase3VisualFixture.tsx` 中的合成文件数据渲染，展示实际工作区文件标签、源代码编辑器及右侧文件树；不是用户真实会话或 AI 生成界面。

保留源图完整 `1280 x 800` 画面和原始像素，没有裁切、覆盖或重绘。该文件视图自身没有开发验收标题，能完整展示产品的编辑和文件浏览区域。官网应标注“产品演示”，图中的 `install-all.sh` 和长字符串是合成文件内容。

- 源图与输出 SHA-256：`0da7d0b9390098837e53edda137135a779eb020f22bc1d74b0cf58e1e6dc2330`。
- `apps/website/assets/sync-think-logo.png` 直接复用桌面官方白色透明底 Logo，尺寸 `512 x 512`。

素材已逐图查看：演示包含合成 Shell 脚本、公开仓库名、占位路径及组件状态，没有用户邮箱、私有会话内容或模型密钥。
