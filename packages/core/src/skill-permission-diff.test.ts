import { describe, expect, it } from 'vitest';
import {
  diffSkillPermissions,
  formatSkillPermissionDiffLabel,
} from './skill-permission-diff.js';

describe('diffSkillPermissions (§9.3 reapproval)', () => {
  it('first import does not require reapproval', () => {
    const diff = diffSkillPermissions(null, {
      version: '0.1.0',
      allowedTools: ['read-file'],
      hasScripts: false,
    });
    expect(diff.requiresReapproval).toBe(false);
    expect(diff.addedTools).toEqual(['read-file']);
    expect(diff.summary).toMatch(/first import/i);
  });

  it('added tools require reapproval', () => {
    const diff = diffSkillPermissions(
      { version: '0.1.0', allowedTools: ['read-file'], hasScripts: false },
      { version: '0.2.0', allowedTools: ['read-file', 'write-fs'], hasScripts: false },
    );
    expect(diff.requiresReapproval).toBe(true);
    expect(diff.addedTools).toEqual(['write-fs']);
    expect(diff.removedTools).toEqual([]);
    expect(diff.unchangedTools).toEqual(['read-file']);
    expect(diff.summary).toMatch(/reapproval required/i);
    expect(formatSkillPermissionDiffLabel(diff)).toMatch(/重新批准/);
  });

  it('scripts appearing require reapproval', () => {
    const diff = diffSkillPermissions(
      { version: '0.1.0', allowedTools: [], hasScripts: false },
      { version: '0.2.0', allowedTools: [], hasScripts: true },
    );
    expect(diff.requiresReapproval).toBe(true);
    expect(diff.scriptsAdded).toBe(true);
  });

  it('removing tools does not require reapproval', () => {
    const diff = diffSkillPermissions(
      { version: '0.2.0', allowedTools: ['read-file', 'write-fs'], hasScripts: true },
      { version: '0.3.0', allowedTools: ['read-file'], hasScripts: false },
    );
    expect(diff.requiresReapproval).toBe(false);
    expect(diff.removedTools).toEqual(['write-fs']);
    expect(diff.scriptsRemoved).toBe(true);
    expect(diff.summary).toMatch(/narrowed/i);
  });

  it('identical tools unchanged', () => {
    const diff = diffSkillPermissions(
      { version: '0.1.0', allowedTools: ['read-file'], hasScripts: false },
      { version: '0.1.1', allowedTools: ['read-file'], hasScripts: false },
    );
    expect(diff.requiresReapproval).toBe(false);
    expect(diff.addedTools).toEqual([]);
    expect(diff.summary).toMatch(/unchanged/i);
  });
});
