import { randomUUID } from 'node:crypto';
import type {
  BrowserProfileRecord,
  BrowserSiteSessionRecord,
  BrowserSiteSessionState,
  SqliteBrowserStore,
} from '@sync-think/storage';
import {
  resolveBrowserSiteKey,
  type BrowserHostLike,
  type BrowserProfileSiteClearResult,
  type BrowserProfileSiteDataSnapshot,
} from '@sync-think/workers';
import {
  RuntimeBrowserProfileGate,
  type BrowserProfileOperationGate,
} from './runtime-browser-profile-gate.js';

export interface RuntimeBrowserProfileServiceOptions {
  store: SqliteBrowserStore;
  host: BrowserHostLike;
  profileGate?: BrowserProfileOperationGate;
}

export interface RuntimeBrowserProfileSummary extends BrowserProfileRecord {
  inUse: boolean;
}

export interface RuntimeBrowserSiteSessionList {
  profile: RuntimeBrowserProfileSummary;
  sessions: BrowserSiteSessionRecord[];
  refreshed: boolean;
  checkedAt?: string;
}

export class RuntimeBrowserProfileError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'RuntimeBrowserProfileError';
  }
}

export class RuntimeBrowserProfileService {
  private readonly store: SqliteBrowserStore;
  private readonly host: BrowserHostLike;
  private readonly profileGate: BrowserProfileOperationGate;

  constructor(options: RuntimeBrowserProfileServiceOptions) {
    this.store = options.store;
    this.host = options.host;
    this.profileGate = options.profileGate ?? new RuntimeBrowserProfileGate();
  }

  listProfiles(): RuntimeBrowserProfileSummary[] {
    return this.store.listProfiles().map((profile) => this.toProfileSummary(profile));
  }

  createProfile(input: { name: string }): RuntimeBrowserProfileSummary {
    return this.toProfileSummary(
      this.store.createProfile({
        id: `profile-${randomUUID()}`,
        name: input.name,
      }),
    );
  }

  renameProfile(input: {
    profileId: string;
    name: string;
    expectedRevision: number;
  }): RuntimeBrowserProfileSummary {
    this.assertProfileOperationAvailable(input.profileId);
    return this.toProfileSummary(
      this.store.renameProfile({
        id: input.profileId,
        name: input.name,
        expectedRevision: input.expectedRevision,
      }),
    );
  }

  async deleteProfile(input: {
    profileId: string;
    expectedRevision: number;
  }): Promise<BrowserProfileRecord> {
    return this.profileGate.runExclusive(input.profileId, async () => {
      const profile = this.requireProfile(input.profileId);
      if (profile.isDefault) {
        throw new RuntimeBrowserProfileError(
          'browser.default_profile_immutable',
          'The default Browser Profile cannot be deleted.',
        );
      }
      if (profile.revision !== input.expectedRevision) {
        throw new RuntimeBrowserProfileError(
          'browser.profile_revision_conflict',
          'The Browser Profile changed before it could be deleted.',
        );
      }
      this.assertProfileIdle(profile.id);
      if (!this.host.deleteProfileData) {
        throw new RuntimeBrowserProfileError(
          'browser.profile_delete_unsupported',
          'The Browser Host does not support deleting Profile data.',
        );
      }
      const tombstone = this.store.softDeleteProfile({
        id: profile.id,
        expectedRevision: input.expectedRevision,
      });
      await this.host.deleteProfileData(profile.id);
      return tombstone;
    });
  }

  async reconcileDeletedProfiles(): Promise<{
    purgedProfileIds: string[];
    failedProfileIds: string[];
  }> {
    const purgedProfileIds: string[] = [];
    const failedProfileIds: string[] = [];
    for (const profile of this.store.listDeletedProfiles()) {
      try {
        await this.profileGate.runExclusive(profile.id, async () => {
          if (!this.host.deleteProfileData) {
            throw new RuntimeBrowserProfileError(
              'browser.profile_delete_unsupported',
              'The Browser Host does not support deleting Profile data.',
            );
          }
          await this.host.deleteProfileData(profile.id);
        });
        purgedProfileIds.push(profile.id);
      } catch {
        failedProfileIds.push(profile.id);
      }
    }
    return { purgedProfileIds, failedProfileIds };
  }

  async listSiteSessions(input: {
    profileId: string;
    refresh?: boolean;
  }): Promise<RuntimeBrowserSiteSessionList> {
    if (input.refresh !== true) {
      const profile = this.requireProfile(input.profileId);
      const cached = this.store.listSiteSessions(profile.id);
      return {
        profile: this.toProfileSummary(profile),
        sessions: cached,
        refreshed: false,
        ...(latestCheckedAt(cached) ? { checkedAt: latestCheckedAt(cached) } : {}),
      };
    }
    const refreshed = await this.profileGate.runExclusive(input.profileId, async () => {
      const profile = this.requireProfile(input.profileId);
      const cached = this.store.listSiteSessions(profile.id);
      if (!this.host.listProfileSiteData) {
        throw new RuntimeBrowserProfileError(
          'browser.profile_site_data_unsupported',
          'The Browser Host does not support Profile site-data inspection.',
        );
      }
      this.assertProfileIdle(profile.id);
      const snapshot = await this.host.listProfileSiteData({
        profileId: profile.id,
        knownOrigins: this.store.listKnownOrigins(profile.id).map((entry) => entry.origin),
      });
      const sessions = this.store.replaceSiteSessions({
        profileId: profile.id,
        checkedAt: snapshot.checkedAt,
        sessions: projectSiteSessions(snapshot, cached),
      });
      return {
        profile: this.requireProfile(profile.id),
        sessions,
        checkedAt: snapshot.checkedAt,
      };
    });
    return {
      profile: this.toProfileSummary(refreshed.profile),
      sessions: refreshed.sessions,
      refreshed: true,
      checkedAt: refreshed.checkedAt,
    };
  }

  markLoginVerified(input: {
    profileId: string;
    origin: string;
    verifiedAt?: string;
  }): BrowserSiteSessionRecord {
    this.assertProfileOperationAvailable(input.profileId);
    const origin = normalizeHttpOrigin(input.origin);
    return this.store.markSiteSessionVerified({
      profileId: input.profileId,
      siteKey: resolveBrowserSiteKey(origin),
      origin,
      ...(input.verifiedAt ? { verifiedAt: input.verifiedAt } : {}),
    });
  }

  async clearSiteSession(input: {
    profileId: string;
    siteKey: string;
  }): Promise<BrowserProfileSiteClearResult> {
    return this.profileGate.runExclusive(input.profileId, async () => {
      const profile = this.requireProfile(input.profileId);
      const siteKey = resolveBrowserSiteKey(input.siteKey);
      this.assertProfileIdle(profile.id);
      const session = this.store
        .listSiteSessions(profile.id)
        .find((candidate) => candidate.siteKey === siteKey);
      if (!session) {
        throw new RuntimeBrowserProfileError(
          'browser.site_session_not_found',
          'The requested Browser site session does not exist.',
        );
      }
      if (!this.host.clearProfileSiteData) {
        throw new RuntimeBrowserProfileError(
          'browser.profile_site_clear_unsupported',
          'The Browser Host does not support clearing Profile site data.',
        );
      }
      const result = await this.host.clearProfileSiteData({
        profileId: profile.id,
        siteKey,
        knownOrigins: this.store.listKnownOrigins(profile.id).map((entry) => entry.origin),
      });
      this.store.removeSiteSession(profile.id, siteKey);
      return result;
    });
  }

  private requireProfile(profileId: string): BrowserProfileRecord {
    const profile = this.store.getProfile(profileId);
    if (!profile) {
      throw new RuntimeBrowserProfileError(
        'browser.profile_not_found',
        'The requested Browser Profile does not exist.',
      );
    }
    return profile;
  }

  private assertProfileIdle(profileId: string): void {
    if (this.hasExternalProfileUse(profileId)) {
      throw new RuntimeBrowserProfileError(
        'browser.profile_in_use',
        'The Browser Profile is being used by an active command or Page lease.',
      );
    }
  }

  private toProfileSummary(profile: BrowserProfileRecord): RuntimeBrowserProfileSummary {
    return { ...profile, inUse: this.isProfileInUse(profile.id) };
  }

  private isProfileInUse(profileId: string): boolean {
    return this.profileGate.isBusy(profileId) || this.hasExternalProfileUse(profileId);
  }

  private assertProfileOperationAvailable(profileId: string): void {
    try {
      this.profileGate.assertAvailable(profileId);
    } catch {
      throw new RuntimeBrowserProfileError(
        'browser.profile_in_use',
        'The Browser Profile is being maintained by another operation.',
      );
    }
  }

  private hasExternalProfileUse(profileId: string): boolean {
    return (
      this.store.hasActiveProfileCommands(profileId) ||
      this.store.hasActiveProfileRecording(profileId) ||
      this.host.hasActiveProfileLeases?.(profileId) === true
    );
  }
}

function projectSiteSessions(
  snapshot: BrowserProfileSiteDataSnapshot,
  cached: readonly BrowserSiteSessionRecord[],
): Array<{
  siteKey: string;
  origins: string[];
  state: BrowserSiteSessionState;
  cookieCount: number;
  storageBytes: number;
  storageTypes: string[];
  lastSeenAt?: string;
  lastVerifiedAt?: string;
}> {
  const cachedBySite = new Map(cached.map((session) => [session.siteKey, session]));
  const liveSiteKeys = new Set(snapshot.sites.map((site) => site.siteKey));
  const projected: Array<{
    siteKey: string;
    origins: string[];
    state: BrowserSiteSessionState;
    cookieCount: number;
    storageBytes: number;
    storageTypes: string[];
    lastSeenAt?: string;
    lastVerifiedAt?: string;
  }> = snapshot.sites.map((site) => {
    const previous = cachedBySite.get(site.siteKey);
    const remainsVerified = previous?.state === 'verified' && previous.lastVerifiedAt;
    return {
      siteKey: site.siteKey,
      origins: [...new Set([...(previous?.origins ?? []), ...site.origins])].sort(),
      state: remainsVerified ? ('verified' as const) : ('data_present' as const),
      cookieCount: site.cookieCount,
      storageBytes: site.storageBytes,
      storageTypes: [...new Set(site.storageTypes)].sort(),
      lastSeenAt: snapshot.checkedAt,
      ...(previous?.lastVerifiedAt ? { lastVerifiedAt: previous.lastVerifiedAt } : {}),
    };
  });

  for (const previous of cached) {
    if (liveSiteKeys.has(previous.siteKey)) continue;
    if (!previous.lastVerifiedAt && previous.state !== 'reauth_required') continue;
    projected.push({
      siteKey: previous.siteKey,
      origins: previous.origins,
      state: 'reauth_required',
      cookieCount: 0,
      storageBytes: 0,
      storageTypes: [],
      ...(previous.lastSeenAt ? { lastSeenAt: previous.lastSeenAt } : {}),
      ...(previous.lastVerifiedAt ? { lastVerifiedAt: previous.lastVerifiedAt } : {}),
    });
  }

  return projected.sort((left, right) => left.siteKey.localeCompare(right.siteKey));
}

function latestCheckedAt(sessions: readonly BrowserSiteSessionRecord[]): string | undefined {
  return sessions.reduce<string | undefined>(
    (latest, session) =>
      !latest || session.lastCheckedAt > latest ? session.lastCheckedAt : latest,
    undefined,
  );
}

function normalizeHttpOrigin(value: string): string {
  try {
    const parsed = new URL(String(value ?? '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('invalid origin');
    }
    return parsed.origin;
  } catch {
    throw new RuntimeBrowserProfileError(
      'browser.origin_invalid',
      'Browser login verification requires a valid HTTP(S) origin.',
    );
  }
}
