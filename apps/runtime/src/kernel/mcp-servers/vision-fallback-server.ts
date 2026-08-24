/**
 * `vision-fallback` server — NewMax-style image understanding tool.
 *
 * The model itself cannot see images (text-only upstream): instead of silently
 * dropping the attachments, the host exposes `describe_image` and tells the
 * model (via system context) to call it with a workspace image path. The host
 * then reads the file and describes it with the vision model the user
 * configured in Settings (> 模型 > 图片识别 Fallback).
 *
 * Loading is condition-gated: the server only appears when the user turned the
 * Fallback switch ON, so "读不了图" stays the honest behavior when it is off.
 * The tool is read-only (`approval: 'never'`): it never mutates files.
 */
import {
  DESCRIBE_IMAGE_INPUT_SCHEMA,
  DESCRIBE_IMAGE_TOOL_NAME,
} from '../../describe-image-tool.js';
import type { KernelMcpServerDefinition } from './define-server.js';

export const VISION_FALLBACK_SERVER_NAME = 'vision-fallback';

export const visionFallbackServer: KernelMcpServerDefinition = {
  name: VISION_FALLBACK_SERVER_NAME,
  version: '0.1.0',
  tools: [
    {
      name: DESCRIBE_IMAGE_TOOL_NAME,
      description:
        '用视觉模型理解工作区中的一张图片（PNG / JPEG / GIF / WebP）。传入工作区内的图片路径；' +
        '宿主会调用你配置的视觉模型描述图片并返回文字结果。仅当图片识别 Fallback 已启用时可用。',
      approval: 'never',
      inputSchema: DESCRIBE_IMAGE_INPUT_SCHEMA,
    },
  ],
};
