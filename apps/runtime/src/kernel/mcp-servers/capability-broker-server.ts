/**
 * NewMax `capability-broker` — always loaded so the model can search deferred
 * capabilities (image generation today) without stuffing those tool schemas
 * into every turn.
 */
import {
  CAPABILITY_BROKER_SERVER_NAME,
  SEARCH_CAPABILITY_INPUT_SCHEMA,
  SEARCH_CAPABILITY_TOOL_DESCRIPTION,
  SEARCH_CAPABILITY_TOOL_NAME,
  USE_CAPABILITY_INPUT_SCHEMA,
  USE_CAPABILITY_TOOL_DESCRIPTION,
  USE_CAPABILITY_TOOL_NAME,
} from '../../capability-broker.js';
import type { KernelMcpServerDefinition } from './define-server.js';

export const capabilityBrokerServer: KernelMcpServerDefinition = {
  name: CAPABILITY_BROKER_SERVER_NAME,
  version: '1.0.0',
  alwaysLoad: true,
  tools: [
    {
      name: SEARCH_CAPABILITY_TOOL_NAME,
      description: SEARCH_CAPABILITY_TOOL_DESCRIPTION,
      approval: 'never',
      inputSchema: SEARCH_CAPABILITY_INPUT_SCHEMA,
    },
    {
      name: USE_CAPABILITY_TOOL_NAME,
      description: USE_CAPABILITY_TOOL_DESCRIPTION,
      approval: 'never',
      planningDenied: true,
      inputSchema: USE_CAPABILITY_INPUT_SCHEMA,
    },
  ],
};
