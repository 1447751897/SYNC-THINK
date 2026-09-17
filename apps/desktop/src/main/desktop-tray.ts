/**
 * Desktop system tray (Windows notification area / macOS menu bar).
 *
 * Mirrors NewMax's tray behaviour: a left click toggles the main window, a right
 * click opens the menu. The menu is rebuilt on every popup rather than installed
 * once via `setContextMenu`, for two reasons:
 *
 *  - the 显示/隐藏窗口 entry has to reflect the window's current visibility, and
 *  - 最近会话 and the Runtime status line are dynamic.
 *
 * `setContextMenu` would freeze all three at creation time, and on Windows it
 * also makes a left click open the menu — which would collide with the
 * click-to-toggle behaviour we want.
 *
 * The host callbacks are injected so this module stays free of a dependency on
 * the main entry point.
 */
import { Menu, Tray, nativeImage } from 'electron';
import type { MenuItemConstructorOptions, NativeImage } from 'electron';

export interface DesktopTrayConversation {
  id: string;
  title: string;
}

export interface DesktopTrayHost {
  /** Whether the main window is currently visible — drives the toggle label. */
  isWindowVisible(): boolean;
  /** Show/hide the main window. Shared with the global quick-window shortcut. */
  toggleWindow(): void;
  /** Most recent conversations, already ordered newest-first. */
  listRecentConversations(): Promise<DesktopTrayConversation[]>;
  openConversation(conversationId: string): void;
  /** Whether the Runtime pipe answers — drives the status line. */
  isRuntimeRunning(): Promise<boolean>;
  checkForUpdates(): void;
  openDataDirectory(): Promise<void>;
  /** Quit for real (bypasses the close-to-tray interception). */
  quit(): void;
}

/** How many conversations the 最近会话 submenu lists. */
const RECENT_CONVERSATION_LIMIT = 5;
/** Keep menu rows on one line; Electron does not wrap labels. */
const MAX_TITLE_LENGTH = 42;
const TRAY_TOOLTIP = 'SYNC-THINK';

let tray: Tray | null = null;

export function isDesktopTrayActive(): boolean {
  return tray !== null && !tray.isDestroyed();
}

/** Bounds a conversation title so a long one cannot stretch the menu. */
function formatConversationTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return '未命名会话';
  return trimmed.length > MAX_TITLE_LENGTH ? `${trimmed.slice(0, MAX_TITLE_LENGTH - 1)}…` : trimmed;
}

function loadTrayIcon(iconPath: string): NativeImage {
  // Windows picks the best-matching frame out of the .ico (it ships 16/20/24/32
  // and up), so no separate downscaled asset is needed.
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

async function buildTrayMenu(host: DesktopTrayHost): Promise<Menu> {
  const [recent, runtimeRunning] = await Promise.all([
    host.listRecentConversations().catch(() => [] as DesktopTrayConversation[]),
    host.isRuntimeRunning().catch(() => false),
  ]);

  const conversations = recent.slice(0, RECENT_CONVERSATION_LIMIT);
  const conversationItems: MenuItemConstructorOptions[] =
    conversations.length > 0
      ? conversations.map((conversation) => ({
          label: formatConversationTitle(conversation.title),
          click: () => host.openConversation(conversation.id),
        }))
      : [{ label: '暂无会话', enabled: false }];

  const template: MenuItemConstructorOptions[] = [
    {
      label: host.isWindowVisible() ? '隐藏窗口' : '显示窗口',
      click: () => host.toggleWindow(),
    },
    { type: 'separator' },
    { label: '最近会话', submenu: conversationItems },
    { type: 'separator' },
    // Status-only row: never clickable, it exists to answer "is the background
    // Runtime still alive?" without opening the app.
    { label: `Runtime：${runtimeRunning ? '运行中' : '已停止'}`, enabled: false },
    { label: '检查更新…', click: () => host.checkForUpdates() },
    { label: '打开数据目录', click: () => void host.openDataDirectory() },
    { type: 'separator' },
    { label: '退出', click: () => host.quit() },
  ];
  return Menu.buildFromTemplate(template);
}

/**
 * Creates the tray icon. Safe to call repeatedly — an existing tray is kept,
 * which lets preference changes re-run setup without leaking icons.
 */
export function createDesktopTray(host: DesktopTrayHost, iconPath: string): void {
  if (tray && !tray.isDestroyed()) return;

  const icon = loadTrayIcon(iconPath);
  if (icon.isEmpty()) {
    console.warn('[desktop] tray icon could not be loaded; tray disabled', { iconPath });
    return;
  }

  const next = new Tray(icon);
  next.setToolTip(TRAY_TOOLTIP);
  next.on('click', () => host.toggleWindow());
  next.on('right-click', () => {
    void buildTrayMenu(host)
      .then((menu) => {
        if (!tray || tray.isDestroyed()) return;
        tray.popUpContextMenu(menu);
      })
      .catch((error: unknown) => {
        console.warn('[desktop] failed to open tray menu', error);
      });
  });

  tray = next;
  console.log('[desktop] tray icon created');
}

export function destroyDesktopTray(): void {
  if (!tray) return;
  if (!tray.isDestroyed()) tray.destroy();
  tray = null;
  console.log('[desktop] tray icon destroyed');
}
