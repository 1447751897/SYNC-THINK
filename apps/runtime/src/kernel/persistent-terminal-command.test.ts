import { describe, expect, it } from 'vitest';
import { isCodexSilentCommandWatchdogMessage } from './persistent-terminal-command.js';

describe('isCodexSilentCommandWatchdogMessage', () => {
  it('recognizes the host watchdog copy that used to trigger model fallback', () => {
    expect(
      isCodexSilentCommandWatchdogMessage(
        '命令执行无输出超时，已中断（codex CLI 0.147 Windows 已知挂起问题，建议降级 codex 或改用其他内核执行命令）',
      ),
    ).toBe(true);
  });

  it('ignores ordinary provider errors', () => {
    expect(isCodexSilentCommandWatchdogMessage('fetch failed')).toBe(false);
    expect(isCodexSilentCommandWatchdogMessage(undefined)).toBe(false);
  });
});
