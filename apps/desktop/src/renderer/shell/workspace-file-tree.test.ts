import { describe, expect, it } from 'vitest';
import {
  buildConversationFileTree,
  collectConversationDirPaths,
  conversationFileStatus,
  projectRelativePath,
} from './workspace-file-tree.js';

describe('conversation file tree', () => {
  it('nests conversation files under project-relative folders', () => {
    const tree = buildConversationFileTree(
      [
        { path: 'D:/projects/mail-helper/README.md', action: 'edited' },
        { path: 'D:/projects/mail-helper/backend/main.py', action: 'edited' },
        { path: 'D:/projects/mail-helper/backend/code_extractor.py', action: 'created' },
        { path: 'D:/projects/mail-helper/frontend/index.html', action: 'deleted' },
        { path: 'run.py', action: 'edited' },
      ],
      'D:/projects/mail-helper',
    );

    expect(tree.map((node) => node.name)).toEqual(['backend', 'frontend', 'README.md', 'run.py']);
    const backend = tree[0];
    expect(backend).toMatchObject({ kind: 'dir', path: 'backend' });
    if (backend.kind !== 'dir') throw new Error('expected backend directory');
    expect(backend.children.map((node) => `${node.name}:${node.kind === 'file' ? node.action : 'dir'}`)).toEqual([
      'code_extractor.py:created',
      'main.py:edited',
    ]);
    expect(conversationFileStatus('created')).toBe('A');
    expect(conversationFileStatus('edited')).toBe('M');
    expect(conversationFileStatus('deleted')).toBe('D');
    expect(collectConversationDirPaths(tree)).toEqual(['backend', 'frontend']);
  });

  it('strips the bound project folder from Windows and posix paths', () => {
    expect(projectRelativePath('D:\\projects\\mail-helper\\backend\\main.py', 'D:/projects/mail-helper')).toBe(
      'backend/main.py',
    );
    expect(projectRelativePath('/tmp/app/src/index.ts', '/tmp/app')).toBe('src/index.ts');
  });
});
