import type { AdapterEvent, ProviderCallRequest } from '../types.js';

const OPENAI_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export interface OpenAIToolNameMap {
  toWireName(name: string): string;
  fromWireName(name: string): string;
  restoreEvent(event: AdapterEvent): AdapterEvent;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function collectToolNames(request: ProviderCallRequest): string[] {
  const names = new Set(request.tools?.map((tool) => tool.name) ?? []);
  for (const message of request.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === 'tool-call' && part.toolCall?.name) names.add(part.toolCall.name);
    }
  }
  return [...names];
}

export function createOpenAIToolNameMap(request: ProviderCallRequest): OpenAIToolNameMap {
  const internalToWire = new Map<string, string>();
  const wireToInternal = new Map<string, string>();
  const names = collectToolNames(request);

  // Keep already-valid names stable and reserve them before generating aliases.
  for (const name of names) {
    if (!OPENAI_TOOL_NAME.test(name) || wireToInternal.has(name)) continue;
    internalToWire.set(name, name);
    wireToInternal.set(name, name);
  }

  for (const name of names) {
    if (internalToWire.has(name)) continue;
    const sanitized = name.replace(/[^A-Za-z0-9_-]+/g, '__') || 'tool';
    let candidate = sanitized.slice(0, 64);
    if (!OPENAI_TOOL_NAME.test(candidate) || wireToInternal.has(candidate)) {
      const suffix = `__${shortHash(name)}`;
      candidate = `${sanitized.slice(0, 64 - suffix.length)}${suffix}`;
    }
    let collision = 1;
    while (wireToInternal.has(candidate)) {
      const suffix = `_${shortHash(`${name}:${collision}`)}`;
      candidate = `${sanitized.slice(0, 64 - suffix.length)}${suffix}`;
      collision += 1;
    }
    internalToWire.set(name, candidate);
    wireToInternal.set(candidate, name);
  }

  return {
    toWireName: (name) => internalToWire.get(name) ?? name,
    fromWireName: (name) => wireToInternal.get(name) ?? name,
    restoreEvent: (event) =>
      event.type === 'tool-call'
        ? {
            ...event,
            toolCall: {
              ...event.toolCall,
              name: wireToInternal.get(event.toolCall.name) ?? event.toolCall.name,
            },
          }
        : event,
  };
}
