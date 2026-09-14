/**
 * `image-generation` server — NewMax `mcp__image-generation__generate_image`.
 *
 * Loaded only when Settings > 模型 > 图像生成 has an enabled OpenAI Images
 * provider with a stored key. Deferred: the model never sees `generate_image`
 * in its catalog; `capability-broker` searches this capability and the host
 * still executes the short name.
 */
import {
  GENERATE_IMAGE_INPUT_SCHEMA,
  GENERATE_IMAGE_TOOL_DESCRIPTION,
  GENERATE_IMAGE_TOOL_NAME,
  IMAGE_GENERATION_SERVER_NAME,
} from '../../generate-image-tool.js';
import type { KernelMcpServerDefinition } from './define-server.js';

export const imageGenerationServer: KernelMcpServerDefinition = {
  name: IMAGE_GENERATION_SERVER_NAME,
  version: '0.1.0',
  deferred: true,
  tools: [
    {
      name: GENERATE_IMAGE_TOOL_NAME,
      description: GENERATE_IMAGE_TOOL_DESCRIPTION,
      approval: 'never',
      planningDenied: true,
      inputSchema: GENERATE_IMAGE_INPUT_SCHEMA,
    },
  ],
};
