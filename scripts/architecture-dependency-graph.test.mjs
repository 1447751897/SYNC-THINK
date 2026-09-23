import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSourceDependencyGraph,
  checkSourceDependencyCycles,
  collectModuleSpecifiers,
  findSourceDependencyCycles,
} from './architecture-dependency-graph.mjs';

test('collects static, type, re-export and dynamic dependencies', () => {
  assert.deepEqual(
    collectModuleSpecifiers(
      'src/a.ts',
      [
        "import value from './value.js';",
        "import type { Model } from './model.js';",
        "export { shared } from './shared.js';",
        "type Lazy = import('./lazy.js').Lazy;",
        "const dynamic = import('./dynamic.js');",
        "const legacy = require('./legacy.cjs');",
      ].join('\n'),
    ).sort(),
    ['./dynamic.js', './lazy.js', './legacy.cjs', './model.js', './shared.js', './value.js'],
  );
});

test('resolves emitted extensions, directory indexes and workspace aliases', () => {
  const sources = new Map([
    [
      'apps/demo/src/a.ts',
      "import './b.js'; import './feature'; import { value } from '@sync-think/shared';",
    ],
    ['apps/demo/src/b.tsx', 'export const b = true;'],
    ['apps/demo/src/feature/index.ts', 'export const feature = true;'],
    ['packages/shared/src/index.ts', 'export const value = true;'],
  ]);
  const graph = buildSourceDependencyGraph(
    sources,
    new Map([['@sync-think/shared', 'packages/shared/src/index.ts']]),
  );
  assert.deepEqual([...graph.get('apps/demo/src/a.ts')].sort(), [
    'apps/demo/src/b.tsx',
    'apps/demo/src/feature/index.ts',
    'packages/shared/src/index.ts',
  ]);
});

test('reports deterministic representative paths for source dependency cycles', () => {
  const graph = new Map([
    ['src/a.ts', new Set(['src/b.ts'])],
    ['src/b.ts', new Set(['src/c.ts'])],
    ['src/c.ts', new Set(['src/a.ts'])],
    ['src/self.ts', new Set(['src/self.ts'])],
  ]);
  assert.deepEqual(findSourceDependencyCycles(graph), [
    ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/a.ts'],
    ['src/self.ts', 'src/self.ts'],
  ]);
});

test('accepts an acyclic source graph and flags a cycle through a package entry', () => {
  const sources = new Map([
    ['apps/demo/src/main.ts', "import { value } from '@sync-think/shared';"],
    ['packages/shared/src/index.ts', "export { value } from './value.js';"],
    ['packages/shared/src/value.ts', 'export const value = true;'],
  ]);
  const aliases = new Map([['@sync-think/shared', 'packages/shared/src/index.ts']]);
  assert.deepEqual(checkSourceDependencyCycles(sources, aliases), []);
  sources.set('packages/shared/src/value.ts', "import '../../../apps/demo/src/main.js';");
  assert.match(checkSourceDependencyCycles(sources, aliases).join('\n'), /Circular source dependency/);
});
