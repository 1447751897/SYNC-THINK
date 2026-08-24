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
  alwaysLoad: true,
  tools: [
    {
      name: WINDOWS_OCR_TOOL_NAME,
      description: WINDOWS_OCR_TOOL_DESCRIPTION,
      approval: 'never',
      inputSchema: WINDOWS_OCR_INPUT_SCHEMA,
    },
  ],
};
