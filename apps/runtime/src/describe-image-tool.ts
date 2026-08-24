/**
 * `describe_image` tool plumbing (NewMax-style vision fallback):
 * the model calls `mcp__vision-fallback__describe_image <path>` when its own
 * model cannot read images; the host resolves a workspace-scoped image path,
 * reads the file and hands it to the user-configured vision model.
 *
 * Everything here is pure and unit-testable — the runtime supplies the
 * description call.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve } from 'node:path';

export const DESCRIBE_IMAGE_TOOL_NAME = 'describe_image';
export const VISION_FALLBACK_SERVER_NAME = 'vision-fallback';

export const DESCRIBE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function isPathInside(parent: string, child: string): boolean {
  const root = normalize(resolve(parent))
    .replace(/[\\/]+$/, '')
    .toLowerCase();
  const target = normalize(resolve(child)).toLowerCase();
  if (target === root) return true;
  const prefix = root + (root.includes('\\') ? '\\' : '/');
  return target.startsWith(prefix);
}

export type DescribeImagePathResolution =
  { ok: true; absolutePath: string; mimeType: string } | { ok: false; error: string };

/** Resolve a user-supplied image path against the workspace (never escapes it). */
export function resolveDescribeImagePath(
  workspaceRoot: string,
  rawPath: string,
): DescribeImagePathResolution {
  if (!workspaceRoot || workspaceRoot.trim().length === 0) {
    return { ok: false, error: '当前对话未绑定工作区，无法解析图片路径' };
  }
  if (!rawPath || rawPath.trim().length === 0) {
    return { ok: false, error: '缺少图片路径参数（path）' };
  }
  const root = resolve(workspaceRoot);
  const absolute = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath);
  if (!isPathInside(root, absolute)) {
    return { ok: false, error: `图片路径超出工作区范围（仅允许 ${root} 内的文件）` };
  }
  if (!existsSync(absolute)) {
    return { ok: false, error: `图片文件不存在: ${absolute}` };
  }
  let size: number;
  try {
    size = statSync(absolute).size;
  } catch {
    return { ok: false, error: `无法读取图片文件信息: ${absolute}` };
  }
  if (size <= 0) return { ok: false, error: `图片文件为空: ${absolute}` };
  if (size > DESCRIBE_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: `图片过大（${Math.round(size / 1024 / 1024)}MB > 12MB），请压缩后重试`,
    };
  }
  const lower = absolute.toLowerCase();
  const ext = [...IMAGE_EXTENSIONS].find((candidate) => lower.endsWith(candidate));
  if (!ext) {
    return { ok: false, error: '仅支持 PNG / JPEG / GIF / WebP 图片' };
  }
  return { ok: true, absolutePath: absolute, mimeType: IMAGE_MIME_BY_EXT[ext]! };
}

/** Read a validated image file into a `data:image/...;base64,` URL. */
export function readImageDataUrl(absolutePath: string, mimeType: string): string | undefined {
  try {
    const buf = readFileSync(absolutePath);
    if (buf.length === 0 || buf.length > DESCRIBE_IMAGE_MAX_BYTES) return undefined;
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

/** JSON-Schema for the describe_image MCP tool. */
export const DESCRIBE_IMAGE_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      description: '工作区内的图片文件路径（相对或绝对）。仅支持 PNG / JPEG / GIF / WebP。',
    },
    question: {
      type: 'string',
      description: '可选：希望模型重点回答的问题，例如 "图中有哪些文字"、"描述这张图的风格"。',
    },
  },
};

/** 工作区附件落盘目录名（相对 workspace root）。 */
export const ATTACHMENT_IMAGE_DIR = '.newmax-attachments';

/** Target path (relative to workspace root) for a staged attachment image. */
export function attachmentImageRelativePath(_workspaceRoot: string, fileName: string): string {
  return join(ATTACHMENT_IMAGE_DIR, fileName);
}

export const attachmentImageAbsoluteDir = (workspaceRoot: string): string =>
  resolve(workspaceRoot, ATTACHMENT_IMAGE_DIR);
