import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkArchitectureSource } from './architecture-rules.mjs';

test('keeps Browser payload validation rules in the Protocol subpath', () => {
  for (const file of [
    'apps/desktop/src/browser-profile-payloads.ts',
    'apps/desktop/src/browser-recording-payloads.ts',
    'apps/desktop/src/browser-workflow-payloads.ts',
    'apps/runtime/src/validation/browser-profile.ts',
    'apps/runtime/src/validation/browser-recording.ts',
    'apps/runtime/src/validation/browser-workflow.ts',
  ]) {
    assert.match(
      checkArchitectureSource(file, 'function validId(value: unknown) { return true; }').join('\n'),
      /Browser payload rules must remain/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        file,
        "export { tryParseCreateBrowserProfilePayload as parseCreateBrowserProfilePayload } from '@sync-think/protocol/browser-payloads';",
      ),
      [],
    );
  }
});

test('keeps lexical path containment in the Shared Node subpath', () => {
  for (const file of [
    'apps/desktop/src/main/project-file-editor.ts',
    'apps/runtime/src/chat-image-staging.ts',
    'apps/runtime/src/kernel/platform-tools.ts',
    'packages/storage/src/path-allowlist.ts',
    'packages/workers/src/types.ts',
  ]) {
    assert.match(
      checkArchitectureSource(file, 'function isPathInside() { return true; }').join('\n'),
      /Use isPathWithinRoot/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        file,
        "import { isPathWithinRoot } from '@sync-think/shared/node-paths';",
      ),
      [],
    );
  }
});

test('keeps ASCII control-character validation in Shared', () => {
  for (const file of [
    'packages/protocol/src/browser-payloads.ts',
    'packages/storage/src/browser-store.ts',
  ]) {
    assert.match(
      checkArchitectureSource(file, 'function hasAsciiControlCharacter() { return false; }').join(
        '\n',
      ),
      /Use hasAsciiControlCharacter/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        file,
        "import { hasAsciiControlCharacter } from '@sync-think/shared';",
      ),
      [],
    );
  }
});

test('keeps generic record validation in the Shared value subpath', () => {
  for (const file of [
    'apps/desktop/src/agent-payloads.ts',
    'apps/runtime/src/validation/shared.ts',
    'packages/protocol/src/design-generation.ts',
    'packages/storage/src/artifact-store.ts',
    'packages/workers/src/desktop/desktop-contract.ts',
  ]) {
    assert.match(
      checkArchitectureSource(file, 'function isRecord() { return true; }').join('\n'),
      /Use isRecord from @sync-think\/shared\/value-validation/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        file,
        "import { isRecord } from '@sync-think/shared/value-validation';",
      ),
      [],
    );
  }
});

test('keeps compact number policies in the Renderer presentation formatter', () => {
  for (const file of [
    'apps/desktop/src/renderer/shell/provider-usage-summary.ts',
    'apps/desktop/src/renderer/shell/abilities/capability-utils.ts',
  ]) {
    assert.match(
      checkArchitectureSource(file, 'function formatTokens() { return ""; }').join('\n'),
      /Use the semantic compact-number presentation policies/,
    );
  }
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/compact-number.ts',
      'function formatTokens() { return ""; }',
    ).join('\n'),
    /Use the semantic compact-number presentation policies/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/provider-usage-summary.ts',
      "import { formatUsageTokenCount } from './compact-number.js';",
    ),
    [],
  );
});

test('keeps binary byte scaling in Shared and presentation policy in each host', () => {
  for (const file of [
    'apps/desktop/src/renderer/shell/BrowserStage.tsx',
    'packages/ui-kit/src/components/ArtifactVersionsPanel.tsx',
    'packages/storage/src/scripts/database-governance.ts',
  ]) {
    assert.match(
      checkArchitectureSource(file, 'function formatBytes() { return ""; }').join('\n'),
      /Use scaleBinaryBytes/,
    );
    assert.match(
      checkArchitectureSource(file, 'const scaled = bytes / 1024;').join('\n'),
      /Keep binary byte scaling in @sync-think\/shared/,
    );
    assert.deepEqual(
      checkArchitectureSource(file, "import { scaleBinaryBytes } from '@sync-think/shared';"),
      [],
    );
  }
});

test('keeps generated-image MIME validation in the Shared Node subpath', () => {
  for (const [file, declaration] of [
    [
      'apps/runtime/src/orchestration/generated-image-store.ts',
      'function magicMatchesMime() { return true; }',
    ],
    [
      'apps/desktop/src/main/artifact-image-preview.ts',
      'function extensionMatchesMime() { return true; }',
    ],
    [
      'packages/adapters/src/openai/openai-images-adapter.ts',
      'function detectImageMimeType() { return undefined; }',
    ],
  ]) {
    assert.match(
      checkArchitectureSource(file, declaration).join('\n'),
      /Use @sync-think\/shared\/node-image-validation/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        file,
        "import { imageBytesMatchMime } from '@sync-think/shared/node-image-validation';",
      ),
      [],
    );
  }
});

test('keeps lazy vendor script lifecycle in the shared Renderer loader', () => {
  for (const file of [
    'apps/desktop/src/renderer/shell/mermaid-vendor-loader.ts',
    'apps/desktop/src/renderer/shell/xterm-vendor-loader.ts',
    'apps/desktop/src/renderer/shell/excalidraw-vendor-loader.ts',
  ]) {
    assert.match(
      checkArchitectureSource(file, 'let vendorPromise: Promise<unknown> | undefined;').join('\n'),
      /Keep vendor script caching in vendor-script-loader/,
    );
    assert.match(
      checkArchitectureSource(file, "document.createElement('script');").join('\n'),
      /Keep vendor script injection in vendor-script-loader/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        file,
        "import { createVendorScriptLoader } from './vendor-script-loader.js';",
      ),
      [],
    );
  }
});

test('keeps author Skill market summaries in the Protocol catalog', () => {
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/abilities/capability-market.ts',
      "export const SKILL_MARKET = [{ id: 'duplicate' }];",
    ).join('\n'),
    /Derive the Renderer Skill market fallback from the Protocol catalog/,
  );
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/abilities/capability-market.ts',
      'function makeSkillSource() { return ""; }',
    ).join('\n'),
    /Keep installable Skill package contents in Runtime/,
  );
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/skill-market.ts',
      "const AUTHOR_SKILL_PACKAGES = [{ id: 'duplicate', files: {} }];",
    ).join('\n'),
    /Derive Runtime Skill market summaries from the Protocol catalog/,
  );
  for (const file of [
    'apps/runtime/src/skill-market.ts',
    'apps/desktop/src/renderer/shell/abilities/capability-market.ts',
  ]) {
    assert.deepEqual(
      checkArchitectureSource(
        file,
        "import { AUTHOR_SKILL_MARKET_ITEMS } from '@sync-think/protocol/skill-market-catalog';",
      ),
      [],
    );
  }
});

const scheduler = 'apps/runtime/src/orchestration/scheduler.ts';
test('keeps Website demo orchestration behind the explicit Desktop presentation surface', () => {
  const website = 'apps/website/src/demo/WebsiteChatDemo.tsx';
  for (const source of [
    "import { ChatView } from '../../../desktop/src/renderer/shell/ChatView.js';",
    "type UI = import('../../../desktop/src/renderer/shell/conversation-types.js').ChatMessage;",
    "import { ShellApp } from '@sync-think/desktop/shell';",
  ])
    assert.match(
      checkArchitectureSource(website, source).join('\n'),
      /explicit desktop demo surface/,
    );
  assert.deepEqual(
    checkArchitectureSource(
      website,
      "import { ComposerEditor } from '@sync-think/desktop-demo-surface';",
    ),
    [],
  );
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/website-demo-surface.ts',
      "export { Demo } from '../../../../website/src/demo/WebsiteChatDemo.js';",
    ).join('\n'),
    /must not depend on Website orchestration/,
  );
});
for (const component of ['ComposerModeBanner', 'ComposerTaskPanel', 'NewMaxComposerFrame']) {
  test(`keeps migrated ${component} owned by ui-kit`, () => {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/renderer/shell/consumer.tsx',
        `import { ${component} } from './${component}.js';`,
      ).join('\n'),
      /consumed directly from ui-kit/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/renderer/shell/consumer.tsx',
        `import { ${component} } from '@sync-think/ui-kit';`,
      ),
      [],
    );
  });
}
for (const name of [
  'model-fallback-selection',
  'conversation-model-routing',
  'initial-run-model-binding',
  'renderer-browser-command-bridge',
  'desktop-waiting-projection',
  'active-tool-approval',
  'inactive-tool-approval',
  'tool-approval-read-model',
  'describe-image',
]) {
  test(`keeps ${name} separate from Runtime and infrastructure`, () => {
    const file = `apps/runtime/src/${name}.ts`;
    for (const source of [
      "import type { Runtime } from './runtime.js';",
      "type Run = import('./demo-run.js').DemoRunState;",
      "import { openPersistentRuntime } from './persistence.js';",
      "const storage = require('@sync-think/storage');",
      "const adapter = await import('@sync-think/adapters');",
    ])
      assert.match(checkArchitectureSource(file, source).join('\n'), /narrow data and ports/);
    assert.deepEqual(
      checkArchitectureSource(file, "import type { ModelId } from '@sync-think/shared';"),
      [],
    );
  });
}
for (const name of ['goal-turn', 'task-plan-context', 'kernel-session-transcript']) {
  test(`keeps ${name} separate from Runtime state and infrastructure`, () => {
    const file = `apps/runtime/src/${name}.ts`;
    for (const source of [
      "import { Runtime } from './runtime.js';",
      "import type { DemoRunState } from './demo-run.js';",
      "import { openPersistentRuntime } from './persistence.js';",
      "const storage = await import('@sync-think/storage');",
    ]) {
      assert.match(checkArchitectureSource(file, source).join('\n'), /must remain pure/);
    }
    assert.deepEqual(
      checkArchitectureSource(file, "import type { Event } from '@sync-think/shared';"),
      [],
    );
  });
}
test('keeps orchestration plan graph validation inside the pure Shared boundary', () => {
  const file = 'packages/shared/src/orchestration-plan-graph.ts';
  assert.match(
    checkArchitectureSource(
      file,
      "import { SqliteOrchestrationStore } from '@sync-think/storage';",
    ).join('\n'),
    /Domain code must depend on ports/,
  );
  assert.match(
    checkArchitectureSource(file, "import type { Runtime } from '@sync-think/runtime';").join('\n'),
    /Reusable packages must not import applications/,
  );
  assert.deepEqual(
    checkArchitectureSource(file, "import type { PlanStepDraft } from './types/plan.js';"),
    [],
  );
});
test('keeps review policy owned by Shared without restoring the Core compatibility module', () => {
  assert.match(
    checkArchitectureSource(
      'packages/core/src/rework-policy.ts',
      "export { nextReviewAction } from '@sync-think/shared';",
    ).join('\n'),
    /must not be restored/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'packages/shared/src/review-policy.ts',
      "import type { ReviewOutcome } from './types/review.js';",
    ),
    [],
  );
});
test('keeps the obsolete AbilitiesPage compatibility module retired', () => {
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/AbilitiesPage.tsx',
      "export { AbilitiesPage } from './abilities/AbilityCenterPage.js';",
    ).join('\n'),
    /compatibility module/,
  );
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/ShellApp.tsx',
      "import { AbilitiesPage } from './AbilitiesPage.js';",
    ).join('\n'),
    /Import abilities\/AbilityCenterPage directly/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/ShellApp.tsx',
      "import type { AbilityCenterInitialView } from './abilities/AbilityCenterPage.js';",
    ),
    [],
  );
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/ShellApp.tsx',
      "const page = import('./abilities/AbilityCenterPage.js');",
    ).join('\n'),
    /narrow lazy entry/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/ShellApp.tsx',
      "const page = import('./abilities/AbilityCenterPage.lazy.js');",
    ),
    [],
  );
});
test('keeps the legacy SkillSurface implementation retired', () => {
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/abilities/AbilityCenterPage.tsx',
      'export function SkillSurface(): JSX.Element { return <section />; }',
    ).join('\n'),
    /legacy SkillSurface/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/abilities/AbilityCenterPage.tsx',
      'export function AbilitiesPage(): JSX.Element { return <section />; }',
    ),
    [],
  );
});

test('keeps the legacy Telegram polling path retired', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/telegram-bot-client.ts',
      'export class TelegramBotClient {}',
    ).join('\n'),
    /unified TelegramGateway/,
  );
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'class Runtime { private async restartTelegramBotLoop(): Promise<void> {} }',
    ).join('\n'),
    /BotChannelGatewayManager/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'class Runtime { private async executeBotConversationTurn(): Promise<string> { return "ok"; } }',
    ),
    [],
  );
});

test('keeps test-only Composer compatibility helpers out of production modules', () => {
  for (const [file, source] of [
    [
      'apps/desktop/src/renderer/shell/compose-mention.ts',
      'export function applyMention(): string { return "legacy"; }',
    ],
    [
      'apps/desktop/src/renderer/shell/compose-mention.ts',
      'export function extractMentionPaths(): string[] { return []; }',
    ],
    [
      'apps/desktop/src/renderer/shell/compose-toolbar.tsx',
      'export function coerceReasoningEffort(): string { return "auto"; }',
    ],
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /test-only compatibility/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/compose-mention.ts',
      'export function stripMentionToken(): string { return "current"; }',
    ),
    [],
  );
});
test('keeps secret input presentation shared and host policies explicit', () => {
  for (const file of [
    'ModelSettings.tsx',
    'ImageGenerationSettings.tsx',
    'BotConversationPane.tsx',
  ]) {
    assert.match(
      checkArchitectureSource(
        `apps/desktop/src/renderer/shell/${file}`,
        'function SecretInput(): JSX.Element { return <input type="password" />; }',
      ).join('\n'),
      /SecretInputControl/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/SecretInputControl.tsx',
      'export function SecretInputControl(): JSX.Element { return <input type="password" />; }',
    ),
    [],
  );
});

test('keeps toggle semantics shared and host styling explicit', () => {
  for (const file of [
    'abilities/AbilityCenterPage.tsx',
    'BotConversationPane.tsx',
    'DesktopUpdatePanel.tsx',
    'ModelSettings.tsx',
    'PreferencesSettings.tsx',
    'SettingsPage.tsx',
    'WebSearchSettings.tsx',
  ]) {
    assert.match(
      checkArchitectureSource(
        `apps/desktop/src/renderer/shell/${file}`,
        'export function HostToggle() { return <button role="switch" />; }',
      ).join('\n'),
      /ToggleControl/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/ToggleControl.tsx',
      'export function ToggleControl() { return <button role="switch" />; }',
    ),
    [],
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/abilities/AbilityCenterPage.tsx',
      'export function WorkspaceRow() { return <button className="skill-workspace-menu__row" role="switch" />; }',
    ),
    [],
  );
});
test('keeps provider catalog DTO projection outside the Runtime facade', () => {
  for (const name of ['toProviderSummary', 'toModelSummary']) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${name}(value: unknown) { return value; } }`,
      ).join('\n'),
      /provider-catalog-projection/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/provider-catalog-projection.ts',
      'export function projectProviderSummary(value: unknown) { return value; }',
    ),
    [],
  );
});
test('keeps desktop waiting DTO projection outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private toDesktopWaitingCommandSummary(value: unknown) { return value; } }',
    ).join('\n'),
    /desktop-waiting-projection/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/desktop-waiting-projection.ts',
      'export function projectDesktopWaitingCommandSummary(value: unknown) { return value; }',
    ),
    [],
  );
});
test('keeps platform Agent Store adaptation outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private toPlatformAgentStore(value: unknown) { return value; } }',
    ).join('\n'),
    /platform-agent-store/,
  );
  for (const source of [
    "import type { Runtime } from '../runtime.js';",
    "import { openPersistentRuntime } from '../persistence.js';",
    "const storage = require('@sync-think/storage');",
  ]) {
    assert.match(
      checkArchitectureSource('apps/runtime/src/kernel/platform-agent-store.ts', source).join('\n'),
      /narrow ports/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/kernel/platform-agent-store.ts',
      "import type { PlatformToolContext } from './platform-tools.js';",
    ),
    [],
  );
});
test('keeps Scheduled Task history selection outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private fillTaskHistorySummary() {} }',
    ).join('\n'),
    /scheduled-task-history-summary/,
  );
  for (const source of [
    "import type { Runtime } from './runtime.js';",
    "import { openPersistentRuntime } from './persistence.js';",
    "const storage = require('@sync-think/storage');",
  ]) {
    assert.match(
      checkArchitectureSource('apps/runtime/src/scheduled-task-history-summary.ts', source).join(
        '\n',
      ),
      /host-independent/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/scheduled-task-history-summary.ts',
      'export function selectScheduledTaskHistorySummary() { return undefined; }',
    ),
    [],
  );
});
test('keeps Provider lookup and projection outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private providerSummaryById(value: unknown) { return value; } }',
    ).join('\n'),
    /provider-catalog-projection/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/provider-catalog-projection.ts',
      'export function projectProviderSummaryById(value: unknown) { return value; }',
    ),
    [],
  );
});
test('keeps record-to-DTO summaries outside the Runtime facade', () => {
  for (const name of [
    'toAgentBindingSummary',
    'toAgentDefinitionSummary',
    'toCapabilityWorkspaceActivationSummary',
    'toCapabilityUsageSummary',
    'toSkillPublishDraftSummary',
    'toCapabilityOrganizeReportSummary',
    'toMemoryChangeSummary',
    'toDurableMemoryEntrySummary',
    'toDiagnosticSummary',
    'toApprovalRequestSummary',
    'toWorkspaceSummary',
    'toSkillVersionSummary',
    'toMcpServerSummary',
    'toGlobalAgentSummary',
    'toTeamSummary',
    'toTeamRunSummary',
    'toConversationSummary',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${name}(value: unknown) { return value; } }`,
      ).join('\n'),
      /catalog projection in summaries/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/summaries.ts',
      'export function toTeamSummary(value: unknown) { return value; }',
    ),
    [],
  );
});
test('keeps conversation registration independent of Electron and concrete host implementations', () => {
  for (const file of [
    'conversation-query-handlers',
    'conversation-write-handlers',
    'conversation-transient-handlers',
    'conversation-approval-handlers',
    'conversation-browser-handlers',
    'conversation-management-handlers',
    'conversation-routing-handlers',
    'conversation-plan-handlers',
    'conversation-ask-handlers',
  ]) {
    for (const source of [
      "import { ipcMain } from 'electron';",
      "import { RuntimePipeClient } from './runtime-client.js';",
      "import { SqliteMessageStore } from '@sync-think/storage';",
    ]) {
      assert.match(
        checkArchitectureSource(`apps/desktop/src/main/${file}.ts`, source).join('\n'),
        /injected host ports/,
      );
    }
  }
});
test('keeps Browser Profile registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/browser-profile-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      file,
      "import type { BrowserProfileCommand } from '@sync-think/protocol';",
    ),
    [],
  );
});
test('keeps Browser Recording registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/browser-recording-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      file,
      "import type { BrowserRecordingCommand } from '@sync-think/protocol';",
    ),
    [],
  );
});
test('keeps Browser Workflow registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/browser-workflow-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      file,
      "import type { BrowserWorkflowCommand } from '@sync-think/protocol';",
    ),
    [],
  );
});
test('keeps Browser Handoff registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/browser-handoff-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      file,
      "import type { BrowserHandoffCommand } from '@sync-think/protocol';",
    ),
    [],
  );
});
test('keeps Desktop Command registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/desktop-command-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(file, "import type { DesktopCommand } from '@sync-think/protocol';"),
    [],
  );
});
test('keeps Browser Extension registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/browser-extension-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      file,
      "import type { BrowserExtensionCommand } from '@sync-think/protocol';",
    ),
    [],
  );
});
test('keeps Approval registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/approval-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(file, "import type { ApprovalCommand } from '@sync-think/protocol';"),
    [],
  );
});
test('keeps Memory registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/memory-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(file, "import type { MemoryCommand } from '@sync-think/protocol';"),
    [],
  );
});
test('keeps Context Packet registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/context-packet-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      file,
      "import type { ContextPacketCommand } from '@sync-think/protocol';",
    ),
    [],
  );
});
test('keeps Diagnostics registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/diagnostics-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      file,
      "import type { DiagnosticsCommand } from '@sync-think/protocol';",
    ),
    [],
  );
});
test('keeps Gateway registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/gateway-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(file, "import type { GatewayCommand } from '@sync-think/protocol';"),
    [],
  );
});
test('keeps Kernel registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/kernel-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(file, "import type { KernelCommand } from '@sync-think/protocol';"),
    [],
  );
});
test('keeps Settings registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/settings-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(file, "import type { SettingsCommand } from '@sync-think/protocol';"),
    [],
  );
});
test('keeps Policy registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/policy-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(file, "import type { PolicyCommand } from '@sync-think/protocol';"),
    [],
  );
});
test('keeps Usage registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/usage-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(file, "import type { UsageCommand } from '@sync-think/protocol';"),
    [],
  );
});
test('keeps Agent registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/agent-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(file, "import type { AgentCommand } from '@sync-think/protocol';"),
    [],
  );
});
test('keeps Global Agent registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/global-agent-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteGlobalAgentStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      file,
      "import type { GlobalAgentCommand } from '@sync-think/protocol';",
    ),
    [],
  );
});
test('keeps Team registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/team-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteTeamStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(file, "import type { TeamCommand } from '@sync-think/protocol';"),
    [],
  );
});
test('keeps Scheduled Task registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/scheduled-task-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteScheduledTaskStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      file,
      "import type { ScheduledTaskCommand } from '@sync-think/protocol';",
    ),
    [],
  );
});
test('keeps Activity registration independent of Electron and host implementations', () => {
  const file = 'apps/desktop/src/main/activity-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteRunIndexStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(file, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(file, "import type { ActivityCommand } from '@sync-think/protocol';"),
    [],
  );
});
test('keeps Goal parsing and registration independent of host implementations', () => {
  const handlerFile = 'apps/desktop/src/main/goal-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteGoalStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(handlerFile, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      handlerFile,
      "import type { GoalCommand } from '@sync-think/protocol';",
    ),
    [],
  );

  const payloadFile = 'apps/desktop/src/goal-payloads.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { rendererApi } from './renderer/api.js';",
  ]) {
    assert.match(checkArchitectureSource(payloadFile, source).join('\n'), /contract leaves/);
  }
});
test('keeps Skill Local parsing and registration independent of host implementations', () => {
  const handlerFile = 'apps/desktop/src/main/skill-local-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteSkillStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(handlerFile, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      handlerFile,
      "import type { SkillLocalCommand } from '@sync-think/protocol';",
    ),
    [],
  );

  const payloadFile = 'apps/desktop/src/skill-local-payloads.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { rendererApi } from './renderer/api.js';",
  ]) {
    assert.match(checkArchitectureSource(payloadFile, source).join('\n'), /contract leaves/);
  }
});
test('keeps Skill Market parsing and registration independent of host implementations', () => {
  const handlerFile = 'apps/desktop/src/main/skill-market-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteSkillStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(handlerFile, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      handlerFile,
      "import type { SkillMarketCommand } from '@sync-think/protocol';",
    ),
    [],
  );

  const payloadFile = 'apps/desktop/src/skill-market-payloads.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { rendererApi } from './renderer/api.js';",
  ]) {
    assert.match(checkArchitectureSource(payloadFile, source).join('\n'), /contract leaves/);
  }
});
test('keeps installed Skill parsing and registration independent of host implementations', () => {
  const handlerFile = 'apps/desktop/src/main/skill-handlers.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { SqliteSkillStore } from '@sync-think/storage';",
  ]) {
    assert.match(checkArchitectureSource(handlerFile, source).join('\n'), /injected host ports/);
  }
  assert.deepEqual(
    checkArchitectureSource(
      handlerFile,
      "import type { SkillCommand } from '@sync-think/protocol';",
    ),
    [],
  );

  const payloadFile = 'apps/desktop/src/skill-payloads.ts';
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { rendererApi } from './renderer/api.js';",
  ]) {
    assert.match(checkArchitectureSource(payloadFile, source).join('\n'), /contract leaves/);
  }
});
test('prevents migrated chat RPCs from reverting to untyped transport in any main module', () => {
  for (const command of [
    'task.appendMessage',
    'message.attachImages',
    'conversation.listMessages',
    'conversation.getContextStatus',
    'conversation.sendMessage',
    'conversation.compact',
    'conversation.listNavigation',
    'conversation.getRunProcess',
    'conversation.listRunTimeline',
    'conversation.readContent',
    'conversation.readFileDiff',
    'conversation.listFileChanges',
    'conversation.taskPlanHistory',
    'conversation.decideToolApproval',
    'conversation.listPendingToolApprovals',
    'conversation.submitBrowserResult',
    'conversation.list',
    'conversation.create',
    'conversation.rename',
    'conversation.setPinned',
    'conversation.setArchived',
    'conversation.delete',
    'conversation.setExecutionMode',
    'conversation.setInteractionMode',
    'conversation.setContextWindowOverride',
    'conversation.upgradeTrack',
    'conversation.rebindTarget',
    'conversation.plan.submit',
    'conversation.plan.get',
    'conversation.plan.approve',
    'conversation.plan.revise',
    'conversation.plan.cancel',
    'conversation.ask.answer',
    'conversation.ask.cancel',
    'conversation.ask.pending',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestConversation/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestConversation('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Browser Profile RPCs from reverting to untyped transport', () => {
  for (const command of [
    'browser.profile.list',
    'browser.profile.create',
    'browser.profile.rename',
    'browser.profile.delete',
    'browser.profile.listSiteSessions',
    'browser.profile.clearSiteSession',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestBrowserProfile/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestBrowserProfile('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Browser Recording RPCs from reverting to untyped transport', () => {
  for (const command of [
    'browser.recording.list',
    'browser.recording.get',
    'browser.recording.start',
    'browser.recording.stop',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestBrowserRecording/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestBrowserRecording('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Browser Workflow RPCs from reverting to untyped transport', () => {
  for (const command of [
    'browser.workflow.list',
    'browser.workflow.get',
    'browser.workflow.createDraft',
    'browser.workflow.createRevisionDraft',
    'browser.workflow.submit',
    'browser.workflow.review',
    'browser.workflow.execute',
    'browser.workflow.approveAndExecute',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestBrowserWorkflow/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestBrowserWorkflow('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Browser Handoff RPCs from reverting to untyped transport', () => {
  for (const command of [
    'browser.handoff.listWaiting',
    'browser.handoff.continue',
    'browser.handoff.cancel',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestBrowserHandoff/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestBrowserHandoff('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Desktop Command RPCs from reverting to untyped transport', () => {
  for (const command of [
    'desktop.command.listWaiting',
    'desktop.command.continue',
    'desktop.command.cancel',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestDesktopCommand/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestDesktopCommand('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Browser Extension RPCs from reverting to untyped transport', () => {
  for (const command of [
    'browser.extension.status',
    'browser.extension.restart',
    'browser.extension.resetPairing',
    'browser.extension.openFolder',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', {});`,
      ).join('\n'),
      /Use requestBrowserExtension/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestBrowserExtension('${command}', {});`,
      ),
      [],
    );
  }
});
test('prevents Approval RPCs from reverting to untyped transport', () => {
  for (const command of [
    'approval.list',
    'approval.evaluate',
    'approval.enqueue',
    'approval.decide',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestApproval/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestApproval('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Memory RPCs from reverting to untyped transport', () => {
  for (const command of ['memory.list', 'memory.decide', 'memory.rollback']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestMemory/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestMemory('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Context Packet RPCs from reverting to untyped transport', () => {
  for (const command of ['context.packet.peek', 'context.packet.amend']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestContextPacket/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestContextPacket('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Diagnostics RPCs from reverting to untyped transport', () => {
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/main/new-handler.ts',
      "client.request('diagnostics.list', payload);",
    ).join('\n'),
    /Use requestDiagnostics/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/main/new-handler.ts',
      "client.requestDiagnostics('diagnostics.list', payload);",
    ),
    [],
  );
});
test('prevents Gateway RPCs from reverting to untyped transport', () => {
  for (const command of ['gateway.status', 'gateway.logs', 'gateway.logs.clear']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestGateway/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestGateway('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Kernel RPCs from reverting to untyped transport', () => {
  for (const command of ['kernel.detect', 'kernel.recycle']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestKernel/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestKernel('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Settings RPCs from reverting to untyped transport', () => {
  for (const command of ['settings.get', 'settings.set']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestSettings/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestSettings('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Policy RPCs from reverting to untyped transport', () => {
  for (const command of ['policy.save', 'policy.list']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestPolicy/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestPolicy('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Usage RPCs from reverting to untyped transport', () => {
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/main/new-handler.ts',
      "client.request('usage.summary', payload);",
    ).join('\n'),
    /Use requestUsage/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/main/new-handler.ts',
      "client.requestUsage('usage.summary', payload);",
    ),
    [],
  );
});
test('prevents Agent RPCs from reverting to untyped transport', () => {
  for (const command of [
    'agent.get',
    'agent.updateBinding',
    'agent.list',
    'agent.create',
    'agent.listVersions',
    'agent.createVersion',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestAgent/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestAgent('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Global Agent RPCs from reverting to untyped transport', () => {
  for (const command of [
    'globalAgent.list',
    'globalAgent.create',
    'globalAgent.update',
    'globalAgent.delete',
    'globalAgent.listWorkspaceActivations',
    'globalAgent.setWorkspaceActivation',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestGlobalAgent/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestGlobalAgent('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Team RPCs from reverting to untyped transport', () => {
  for (const command of [
    'team.list',
    'team.create',
    'team.update',
    'team.delete',
    'team.startRun',
    'team.setRunStatus',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestTeam/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestTeam('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Scheduled Task RPCs from reverting to untyped transport', () => {
  for (const command of [
    'scheduledTask.create',
    'scheduledTask.list',
    'scheduledTask.update',
    'scheduledTask.delete',
    'scheduledTask.trigger',
    'scheduledTask.history',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestScheduledTask/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestScheduledTask('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Activity RPCs from reverting to untyped transport', () => {
  for (const command of [
    'activity.listRuns',
    'activity.listExternalEvents',
    'activity.retryAnchor',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestActivity/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestActivity('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Goal RPCs from reverting to untyped transport', () => {
  for (const command of ['goal.set', 'goal.get', 'goal.clear', 'goal.pause', 'goal.resume']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestGoal/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestGoal('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Skill Local RPCs from reverting to untyped transport', () => {
  for (const command of ['skill.local.scan', 'skill.local.inspect', 'skill.local.import']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestSkillLocal/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestSkillLocal('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents Skill Market RPCs from reverting to untyped transport', () => {
  for (const command of ['skill.market.list', 'skill.market.install']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestSkillMarket/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestSkillMarket('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents installed Skill RPCs from reverting to untyped transport', () => {
  for (const command of [
    'skill.import',
    'skill.importRemote',
    'skill.list',
    'skill.get',
    'skill.delete',
    'skill.setEnabled',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestSkill/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestSkill('${command}', payload);`,
      ),
      [],
    );
  }
});
test('prevents MCP registry RPCs from reverting to untyped transport', () => {
  for (const command of [
    'mcp.register',
    'mcp.registerRemote',
    'mcp.list',
    'mcp.setEnabled',
    'mcp.delete',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestMcpRegistry/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestMcpRegistry('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the MCP registry boundary independent of Electron and transport implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/mcp-registry-handlers.ts', source).join('\n'),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/mcp-registry-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents MCP tool RPCs from reverting to untyped transport', () => {
  for (const command of [
    'mcp.policy.probe',
    'mcp.tool.request',
    'mcp.spawn.probe',
    'mcp.tool.call',
    'mcp.tools.refresh',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestMcpTool/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestMcpTool('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the MCP tool boundary independent of Electron and transport implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/mcp-tool-handlers.ts', source).join('\n'),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/mcp-tool-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Bot Channel RPCs from reverting to untyped transport', () => {
  for (const command of [
    'bot.channel.get',
    'bot.channel.save',
    'bot.channel.test',
    'bot.channel.wechat.qr.request',
    'bot.channel.wechat.qr.check',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestBotChannel/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestBotChannel('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Bot Channel boundary independent of Electron and transport implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/bot-channel-handlers.ts', source).join('\n'),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/bot-channel-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Capability Governance RPCs from reverting to untyped transport', () => {
  for (const command of [
    'capability.workspace.list',
    'capability.workspace.setActive',
    'capability.governance.list',
    'capability.publishDraft.save',
    'capability.publishDraft.list',
    'capability.publishDraft.get',
    'capability.publishDraft.submit',
    'capability.organize.preview',
    'capability.organize.getLatest',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestCapabilityGovernance/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestCapabilityGovernance('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Capability Governance boundary independent of Electron and transport implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/capability-governance-handlers.ts',
        source,
      ).join('\n'),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/capability-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Prompt and Design RPCs from reverting to untyped transport', () => {
  for (const command of ['prompt.enhance', 'prompt.enhance.cancel', 'design.generate']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestPromptDesign/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestPromptDesign('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Prompt and Design boundary independent of Electron and transport implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/prompt-design-handlers.ts', source).join('\n'),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/prompt-design-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Workspace RPCs from reverting to untyped transport', () => {
  for (const command of [
    'workspace.create',
    'workspace.bindFolder',
    'workspace.list',
    'workspace.update',
    'workspace.delete',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestWorkspace/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestWorkspace('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Workspace boundary independent of Electron and transport implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/workspace-handlers.ts', source).join('\n'),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/workspace-lifecycle-payloads.ts', source).join(
        '\n',
      ),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Task directory RPCs from reverting to untyped transport', () => {
  for (const command of [
    'task.create',
    'task.list',
    'task.open',
    'task.search',
    'task.archive',
    'task.unarchive',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestTask/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestTask('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Task directory boundary independent of Electron and transport implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/task-handlers.ts', source).join('\n'),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/task-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Participation Mode RPCs from reverting to untyped transport', () => {
  const command = 'task.setParticipationMode';
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/main/new-handler.ts',
      `client.request('${command}', payload);`,
    ).join('\n'),
    /Use requestParticipationMode/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/main/new-handler.ts',
      `client.requestParticipationMode('${command}', payload);`,
    ),
    [],
  );
});
test('keeps the Participation Mode boundary independent of host implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/participation-mode-handlers.ts', source).join(
        '\n',
      ),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/participation-mode-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Plan lifecycle RPCs from reverting to untyped transport', () => {
  for (const command of ['plan.draft', 'plan.revise', 'plan.listRevisions', 'plan.approve']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestPlan/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestPlan('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Plan lifecycle boundary independent of Electron and transport implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/plan-handlers.ts', source).join('\n'),
      /must use injected host ports/,
    );
  }
  for (const file of [
    'apps/desktop/src/plan-payloads.ts',
    'apps/desktop/src/orchestration-payload-validation.ts',
  ]) {
    for (const source of [
      "import { ipcMain } from 'electron';",
      "import { RuntimePipeClient } from './main/runtime-client.js';",
      "import { store } from '@sync-think/storage';",
    ]) {
      assert.match(
        checkArchitectureSource(file, source).join('\n'),
        /must remain host-independent contract leaves/,
      );
    }
  }
});
test('prevents Run control RPCs from reverting to untyped transport', () => {
  for (const command of ['run.getGraph', 'run.pause', 'run.resume', 'run.cancel']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestRunControl/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestRunControl('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Run control boundary independent of Electron and transport implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/run-control-handlers.ts', source).join('\n'),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/run-control-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Artifact RPCs from reverting to untyped transport', () => {
  for (const command of [
    'artifact.list',
    'artifact.getVersion',
    'artifact.compare',
    'artifact.selectVersion',
    'artifact.merge',
    'artifact.listConflicts',
    'artifact.resolveConflict',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestArtifact/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestArtifact('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Artifact boundary independent of Electron and transport implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/artifact-handlers.ts', source).join('\n'),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/artifact-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Provider Catalog RPCs from reverting to untyped transport', () => {
  for (const command of [
    'provider.create',
    'provider.update',
    'provider.list',
    'provider.reorder',
    'provider.delete',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestProviderCatalog/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestProviderCatalog('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Provider Catalog boundary independent of host implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/provider-catalog-handlers.ts', source).join(
        '\n',
      ),
      /must use injected host ports/,
    );
  }
  for (const file of [
    'apps/desktop/src/provider-catalog-payloads.ts',
    'apps/desktop/src/provider-payload-validation.ts',
  ]) {
    for (const source of [
      "import { ipcMain } from 'electron';",
      "import { RuntimePipeClient } from './main/runtime-client.js';",
      "import { store } from '@sync-think/storage';",
    ]) {
      assert.match(
        checkArchitectureSource(file, source).join('\n'),
        /must remain host-independent contract leaves/,
      );
    }
  }
});
test('prevents Provider Credential RPCs from reverting to untyped transport', () => {
  for (const command of [
    'provider.addCredential',
    'provider.removeCredential',
    'provider.clearCredentials',
    'provider.revealCredential',
    'provider.updateCredential',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestProviderCredential/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestProviderCredential('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Provider Credential boundary independent of host implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/provider-credential-handlers.ts', source).join(
        '\n',
      ),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/provider-credential-payloads.ts', source).join(
        '\n',
      ),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Provider Model RPCs from reverting to untyped transport', () => {
  for (const command of [
    'provider.addModels',
    'provider.setModelPriorities',
    'provider.updateModel',
    'provider.removeModel',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestProviderModel/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestProviderModel('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Provider Model boundary independent of host implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/provider-model-handlers.ts', source).join(
        '\n',
      ),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/provider-model-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Provider Discovery RPCs from reverting to untyped transport', () => {
  for (const command of [
    'provider.discoverModels',
    'provider.probeModels',
    'provider.probeCapabilities',
    'provider.confirmCapabilities',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestProviderDiscovery/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestProviderDiscovery('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Provider Discovery boundary independent of host implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/provider-discovery-handlers.ts', source).join(
        '\n',
      ),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/provider-discovery-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Provider Balance RPCs from reverting to untyped transport', () => {
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/main/new-handler.ts',
      "client.request('provider.balance', payload);",
    ).join('\n'),
    /Use requestProviderBalance/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/main/new-handler.ts',
      "client.requestProviderBalance('provider.balance', payload);",
    ),
    [],
  );
});
test('keeps the Provider Balance boundary independent of host implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/provider-balance-handlers.ts', source).join(
        '\n',
      ),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/provider-balance-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Provider CC Switch RPCs from reverting to untyped transport', () => {
  for (const command of ['provider.previewCcSwitchImport', 'provider.importCcSwitch']) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestProviderCcSwitch/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestProviderCcSwitch('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Provider CC Switch boundary independent of host implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/provider-cc-switch-handlers.ts', source).join(
        '\n',
      ),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/provider-cc-switch-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
test('prevents Web Search Provider RPCs from reverting to untyped transport', () => {
  for (const command of [
    'webSearch.providers.list',
    'webSearch.providers.save',
    'webSearch.providers.reorder',
    'webSearch.providers.test',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestWebSearchProvider/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestWebSearchProvider('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Web Search Provider boundary independent of host implementations', () => {
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/web-search-provider-handlers.ts', source).join(
        '\n',
      ),
      /must use injected host ports/,
    );
  }
});
test('prevents Data Management RPCs from reverting to untyped transport', () => {
  for (const command of [
    'data.storageStats',
    'data.export',
    'data.import',
    'data.backup',
    'data.compactStorage',
    'data.cleanConversations',
    'data.cleanEmptyAttachmentDirectories',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.request('${command}', payload);`,
      ).join('\n'),
      /Use requestDataManagement/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        'apps/desktop/src/main/new-handler.ts',
        `client.requestDataManagement('${command}', payload);`,
      ),
      [],
    );
  }
});
test('keeps the Data Management boundary independent of host implementations', () => {
  for (const source of [
    "import { ipcMain, dialog } from 'electron';",
    "import { RuntimePipeClient } from './runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/main/data-management-handlers.ts', source).join(
        '\n',
      ),
      /must use injected host ports/,
    );
  }
  for (const source of [
    "import { ipcMain } from 'electron';",
    "import { RuntimePipeClient } from './main/runtime-client.js';",
    "import { store } from '@sync-think/storage';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/desktop/src/data-management-payloads.ts', source).join('\n'),
      /must remain host-independent contract leaves/,
    );
  }
});
for (const name of [
  'use-compose-request-queue',
  'compose-send-request',
  'use-conversation-compaction',
  'use-compose-draft-recovery',
  'submit-conversation-message',
  'use-conversation-navigation',
  'use-conversation-navigation-controller',
  'use-message-virtual-window',
  'use-conversation-transient-subscription',
  'conversation-navigation-loader',
  'conversation-message-merge',
  'run-identity-projection',
  'conversation-scroll-position',
]) {
  test(`keeps ${name} independent of ChatView and host implementations`, () => {
    const file = `apps/desktop/src/renderer/shell/${name}.ts`;
    for (const source of [
      "import { ChatView } from './ChatView.js';",
      "type UI = import('./ChatView.js').ChatMessage;",
      "import { client } from '../../main/runtime-client.js';",
      "const storage = require('@sync-think/storage');",
    ]) {
      assert.match(
        checkArchitectureSource(file, source).join('\n'),
        /must use contracts\/callbacks/,
      );
    }
    assert.deepEqual(
      checkArchitectureSource(
        file,
        "import type { QueuedComposeRequest } from './compose-request-queue.js';",
      ),
      [],
    );
  });
}

test('keeps Provider discovery routing outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private resolveDiscoveryAdapter(value: unknown) { return value; } }',
    ).join('\n'),
    /provider-discovery-routing/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/provider-discovery-routing.ts',
      'export function resolveDiscoveryAdapter(value: unknown) { return value; }',
    ),
    [],
  );
});

test('keeps prompt enhancement parsing and model selection outside the Runtime facade', () => {
  for (const method of ['parsePromptEnhancePayload', 'resolvePromptEnhancementModelId']) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${method}(value: unknown) { return value; } }`,
      ).join('\n'),
      /prompt enhancement/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/prompt-enhancement-model-selection.ts',
      'export function resolvePromptEnhancementModelId(value: unknown) { return value; }',
    ),
    [],
  );
});

test('keeps Artifact content classification outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private isTextArtifactMime(value: string) { return value; } }',
    ).join('\n'),
    /artifact-content-policy/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/artifact-content-policy.ts',
      'export function isMergeableTextArtifactMime(value: string) { return value; }',
    ),
    [],
  );
});

test('keeps CC Switch import path selection outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private resolveCcSwitchDbPath(value?: string) { return value; } }',
    ).join('\n'),
    /cc-switch-import-path/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/cc-switch-import-path.ts',
      'export function resolveCcSwitchImportPath(value: string) { return value; }',
    ),
    [],
  );
});

test('keeps conversation context snapshot storage outside the Runtime facade', () => {
  for (const member of [
    'contextSnapshotByThread',
    'contextSnapshotCacheKey',
    'setConversationContextSnapshot',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member}(value: string) { return value; } }`,
      ).join('\n'),
      /conversation-context-snapshot-cache/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/conversation-context-snapshot-cache.ts',
      'export class ConversationContextSnapshotCache { private value = new Map(); }',
    ),
    [],
  );
});

test('keeps Run-to-Kernel persistence outside the Runtime facade', () => {
  for (const member of [
    'runKernelIds',
    'runKernelIdsLoaded',
    'ensureRunKernelIdsLoaded',
    'recordRunKernel',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member}(value: string) { return value; } }`,
      ).join('\n'),
      /run-kernel-registry/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/run-kernel-registry.ts',
      'export class RunKernelRegistry { private value = new Map(); }',
    ),
    [],
  );
});

test('keeps Policy scope validation and composition outside the Runtime facade', () => {
  for (const member of [
    'validatePolicySaveScope',
    'buildApplicablePolicyScopes',
    'hasApplicablePolicyForTask',
    'requirePolicyWorkspace',
    'requirePolicyTask',
    'requirePolicyAgent',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member}(value: string) { return value; } }`,
      ).join('\n'),
      /policy-scope-service/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/policy-scope-service.ts',
      'export class PolicyScopeService { requireAgent(value: string) { return value; } }',
    ),
    [],
  );
});

test('keeps pending ask ownership outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private pendingAsks = new Map(); }',
    ).join('\n'),
    /pending-ask-registry/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/pending-ask-registry.ts',
      'export class PendingAskRegistry { private pendingAsks = new Map(); }',
    ),
    [],
  );
});

test('keeps formal plan revision recovery outside the Runtime facade', () => {
  for (const member of ['formalPlanRevisionByRun', 'formalPlanRevisionForRun']) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member}(value: string) { return value; } }`,
      ).join('\n'),
      /formal-plan-revision-registry/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/formal-plan-revision-registry.ts',
      'export class FormalPlanRevisionRegistry { private formalPlanRevisionByRun = new Map(); }',
    ),
    [],
  );
});

test('keeps scheduled task dispatch state outside the Runtime facade', () => {
  for (const member of ['dispatchedTasks', 'taskIdByRun']) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = new Map(); }`,
      ).join('\n'),
      /scheduled-task-dispatch-registry/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/scheduled-task-dispatch-registry.ts',
      'export class ScheduledTaskDispatchRegistry { private taskIdByRun = new Map(); }',
    ),
    [],
  );
});

test('keeps conversation context amendment state outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private threadContextAmendments = new Map(); }',
    ).join('\n'),
    /conversation-context-amendment-registry/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/conversation-context-amendment-registry.ts',
      'export class ConversationContextAmendmentRegistry { private threadContextAmendments = new Map(); }',
    ),
    [],
  );
});

test('keeps compact boundary recovery outside the Runtime facade', () => {
  for (const member of ['latestCompactByThread', 'resolveLatestCompactBoundary']) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member}(value: string) { return value; } }`,
      ).join('\n'),
      /conversation-compact-boundary-cache/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/conversation-compact-boundary-cache.ts',
      'export class ConversationCompactBoundaryCache { private latestCompactByThread = new Map(); }',
    ),
    [],
  );
});

test('keeps the write-only context run state retired', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private contextRunByThread = new Map(); }',
    ).join('\n'),
    /write-only contextRunByThread/,
  );
});

test('keeps durable tool approval fallback state outside the Runtime facade', () => {
  for (const member of [
    'durableChatToolApprovalStateById',
    'durableChatToolApprovalStates',
    'rememberDurableChatToolApprovalEvent',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member}(value: string) { return value; } }`,
      ).join('\n'),
      /durable-tool-approval-ledger/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/durable-tool-approval-ledger.ts',
      'export class DurableToolApprovalLedger { private durableChatToolApprovalStateById = new Map(); }',
    ),
    [],
  );
});

test('keeps capability usage idempotency outside the Runtime facade', () => {
  for (const member of ['recordedCapabilityUsageKeys', 'appendCapabilityUsageOnce']) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = new Set(); }`,
      ).join('\n'),
      /capability usage idempotency/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/capability-usage-recorder.ts',
      'export class CapabilityUsageRecorder { private recordedKeys = new Set(); }',
    ),
    [],
  );
});

test('keeps assistant timeline fingerprint state outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private assistantTimelineFingerprintsByRun = new Map(); }',
    ).join('\n'),
    /assistant timeline fingerprint state/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/assistant-timeline-change-tracker.ts',
      'export class AssistantTimelineChangeTracker { private committedByRun = new Map(); }',
    ),
    [],
  );
});

test('keeps per-run platform MCP state outside the Runtime facade', () => {
  for (const member of [
    'platformMcpCatalogByRun',
    'platformMcpResultsByRun',
    'capabilityBrokerByRun',
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = new Map(); }`,
      ).join('\n'),
      /per-run platform MCP state/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/platform-mcp-run-registry.ts',
      'export class PlatformMcpRunRegistry { private catalogsByRun = new Map(); }',
    ),
    [],
  );
});

test('keeps scheduled task run state outside the Runtime facade', () => {
  for (const [member, initializer] of [
    ['taskRuns', 'new Set()'],
    ['scheduledTaskRuns', 'new Map()'],
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = ${initializer}; }`,
      ).join('\n'),
      /scheduled task run state/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/scheduled-task-run-registry.ts',
      'export class ScheduledTaskRunRegistry { private activeRunIds = new Set(); }',
    ),
    [],
  );
});

test('keeps in-flight Promise lifecycle state outside the Runtime facade', () => {
  for (const member of ['daemonCompletionPromises', 'backgroundTasks', 'activeKernelRuns']) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = new Set(); }`,
      ).join('\n'),
      /in-flight Promise lifecycle state/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/in-flight-promise-registry.ts',
      'export class InFlightPromiseRegistry { private pending = new Set(); }',
    ),
    [],
  );
});

test('keeps external event execution state outside the Runtime facade', () => {
  for (const [member, initializer] of [
    ['externalEventExecutions', 'new Map()'],
    ['externalEventIdByRun', 'new Map()'],
    ['externalEventCleanupRuns', 'new Set()'],
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = ${initializer}; }`,
      ).join('\n'),
      /external event execution state/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/external-event-execution-registry.ts',
      'export class ExternalEventExecutionRegistry { private executionsByEvent = new Map(); }',
    ),
    [],
  );
});

test('keeps keyed AbortController state outside the Runtime facade', () => {
  for (const member of ['demoRunAborts', 'promptEnhancementAborts']) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = new Map(); }`,
      ).join('\n'),
      /keyed AbortController state/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/abort-controller-registry.ts',
      'export class AbortControllerRegistry { private controllers = new Map(); }',
    ),
    [],
  );
});

test('keeps kernel tool progress state outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private kernelToolProgressByRun = new Map(); }',
    ).join('\n'),
    /kernel tool progress state/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/kernel-tool-progress-registry.ts',
      'export class KernelToolProgressRegistry { private progressByRun = new Map(); }',
    ),
    [],
  );
});

test('keeps keyed turn serialization outside the Runtime facade', () => {
  for (const [member, initializer] of [
    ['externalKernelSessionTails', 'new Map()'],
    ['enqueueExternalKernelSession', '() => undefined'],
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = ${initializer}; }`,
      ).join('\n'),
      /keyed turn serialization/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/keyed-turn-queue.ts',
      'export class KeyedTurnQueue { private tails = new Map(); }',
    ),
    [],
  );
});

test('keeps active run ownership outside the Runtime facade', () => {
  for (const [member, initializer] of [
    ['inFlight', 'new Set()'],
    ['recordInFlight', '() => undefined'],
    ['forgetInFlight', '() => undefined'],
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = ${initializer}; }`,
      ).join('\n'),
      /active run ownership/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/active-run-registry.ts',
      'export class ActiveRunRegistry { private runIds = new Set(); }',
    ),
    [],
  );
});

test('keeps completed delegated run state in one registry', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private completedDelegatedRunStates = new Map(); }',
    ).join('\n'),
    /completed delegated run state/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/completed-delegated-run-registry.ts',
      'export class CompletedDelegatedRunRegistry { private records = new Map(); }',
    ),
    [],
  );
});

test('keeps local Skill watcher lifecycle outside the Runtime facade', () => {
  for (const [member, initializer] of [
    ['localSkillWatchCleanup', '() => undefined'],
    ['localSkillWatchedDirectories', 'new Set()'],
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = ${initializer}; }`,
      ).join('\n'),
      /local Skill watcher lifecycle/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/local-skill-watch-registry.ts',
      'export class LocalSkillWatchRegistry { private cleanups = new Map(); }',
    ),
    [],
  );
});

test('keeps MCP auth configuration persistence outside the Runtime facade', () => {
  for (const [member, initializer] of [
    ['mcpAuthHandles', 'new Map()'],
    ['mcpAuthSettingKey', '() => "mcp.auth.id"'],
    ['readMcpAuthConfig', '() => undefined'],
    ['persistMcpAuth', '() => undefined'],
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = ${initializer}; }`,
      ).join('\n'),
      /MCP auth configuration persistence/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/mcp-auth-config-repository.ts',
      'export class McpAuthConfigRepository { private cache = new Map(); }',
    ),
    [],
  );
});

test('keeps refresh generation coordination in Shared', () => {
  for (const [member, initializer] of [
    ['localSkillRefreshGeneration', '0'],
    ['localSkillRefreshAppliedGeneration', '0'],
    ['localSkillRefreshInFlight', 'undefined'],
  ]) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = ${initializer}; }`,
      ).join('\n'),
      /refresh generation coordination/,
    );
  }
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/refresh-coordinator.ts',
      'export class RefreshCoordinator {}',
    ).join('\n'),
    /shared RefreshCoordinator/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'packages/shared/src/refresh-coordinator.ts',
      'export class RefreshCoordinator { private requestedGeneration = 0; }',
    ),
    [],
  );
});

test('keeps connection-owned stream state outside the Runtime facade', () => {
  for (const member of ['subscriptions', 'transientSubscriptions']) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = new Map(); }`,
      ).join('\n'),
      /connection-owned stream state/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/owned-subscription-registry.ts',
      'export class OwnedSubscriptionRegistry { private subscriptions = new Map(); }',
    ),
    [],
  );
});

test('keeps per-thread transient state outside the Runtime facade', () => {
  for (const member of ['transientSnapshotByThread', 'transientSequenceByThread']) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = new Map(); }`,
      ).join('\n'),
      /per-thread transient state/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/conversation-transient-state-registry.ts',
      'export class ConversationTransientStateRegistry { private stateByThread = new Map(); }',
    ),
    [],
  );
});

test('keeps durable thread-version state outside the Runtime facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/runtime.ts',
      'export class Runtime { private threadVersions = new Map(); }',
    ).join('\n'),
    /durable thread-version state/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/thread-version-projection.ts',
      'export class ThreadVersionProjection { private versions = new Map(); }',
    ),
    [],
  );
});

test('keeps Goal execution state outside the Runtime facade', () => {
  for (const member of ['activeGoals', 'goalRunRevisions', 'pendingGoalTurns']) {
    assert.match(
      checkArchitectureSource(
        'apps/runtime/src/runtime.ts',
        `export class Runtime { private ${member} = new Map(); }`,
      ).join('\n'),
      /Goal execution state/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/goal-execution-state-registry.ts',
      'export class GoalExecutionStateRegistry { private goals = new Map(); }',
    ),
    [],
  );
});

test('keeps kernel session persistence outside the Runtime facade', () => {
  for (const source of [
    'export class Runtime { private kernelConversationSessions = new Map(); }',
    'function parsePersistedKernelConversationSession(value) { return value; }',
  ]) {
    assert.match(
      checkArchitectureSource('apps/runtime/src/runtime.ts', source).join('\n'),
      /kernel session persistence/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/kernel-conversation-session-repository.ts',
      'export class KernelConversationSessionRepository { private sessions = new Map(); }',
    ),
    [],
  );
});

test('keeps Renderer Skill catalog reads behind the shared loader', () => {
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/FeaturePanel.tsx',
      'void api.listSkills({ limit: 500 });',
    ).join('\n'),
    /must use the shared skill-catalog-loader/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/skill-catalog-loader.ts',
      'void source.listSkills({ limit: 500 });',
    ),
    [],
  );
});
test('keeps Renderer MCP catalog reads behind the shared loader', () => {
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/ComposerMcpMenu.tsx',
      'void runtime.listMcpServers({ limit: 100 });',
    ).join('\n'),
    /shared mcp-catalog-loader/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/mcp-catalog-loader.ts',
      'void source.listMcpServers({ limit: 100 });',
    ),
    [],
  );
});
test('keeps delegated projections independent of execution, state and host implementations', () => {
  for (const source of [
    "import type { DemoRunState } from './demo-run.js';",
    "import { Runtime } from './runtime.js';",
    "import { SqliteMessageStore } from '@sync-think/storage';",
    "import { DelegationService } from './delegation-service.js';",
    "import { DelegationExecutionController } from './delegation-execution.js';",
  ]) {
    assert.ok(
      checkArchitectureSource('apps/runtime/src/delegation-projection.ts', source).length > 0,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/delegation-projection.ts',
      "import type { AssistantTurnSegment } from '@sync-think/protocol';",
    ),
    [],
  );
});
for (const name of [
  'service',
  'message-history',
  'legacy-message-history',
  'message-projection',
  'history-query',
]) {
  test(`keeps delegation ${name} independent of host and storage implementations`, () => {
    for (const source of [
      "import type { Runtime } from './runtime.js';",
      "type Run = import('./demo-run.js').DemoRunState;",
      "const storage = await import('@sync-think/storage');",
    ]) {
      assert.match(
        checkArchitectureSource(`apps/runtime/src/delegation-${name}.ts`, source).join('\n'),
        /must use narrow ports/,
      );
    }
  });
}
test('keeps history queries behind record ports and history modules below the facade', () => {
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/delegation-history-query.ts',
      "import { DelegationMessageHistory } from './delegation-message-history.js';",
    ).join('\n'),
    /consume record ports/,
  );
  for (const name of [
    'message-history',
    'legacy-message-history',
    'message-projection',
    'history-query',
  ]) {
    assert.match(
      checkArchitectureSource(
        `apps/runtime/src/delegation-${name}.ts`,
        "export { DelegationService } from './delegation-service.js';",
      ).join('\n'),
      /must not depend on its facade/,
    );
    assert.deepEqual(
      checkArchitectureSource(
        `apps/runtime/src/delegation-${name}.ts`,
        "import type { DelegatedRunRecord } from '@sync-think/shared';",
      ),
      [],
    );
  }
});
test('keeps delegation admission independent of host and infrastructure implementations', () => {
  for (const source of [
    "import type { Runtime } from './runtime.js';",
    "type Run = import('./demo-run.js').DemoRunState;",
    "const storage = require('@sync-think/storage');",
    "import type { ProviderToolCall } from '@sync-think/adapters';",
  ]) {
    assert.match(
      checkArchitectureSource('apps/runtime/src/delegation-admission.ts', source).join('\n'),
      /must use narrow ports/,
    );
  }
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/delegation-admission.ts',
      "import { resolveAgentAssignment } from './collaboration-policy.js';",
    ),
    [],
  );
});
for (const source of [
  "import type { Runtime } from './runtime.js';",
  "type Run = import('./demo-run.js').DemoRunState;",
  "const storage = await import('@sync-think/storage');",
]) {
  test('keeps delegation execution independent: ' + source, () => {
    assert.match(
      checkArchitectureSource('apps/runtime/src/delegation-execution.ts', source).join('\n'),
      /Delegation execution must use narrow ports/,
    );
  });
}
test('accepts delegation execution ports and timeout policy', () => {
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/delegation-execution.ts',
      [
        "import type { RunId } from '@sync-think/shared';",
        "import { BACKGROUND_DELEGATION_IDLE_SECONDS } from './delegation-timeout-policy.js';",
      ].join('\n'),
    ),
    [],
  );
});
for (const source of [
  "import type { RunGraph } from '@sync-think/storage';",
  "type Approval = import('@sync-think/storage').ApprovalRequestRecord;",
  "export type { RunGraph } from '@sync-think/storage';",
  "const storage = await import('@sync-think/storage');",
  "const storage = require('@sync-think/storage');",
  "import type { RunGraph } from '../../../../packages/storage/src/index.js';",
]) {
  test('blocks a storage dependency in scheduling core: ' + source, () => {
    assert.match(checkArchitectureSource(scheduler, source).join('\n'), /injected ports/);
  });
}
test('accepts neutral contracts and locally injected execution interfaces', () => {
  assert.deepEqual(
    checkArchitectureSource(
      scheduler,
      [
        "import { createHash } from 'node:crypto';",
        "import { isStepFenceMismatchError, type RunGraph } from '@sync-think/shared';",
        "import type { SchedulingRepository } from './scheduler-ports.js';",
        "import type { StepExecutor } from './step-executor.js';",
      ].join('\n'),
    ),
    [],
  );
});
test('keeps production step run reads behind a narrow port', () => {
  const executor = 'apps/runtime/src/orchestration/production-step-executor.ts';
  assert.match(
    checkArchitectureSource(
      executor,
      "import type { SqliteOrchestrationStore } from '@sync-think/storage';",
    ).join('\n'),
    /narrow port/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      executor,
      "import type { ProductionStepExecutionRuns } from './production-step-executor-ports.js';",
    ),
    [],
  );
  assert.match(
    checkArchitectureSource(
      'apps/runtime/src/orchestration/production-step-executor-ports.ts',
      "import type { SqliteOrchestrationStore } from '@sync-think/storage';",
    ).join('\n'),
    /injected ports/,
  );
});
test('keeps production step workspace reads behind a minimal projection port', () => {
  const executor = 'apps/runtime/src/orchestration/production-step-executor.ts';
  assert.match(
    checkArchitectureSource(
      executor,
      "import type { SqliteWorkspaceStore } from '@sync-think/storage';",
    ).join('\n'),
    /narrow ports/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      executor,
      "import type { ProductionStepExecutionWorkspaces } from './production-step-executor-ports.js';",
    ),
    [],
  );
});
test('keeps production step agent reads behind a minimal projection port', () => {
  const executor = 'apps/runtime/src/orchestration/production-step-executor.ts';
  assert.match(
    checkArchitectureSource(
      executor,
      "import type { SqliteAgentStore } from '@sync-think/storage';",
    ).join('\n'),
    /narrow ports/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      executor,
      "import type { ProductionStepExecutionAgents } from './production-step-executor-ports.js';",
    ),
    [],
  );
});
test('keeps production step provider reads behind minimal catalog and credential ports', () => {
  const executor = 'apps/runtime/src/orchestration/production-step-executor.ts';
  assert.match(
    checkArchitectureSource(
      executor,
      "import type { SqliteProviderStore } from '@sync-think/storage';",
    ).join('\n'),
    /narrow ports/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      executor,
      "import type { ProductionStepExecutionProviders } from './production-step-executor-ports.js';",
    ),
    [],
  );
});
test('keeps production step skill reads behind authorization and prompt-source ports', () => {
  const executor = 'apps/runtime/src/orchestration/production-step-executor.ts';
  assert.match(
    checkArchitectureSource(
      executor,
      "import type { SqliteSkillStore } from '@sync-think/storage';",
    ).join('\n'),
    /narrow ports/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      executor,
      "import type { ProductionStepExecutionSkills } from './production-step-executor-ports.js';",
    ),
    [],
  );
});
test('keeps production step Agent Context epochs behind their lifecycle port', () => {
  const executor = 'apps/runtime/src/orchestration/production-step-executor.ts';
  assert.match(
    checkArchitectureSource(
      executor,
      "import type { SqliteAgentContextStore } from '@sync-think/storage';",
    ).join('\n'),
    /narrow ports/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      executor,
      "import type { ProductionStepExecutionAgentContexts } from './production-step-executor-ports.js';",
    ),
    [],
  );
});
test('keeps production provider reservations behind their lifecycle port', () => {
  const executor = 'apps/runtime/src/orchestration/production-step-executor.ts';
  assert.match(
    checkArchitectureSource(
      executor,
      "import type { SqliteProductionExecutionStore } from '@sync-think/storage';",
    ).join('\n'),
    /narrow ports/,
  );
  assert.deepEqual(
    checkArchitectureSource(
      executor,
      "import type { ProductionStepExecutionReservations } from './production-step-executor-ports.js';",
    ),
    [],
  );
});
test('keeps concrete dependencies available at the production composition boundary', () => {
  assert.deepEqual(
    checkArchitectureSource(
      'apps/runtime/src/persistence.ts',
      "import { SqliteOrchestrationStore } from '@sync-think/storage';",
    ),
    [],
  );
});
test('keeps delegated-run projection inside the owning event transaction', () => {
  const file = 'packages/storage/src/runtime-state-store.ts';
  assert.match(
    checkArchitectureSource(file, 'projection.projectEvents(events);').join('\n'),
    /transaction-bound projections/,
  );
  assert.deepEqual(
    checkArchitectureSource(file, 'projection.projectEventsInTransaction(events);'),
    [],
  );
});
test('normalizes Windows paths and reports the violating source line', () => {
  const errors = checkArchitectureSource(
    scheduler.replaceAll('/', '\\'),
    "// comment\nimport type { RunGraph } from '@sync-think/storage';",
  );
  assert.match(errors[0], /scheduler\.ts:2:/);
});
test('checks dynamic domain imports and inline UI type imports', () => {
  assert.match(
    checkArchitectureSource(
      'packages/core/src/policy.ts',
      "const module = await import('@sync-think/storage');",
    ).join('\n'),
    /Domain code/,
  );
  assert.match(
    checkArchitectureSource(
      'apps/desktop/src/renderer/shell/helper.ts',
      "type Item = import('./ChatView.js').InlineProcessItem;",
    ).join('\n'),
    /conversation-types/,
  );
});
test('ignores dependency-like strings that are documentation data', () => {
  assert.deepEqual(
    checkArchitectureSource(
      scheduler,
      'const example = "import type { RunGraph } from \'@sync-think/storage\'";',
    ),
    [],
  );
});
