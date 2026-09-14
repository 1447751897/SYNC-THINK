import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The packaged desktop app cannot rely on `process.env` for its update feed:
 * a user who double-clicks an installed executable has no
 * SYNC_THINK_UPDATE_FEED_URL in the environment, so the updater would always
 * report itself as unconfigured. Instead the feed is frozen into the installer
 * at build time as a small JSON sidecar next to the app resources.
 *
 * This module only validates the *shape* of that sidecar. URL safety rules
 * (HTTPS-or-loopback, no credentials, no query/hash) stay in a single place:
 * resolveDesktopUpdateConfiguration, so a hand-edited sidecar can never skip
 * the checks that a hand-edited environment variable has to pass.
 */
export interface DesktopUpdateBundledFeedConfiguration {
  feedUrl: string;
  channel: string | null;
}

const BUNDLED_CONFIG_FILE_NAME = 'update-feed.json';
const BUNDLED_CONFIG_SCHEMA_VERSION = 1;
const MAX_BUNDLED_CONFIG_BYTES = 16 * 1024;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns null for anything we do not fully understand. A malformed sidecar
 * must degrade to "no bundled feed" (and therefore the environment variable
 * path), never to a half-applied configuration.
 */
export function parseBundledDesktopUpdateFeedConfiguration(
  raw: string,
): DesktopUpdateBundledFeedConfiguration | null {
  if (raw.length > MAX_BUNDLED_CONFIG_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainRecord(value)) return null;
  if (value.schemaVersion !== BUNDLED_CONFIG_SCHEMA_VERSION) return null;

  const feedUrl = value.feedUrl;
  if (typeof feedUrl !== 'string' || feedUrl.trim().length === 0) return null;

  let channel: string | null = null;
  if (value.channel !== undefined && value.channel !== null) {
    if (typeof value.channel !== 'string' || value.channel.trim().length === 0) return null;
    channel = value.channel.trim();
  }

  return { feedUrl: feedUrl.trim(), channel };
}

/**
 * `resourcesPath` is null when the app is not packaged, which is exactly when
 * the sidecar does not exist: development keeps using the environment only.
 */
export function readBundledDesktopUpdateFeedConfiguration(
  resourcesPath: string | null,
): DesktopUpdateBundledFeedConfiguration | null {
  if (!resourcesPath) return null;
  let raw: string;
  try {
    raw = readFileSync(join(resourcesPath, BUNDLED_CONFIG_FILE_NAME), 'utf8');
  } catch {
    return null;
  }
  return parseBundledDesktopUpdateFeedConfiguration(raw);
}
