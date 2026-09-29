/** Convert tool-produced absolute paths only when they belong to the bound project.
 * Other paths are left intact for the main-process containment checks to reject.
 */
export function projectResourcePath(root: string | undefined, value: string): string {
  const path = value.trim().replace(/\\/g, '/');
  if (!root) return path;
  const prefix = root.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const windows = /^[a-z]:\//i.test(prefix) || prefix.startsWith('//');
  const comparablePath = windows ? path.toLowerCase() : path;
  const comparableRoot = windows ? prefix.toLowerCase() : prefix;
  if (comparablePath === comparableRoot) return '.';
  return comparablePath.startsWith(comparableRoot + '/') ? path.slice(prefix.length + 1) : path;
}
