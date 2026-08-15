/**
 * Open gateway protocol translation (pure functions + stateful SSE emitters).
 *
 * Consumed by the runtime's loopback gateway server, which owns the HTTP side:
 * inbound dialect detection, model lookup, credential resolution and upstream
 * fetch. Nothing here performs I/O, so both directions are fully unit-testable.
 */
export * from './wire-types.js';
export * from './sse-lines.js';
export * from './anthropic-to-openai.js';
export * from './anthropic-to-responses.js';
export * from './openai-to-anthropic.js';
