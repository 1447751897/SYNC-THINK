export function resolveCcSwitchImportPath(
  requestedPath: string | undefined,
  defaultPath: string,
): string {
  const resolved = requestedPath?.trim() || defaultPath.trim();
  if (!resolved) {
    throw new Error('无法解析 CC Switch 数据库路径（缺少用户主目录）');
  }
  return resolved;
}
