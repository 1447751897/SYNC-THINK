/**
 * Open gateway (开放网关) — runtime side.
 *
 * `manager.ts` owns the listener + ticket table, `server.ts` is the HTTP shim,
 * `tickets.ts` holds per-run routing tickets and `model-resolver.ts` handles
 * name-based routing for external CLI clients only.
 */
export * from './tickets.js';
export * from './model-resolver.js';
export * from './server.js';
export * from './manager.js';
