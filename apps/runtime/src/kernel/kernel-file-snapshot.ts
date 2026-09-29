/** Normalize full file snapshots supplied by a native kernel. Never read the
 * current filesystem to reconstruct a historical edit: another tool may have
 * changed it already. old_string/new_string alone are only replacement fragments. */
export function kernelFileSnapshot(
  toolName: string | undefined,
  argumentsJson: string | undefined,
  output: unknown,
): {
  previousContent?: string;
  writtenContent?: string;
  fileCreated?: boolean;
} {
  if (
    !['edit', 'write'].includes(toolName?.toLowerCase() ?? '') ||
    !output ||
    typeof output !== 'object' ||
    Array.isArray(output)
  )
    return {};
  const result = output as Record<string, unknown>;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argumentsJson ?? '{}');
  } catch {
    return {};
  }
  if (
    !args ||
    typeof args !== 'object' ||
    typeof args.file_path !== 'string' ||
    typeof result.filePath !== 'string'
  )
    return {};
  const pathKey = (path: string) => {
    const normalized = path.replace(/\\/g, '/');
    return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  if (pathKey(args.file_path) !== pathKey(result.filePath)) return {};
  if (toolName?.toLowerCase() === 'write') {
    if (typeof result.content !== 'string') return {};
    const created = result.type === 'create' && result.originalFile === null;
    return {
      ...(typeof result.originalFile === 'string'
        ? { previousContent: result.originalFile }
        : created
          ? { previousContent: '' }
          : {}),
      writtenContent: result.content,
      ...(created ? { fileCreated: true } : {}),
    };
  }
  if (typeof result.originalFile !== 'string') return {};
  const previousContent = result.originalFile;
  const before = result.oldString,
    after = result.newString;
  // Manual edits can differ from the proposed replacement. Preserve the known
  // original, but do not label the proposal as a complete resulting file.
  if (
    result.userModified === true ||
    typeof before !== 'string' ||
    !before ||
    typeof after !== 'string' ||
    typeof result.replaceAll !== 'boolean'
  )
    return { previousContent };
  const position = previousContent.indexOf(before);
  if (
    position < 0 ||
    (!result.replaceAll && previousContent.indexOf(before, position + before.length) >= 0)
  )
    return { previousContent };
  const writtenContent = result.replaceAll
    ? previousContent.split(before).join(after)
    : previousContent.slice(0, position) + after + previousContent.slice(position + before.length);
  return { previousContent, writtenContent };
}
