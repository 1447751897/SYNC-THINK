import type { Event } from '@sync-think/shared';
import {
  executeBrowserCommand,
  navigateOwnedBrowserWebview,
  type ExecuteBrowserCommandInput,
} from './browser-commands.js';

interface BrowserCommandDispatcherOptions {
  open(url: string, workspaceId: string): void;
  projectFolder(workspaceId: string): string | undefined;
  submit(result: {
    requestId: string;
    ok: boolean;
    resultJson?: string;
    error?: string;
  }): Promise<unknown>;
  saveScreenshot?: ExecuteBrowserCommandInput['saveScreenshot'];
  sendTrustedClick?: ExecuteBrowserCommandInput['sendTrustedClick'];
  execute?: typeof executeBrowserCommand;
}

/** One live receiver for the whole shell, independent of mounted chat panes. */
export function createBrowserCommandDispatcher(options: BrowserCommandDispatcherOptions) {
  const seen = new Set<string>();
  return async (event: Event): Promise<void> => {
    if (event.type !== 'browser.command_requested') return;
    const payload = event.payload;
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
    if (!requestId || seen.has(requestId)) return;
    seen.add(requestId);
    if (seen.size > 2_048) seen.delete(seen.values().next().value!);
    try {
      if (Date.now() - Date.parse(event.occurredAt) > 25_000) {
        throw new Error('浏览器请求已过期，请重新读取页面后继续。');
      }
      const action = String(payload.action ?? payload.toolName ?? '');
      const args =
        payload.args && typeof payload.args === 'object'
          ? (payload.args as Record<string, unknown>)
          : {};
      const workspaceId = String(event.workspaceId);
      const ownerId =
        typeof payload.ownerId === 'string' ? payload.ownerId : String(payload.threadId ?? '');
      if (
        action === 'browser_open' &&
        !navigateOwnedBrowserWebview(ownerId, String(args.url ?? ''))
      ) {
        options.open(String(args.url ?? ''), workspaceId);
      }
      const outcome = await (options.execute ?? executeBrowserCommand)({
        action,
        args,
        ownerId,
        projectFolder: options.projectFolder(workspaceId),
        saveScreenshot: options.saveScreenshot,
        sendTrustedClick: options.sendTrustedClick,
      });
      await options.submit({ requestId, ...outcome });
    } catch (error) {
      await options.submit({
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
