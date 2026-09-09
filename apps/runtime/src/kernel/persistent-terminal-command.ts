/** Silence describes missing output, not process health or a command's lifetime. */
export function commandSilenceNotice(): string {
  return '命令暂未返回结果，继续等待。';
}

/** Compatibility with stored errors from the former interrupting watchdog. */
export function isCodexSilentCommandWatchdogMessage(message: string | undefined): boolean {
  if (!message) return false;
  return (
    /命令执行无输出超时/.test(message) ||
    /命令执行超过 \d+ 秒无任何输出/.test(message) ||
    /codex CLI 0\.147 Windows/.test(message)
  );
}
