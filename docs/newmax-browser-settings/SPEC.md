# NewMax 内嵌浏览器菜单与设置 — 逆向规格

> 来源：`D:/tools/newmax/resources/app.asar`（NewMax 独立应用，非 SYNC-THINK）
> 提取方式：解包 asar 到 `.tmp/nm/`，读 `main-bundle.js`（渲染层）与 `globals-C4jYQMqs.js`（i18n）
> 参照对象：`newmax:embedded-browser-settings:v1`、`EmbeddedBrowserMoreMenu`、`EmbeddedBrowserManagerDialog`、`WebViewTab`
> 落地位置：SYNC-THINK `apps/desktop`（渲染层 `BrowserPanel` / `BrowserDataManager`，主进程 `browser-content-blocking-service`）

## 0. 关键约束（先读）

- **NewMax 无 source map**，应用代码压缩混淆，**无法还原源码**，只能按契约与行为重写。
- **广告拦截域名表不可得**：`configureContentBlocking` 只把 `{enabled, allowedHosts}` 送过 IPC，过滤表在压缩后的主进程代码里，**未随包暴露**。SYNC-THINK 侧自建等价清单（`browser-content-blocking-hosts.ts`）。
- 可靠性分级：**设置存储契约与文案 = 高**（直接提取）；**菜单结构与交互 = 高**（渲染层可读）；**过滤域名清单 = 低**（自建等价物）；**精确样式 = 低**（Tailwind 工具类，按语义重表达）。

## 1. 核心设计决策：设置归渲染层所有

这是整套机制里最值得照搬的一条，也是最容易被写错的一条。

```
渲染层 localStorage                    主进程
  newmax:embedded-browser-settings:v1
  ├── autoFit: boolean          ─┐
  ├── autofill: boolean          │  只有「已解析的配置」过 IPC
  ├── contentBlocking: boolean   ├──►  embedded-browser:content-blocking:configure
  └── contentBlockingAllowedHosts: string[]   { enabled, allowedHosts }
        │
        └──► CustomEvent: newmax:embedded-browser-settings-changed
              （同一窗口内所有内嵌标签同步，主进程不参与）
```

- 设置在**渲染层**持久化与广播；主进程**不持有**设置状态，只接收解析后的 `{enabled, allowedHosts}`。
- 一个标签切换开关 → `CustomEvent` → 其余所有已挂载的浏览器面板立即跟随，**无需重挂载、无需 IPC 往返**。
- SYNC-THINK 对应物：`sync-think:embedded-browser-settings:v1` / `sync-think:embedded-browser-settings-changed` / `desktop:browser-content-blocking`。

## 2. IPC 契约

### 2.1 NewMax 原始契约

```
embeddedBrowser.listCredentials        embeddedBrowser.saveCredential
embeddedBrowser.fillCredentials        embeddedBrowser.deleteCredential
embeddedBrowser.clearCookies           embeddedBrowser.clearSession
embeddedBrowser.importBrowserData      embeddedBrowser.openDownloads
embeddedBrowser.registerRuntimeTab
embedded-browser:content-blocking:configure   { enabled, allowedHosts }
```

### 2.2 SYNC-THINK 落地契约

```
desktop:browser-content-blocking    { webContentsId, enabled, allowedHosts } -> { ok, config } | { ok:false, error }
desktop:browser-open-downloads      -> { ok, path } | { ok:false, error }
desktop:browser-data                { action, webContentsId, ... } -> BrowserDataResult   （已有，本轮扩 action）
```

`desktop:browser-data` 本轮新增两个 action：

| action | 语义 | 关键点 |
| --- | --- | --- |
| `autofill` | 页面稳定后自动填充当前 origin 的已存密码 | 无匹配记录或表单不唯一 → **静默 no-op**（返回 `ok: true`，不报错） |
| `clear-session` | 清除本资料全部 Cookie + 站点存储 + 缓存 | 逐条 `expirationDate: 1` 过期，不用 `clearStorageData({storages:['cookies']})` |

`desktop:browser-content-blocking` 的守卫：`assertRuntimeIpcSource(event)` → `parseEmbeddedBrowserContentBlockingRequest` 校验 → `webContents.fromId` → 要求 `getType()==='webview' && hostWebContents === event.sender`。

## 3. 内容拦截语义

```
enabled=false                     -> 全部放行
resourceType === 'mainFrame'      -> 放行（拦文档只会得到白页，不是去广告）
protocol ∉ {http:, https:}        -> 放行
host ∈ allowedHosts（后缀匹配）    -> 放行
host ∈ BLOCKED_AD_HOST_SUFFIXES   -> 取消
```

- **每站点开关**：关 = 把该 host 推入允许表；开 = 移除。匹配为**后缀式**（`ads.example.test` 命中 `example.test`），上限 256 条，host 归一化时剥掉前导 `www.`。
- **单监听器**：Electron 每个 session 每个事件只保留一个 `onBeforeRequest`。重复注册会静默顶掉前一个，因此服务按 session 缓存并在原地更新 config，而不是每次重挂。
- `webRequest.onBeforeRequest({ urls: ['*://*/*'] })`，回调 `{ cancel }`。

## 4. 菜单结构（更多菜单，228px）

```
在页面中查找
打印页面
────────────
缩放            [−] [100%] [+] [自适应]
────────────
拦截此网站的广告            (switch)
────────────
设备预览        自适应 / 手机 / 平板
保存截图
────────────
导入 Cookie 和密码…
密码和自动填充
下载内容
清除浏览数据 ▸            (子菜单)
  ├── Cookie 和网站数据
  └── 浏览历史记录
────────────
浏览器设置
```

子菜单为**行内展开**（非 Radix 浮层），`aria-haspopup="menu"` + `aria-expanded`，父行末位带 chevron。NewMax 的浮层子菜单用 `submenuEstWidth: 210` + `closeAncestorSubmenuBeforeClick`。

## 5. 文案（逐字，取自 NewMax i18n zh 分组）

| key | 文案 |
| --- | --- |
| `webview.blockAdsOnThisSite` | 拦截此网站的广告 |
| `webview.downloads` | 下载内容 |
| `webview.clearCookiesAndSiteData` | Cookie 和网站数据 |
| `webview.clearBrowsingHistory` | 浏览历史记录 |
| `webview.browserSettings` | 浏览器设置 |
| `webview.passwordsAndAutofill` | 密码和自动填充 |
| `webview.settingAutoFit` | 默认自动适应网页 |
| `webview.settingAutoFitDescription` | 新打开的网页根据可用宽度自动调整缩放比例。 |
| `webview.settingAutofill` | 自动填充已保存密码 |
| `webview.settingAutofillDescription` | 页面加载完成后，为匹配的网站自动填入账号和密码。 |
| `webview.settingContentBlocking` | 拦截广告与追踪器 |
| `webview.settingContentBlockingDescription` | 在网络请求发出前拦截常见广告、追踪脚本和第三方同步页面。可在网页菜单中为当前网站关闭。 |
| `webview.browserIsolationNotice` | 这些设置作用于所有 NewMax 内置浏览器 Profile，不影响 NewMax 登录态或已配对 Chrome。 |
| `webview.clearCookiesConfirm` | 将清除所有内嵌网页标签共用的 Cookie、缓存和网站登录状态，不影响 NewMax 登录态或自动化浏览器 Profile。此操作无法撤销。 |
| `webview.clearHistoryConfirm` | 将清除当前网页标签的后退和前进历史记录。此操作无法撤销。 |

**对话标题按 mode 切换**：`mode === 'passwords'` → `密码和自动填充`，否则 → `浏览器设置`。SYNC-THINK 保持同一规则（`view === 'passwords'` 分支）。

## 6. 设置对话框

NewMax 的 `EmbeddedBrowserManagerDialog` 用**同一个对话框**承载两种 mode：

- `mode === 'settings'`：三行开关列表（`DsList variant="filled"` + `DsSwitch`）+ 底部 `DsNotice variant="info"` 隔离说明。宽度 480。
- `mode === 'passwords'`：密码管理器（新增密码走**第二层对话框** `width: 420, zIndex: 60`）。
- 打开时 `setSettings(loadEmbeddedBrowserSettings())` —— 每次打开都从 localStorage 重读，不做内存缓存。

**只在 `mode === 'passwords'` 时 `loadCredentials()`**：设置模式是纯本地偏好，**从不访问 guest**。SYNC-THINK 依此把 `list` 读取条件设为 `view !== 'settings' && !snapshot`。

SYNC-THINK 把设置并入现有 `BrowserDataManager`（Tab：密码管理器 / Cookie 和站点数据 / 浏览器设置），保留 NewMax 没有的**资料目录页脚**与**标签栏**。

## 7. 关键交互流程

### 7.1 自动填充

页面 `dom-ready` + 稳定后 **200ms** 触发 `fillCredentials(getWebContentsId())`；`autofillEnabled` 关闭或页面为空 URL 时直接跳过。填充脚本要求 `location.origin` 与记录**完全相等**，只填唯一登录表单，**不提交**。

### 7.2 清除浏览数据

菜单子项 → **应用级确认框**（非 Radix 浮层）→ 执行 → 刷新页面。两条子项确认文案不同（见 §5）。

### 7.3 下载内容

`shell.openPath(app.getPath('downloads'))`。NewMax 同语义；SYNC-THINK 复用已导入的 `shell`，无需动态 import。

### 7.4 浏览器设置

菜单项 → 对话框 `settings` 视图 → 三个开关直接写 localStorage 并广播 `CustomEvent`。

## 8. SYNC-THINK 落地映射

| 层 | 文件 |
| --- | --- |
| 共享契约 | `apps/desktop/src/browser-content-blocking.ts` |
| 过滤清单 | `apps/desktop/src/main/browser-content-blocking-hosts.ts` |
| 主进程服务 | `apps/desktop/src/main/browser-content-blocking-service.ts` |
| 渲染层设置 | `apps/desktop/src/renderer/shell/embedded-browser-settings.ts` |
| 菜单与面板 | `apps/desktop/src/renderer/shell/BrowserPanel.tsx` |
| 设置对话框 | `apps/desktop/src/renderer/shell/BrowserDataManager.tsx` |
| 样式 | `shell.css`（`.shell-browser__switch-row` / `__submenu`）、`browser-data-manager.css`（`.browser-data__settings`） |
| 测试 | `browser-content-blocking.test.ts`、`main/browser-content-blocking-service.test.ts`、`BrowserPanel.test.tsx`、`BrowserDataManager.test.tsx`、`scripts/shell-stylesheet-contract.test.mjs` |

## 9. 重建注意事项

1. **设置在渲染层，主进程不持状态** —— 不要为了"统一"把设置搬进主进程。
2. **不要用 `clearStorageData({storages:['cookies']})`** 清 Cookie：Electron 会连带清掉整个可注册域，而不只是当前 host。
3. **`mainFrame` 必须放行**：拦顶层文档得到的是白页，不是去广告。
4. **每 session 单监听器**：重复 `onBeforeRequest` 会静默覆盖前一个。
5. **`autofill` 无匹配即静默成功**，不要弹错误提示。
6. **允许表后缀匹配必须锚定在点边界**（`hostname === entry || hostname.endsWith('.' + entry)`），否则 `notdoubleclick.net` 会误放 `doubleclick.net`。
7. **样式按语义类名重表达**，不复制 NewMax 压缩 CSS；新选择器要同步进 `shell-stylesheet-contract.mjs` 的必需列表。
