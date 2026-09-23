import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTHOR_SKILL_MARKET_ITEMS } from '@sync-think/protocol/skill-market-catalog';
import { installLocalSkillFolders } from '../src/local-skill-discovery.js';
import { listAuthorSkillMarket, resolveAuthorSkillMarketPackage } from '../src/skill-market.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('author Skill market', () => {
  it('publishes installable author capabilities with stable metadata', () => {
    const items = listAuthorSkillMarket();

    expect(items).toEqual(AUTHOR_SKILL_MARKET_ITEMS);
  });

  it('materializes and installs the complete package instead of only importing SKILL.md text', async () => {
    const destination = mkdtempSync(join(tmpdir(), 'sync-think-market-destination-'));
    tempDirs.push(destination);
    const resolved = await resolveAuthorSkillMarketPackage('project-bootstrap');

    try {
      const result = installLocalSkillFolders(resolved.skills, destination, false);
      const installed = result.installed[0]!;

      expect(result.conflictNames).toEqual([]);
      expect(readFileSync(installed.installedSkillMdPath, 'utf8')).toContain(
        'name: project-bootstrap',
      );
      expect(
        existsSync(join(installed.installedDirectory, 'references', 'acceptance-checklist.md')),
      ).toBe(true);
    } finally {
      resolved.cleanup();
    }
  });
});
