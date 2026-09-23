import {
  resolveAppendMessageImageStagingPath,
  resolveStagedImageWorkspaceRelativePath,
  type AppendMessageImageTrustContext,
} from './chat-image-staging.js';

export type ImageProcessMode =
  | 'forwarded'
  | 'materialized'
  | 'described'
  | 'ocr'
  | 'failed';

export interface ImageProcessSource {
  name: string;
  mimeType: string;
  stagingPath?: string;
}

export interface ImageProcessEntry {
  imageName: string;
  mimeType: string;
  path: string;
  route: ImageProcessMode;
  preview: string;
}

function nativeImageChannel(kernelId?: string): string {
  if (kernelId === 'codex') return 'Codex localImage';
  if (kernelId === 'claude-code') return 'Claude 原生 image block';
  return '模型原生视觉输入';
}

function imageProcessPreview(input: {
  mimeType: string;
  mode: ImageProcessMode;
  kernelId?: string;
  providerModelId?: string;
}): string {
  const target = input.providerModelId ? `，目标模型：${input.providerModelId}` : '';
  const prefix = `MIME：${input.mimeType}`;
  if (input.mode === 'described') {
    return `${prefix}；已由备用视觉模型转写为文字描述${target}`;
  }
  if (input.mode === 'materialized') {
    return `${prefix}；图片已落盘，主模型将按需调用 describe_image 或 ocr_image${target}`;
  }
  if (input.mode === 'ocr') {
    return `${prefix}；已通过 OCR 提取图片文字${target}`;
  }
  if (input.mode === 'failed') {
    return `${prefix}；图片处理失败${target}`;
  }
  return `${prefix}；通过 ${nativeImageChannel(input.kernelId)} 发送${target}`;
}

/** Build durable, display-safe records for host-owned image preparation. */
export function buildImageProcessEntries(input: {
  images: readonly ImageProcessSource[];
  mode: ImageProcessMode;
  trust?: AppendMessageImageTrustContext;
  kernelId?: string;
  providerModelId?: string;
}): ImageProcessEntry[] {
  return input.images.map((image) => {
    const absolutePath = image.stagingPath
      ? resolveAppendMessageImageStagingPath(image, input.trust)
      : undefined;
    const workspacePath = absolutePath
      ? resolveStagedImageWorkspaceRelativePath(absolutePath, input.trust)
      : undefined;
    return {
      imageName: image.name,
      mimeType: image.mimeType,
      path: workspacePath ?? absolutePath ?? image.name,
      route: input.mode,
      preview: imageProcessPreview({
        mimeType: image.mimeType,
        mode: input.mode,
        kernelId: input.kernelId,
        providerModelId: input.providerModelId,
      }),
    };
  });
}
