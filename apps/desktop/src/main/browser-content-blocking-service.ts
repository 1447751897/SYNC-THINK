import {
  hostMatches,
  type EmbeddedBrowserContentBlockingConfig,
} from '../browser-content-blocking.js';
import { BLOCKED_AD_HOST_SUFFIXES } from './browser-content-blocking-hosts.js';

/** Minimal shape of the Electron `details` object the decision reads. */
export interface ContentBlockingRequestDetails {
  url: string;
  resourceType?: string;
}

export interface ContentBlockingDecisionInput {
  config: EmbeddedBrowserContentBlockingConfig;
  details: ContentBlockingRequestDetails;
}

/**
 * Decide whether one request is cancelled.
 *
 * Top-level navigation is never cancelled: blocking the document itself would
 * turn a site into a blank page instead of removing its ad frames.
 */
export function shouldBlockRequest(input: ContentBlockingDecisionInput): boolean {
  const { config, details } = input;
  if (!config.enabled) return false;
  if (details.resourceType === 'mainFrame') return false;
  let hostname: string;
  try {
    const parsed = new URL(details.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    hostname = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname) return false;
  if (config.allowedHosts.some((allowedHost) => hostMatches(hostname, allowedHost))) return false;
  return BLOCKED_AD_HOST_SUFFIXES.some((suffix) => hostMatches(hostname, suffix));
}

export interface ContentBlockingSession {
  webRequest: {
    onBeforeRequest(
      filter: { urls: string[] },
      listener: (
        details: ContentBlockingRequestDetails,
        callback: (response: { cancel?: boolean }) => void,
      ) => void,
    ): void;
  };
}

export interface ContentBlockingService {
  configure(session: ContentBlockingSession, config: EmbeddedBrowserContentBlockingConfig): void;
}

/**
 * Register one `onBeforeRequest` listener per session.
 *
 * Electron keeps a single listener per session and event, so a second call
 * would silently replace the first; keeping the registered sessions lets every
 * embedded tab share one listener whose config is updated in place.
 */
export function createContentBlockingService(): ContentBlockingService {
  const registered = new Map<ContentBlockingSession, { config: EmbeddedBrowserContentBlockingConfig }>();
  return {
    configure(session, config) {
      const existing = registered.get(session);
      if (existing) {
        existing.config = config;
        return;
      }
      const state = { config };
      registered.set(session, state);
      session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
        callback({ cancel: shouldBlockRequest({ config: state.config, details }) });
      });
    },
  };
}
