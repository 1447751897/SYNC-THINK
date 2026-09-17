import {
  WINDOWS_OCR_INPUT_SCHEMA,
  WINDOWS_OCR_SERVER_NAME,
  WINDOWS_OCR_TOOL_DESCRIPTION,
  WINDOWS_OCR_TOOL_NAME,
} from '../../windows-ocr.js';
import type { KernelMcpServerDefinition } from './define-server.js';

export const windowsOcrServer: KernelMcpServerDefinition = {
  name: WINDOWS_OCR_SERVER_NAME,
  version: '1.0.0',
  // NOT alwaysLoad. `ocr_image` is a degraded-path tool: it exists for turns
  // whose model definitely cannot receive image pixels and whose vision
  // fallback is unusable. Advertising it to a model that can already see the
  // attachment only invites the model to spend a turn re-extracting text it
  // has in front of it. The runtime supplies `imageOcrFallbackEnabled` per run
  // from the same `resolveRunVisionFallbackDecision` gate the attachment
  // router uses. The registry attaches that condition.
  tools: [
    {
      name: WINDOWS_OCR_TOOL_NAME,
      description: WINDOWS_OCR_TOOL_DESCRIPTION,
      approval: 'never',
      inputSchema: WINDOWS_OCR_INPUT_SCHEMA,
    },
  ],
};
