import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * Originally this file asserted on the legacy renderer's index.tsx source. That
 * renderer is gone (2026-08-18 shell switchover), and most of its assertions went
 * with it: they were string searches over a file that no longer ships.
 *
 * What is kept here is the half that never depended on the renderer at all — the
 * Main/preload/protocol boundary. Those assertions guard security properties
 * (plaintext credentials never enter a list payload, clipboard ownership stays in
 * Main) and IPC contracts, which are exactly the things a UI rewrite must not
 * silently break. Behavioural coverage of the shell itself lives in
 * src/renderer/shell/ShellApp.test.tsx, which mounts components instead of
 * grepping them.
 */
const protocolSource = readFileSync(
  new URL('../../../packages/protocol/src/commands.ts', import.meta.url),
  'utf8',
);
const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');
const providerPayloadSource = readFileSync(
  new URL('../src/provider-payloads.ts', import.meta.url),
  'utf8',
);
const shellSource = readFileSync(
  new URL('../src/renderer/shell/ShellApp.tsx', import.meta.url),
  'utf8',
);
const modelSettingsSource = readFileSync(
  new URL('../src/renderer/shell/ModelSettings.tsx', import.meta.url),
  'utf8',
);

describe('M2 bridge wiring', () => {
  it('scopes credential reveal to an explicit short-lived bridge, not list payloads', () => {
    expect(protocolSource).toContain("'provider.revealCredential'");
    expect(protocolSource).toContain('RevealProviderCredentialResponse');
    expect(protocolSource).toContain('/** Plaintext only for this reveal hop. */');
    expect(mainSource).toContain('runtime:provider-reveal-credential');
    expect(preloadSource).toContain('revealProviderCredential');
    expect(globalSource).toContain('revealProviderCredential');
    // The shell may ask for plaintext, but only through that one explicit hop.
    expect(modelSettingsSource).toContain('api.revealProviderCredential({');
    // The invariant that matters: the *list* payload the renderer routinely holds
    // carries no secret, so a leak needs a deliberate reveal call, not a re-render.
    expect(providerPayloadSource).not.toContain('apiKey');
  });

  it('keeps create/update clipboard ownership in main', () => {
    expect(providerPayloadSource).not.toContain('apiKey');
    expect(mainSource).toContain('clipboard.readText()');
    expect(mainSource).toContain('createProviderPayloadFromClipboard');
    expect(mainSource).toContain('updateProviderPayloadFromClipboard');
    expect(mainSource).toContain('runtime:provider-update-credential');
  });

  it('bridges append-only merge conflict listing and resolution', () => {
    expect(mainSource).toContain("'artifact.listConflicts'");
    expect(mainSource).toContain("'artifact.resolveConflict'");
    expect(preloadSource).toContain('listArtifactMergeConflicts');
    expect(preloadSource).toContain('resolveArtifactMergeConflict');
    expect(globalSource).toContain('listArtifactMergeConflicts');
    expect(globalSource).toContain('resolveArtifactMergeConflict');
    // KNOWN GAP: no shell surface consumes these yet — the old assertions passed
    // only because the legacy renderer had an Artifact rail. Merge-conflict
    // resolution is currently unreachable from the shipping UI. Tracked for the
    // Artifact rail work; deliberately not asserted against the shell so this
    // test does not pretend the feature is wired.
  });

  it('wires syncthink://conversation deep links end to end', () => {
    // Main registers the handler, locks a single instance, and parses links.
    expect(mainSource).toContain("app.setAsDefaultProtocolClient('syncthink')");
    expect(mainSource).toContain('app.requestSingleInstanceLock()');
    expect(mainSource).toContain("app.on('open-url'");
    expect(mainSource).toContain("app.on('second-instance'");
    expect(mainSource).toContain('desktop:open-conversation');
    expect(mainSource).toContain('desktop:renderer-ready');
    expect(mainSource).toContain('parseDeepLinkUrl');
    expect(mainSource).toContain('findDeepLinkInArgv');
    // Preload exposes the renderer-facing listeners on the runtime bridge.
    expect(preloadSource).toContain('onOpenConversation');
    expect(preloadSource).toContain('notifyRendererReady');
    expect(preloadSource).toContain('desktop:open-conversation');
    // Types mirror the bridge for the renderer.
    expect(globalSource).toContain('onOpenConversation');
    expect(globalSource).toContain('notifyRendererReady');
    // ...and the shell actually subscribes, then reports itself ready.
    expect(shellSource).toContain('api?.onOpenConversation?.(');
    expect(shellSource).toContain('api?.notifyRendererReady?.();');
  });
});
