import { describe, expect, it } from 'vitest';
import { parseUiDesignArtifact, parseUiDesignJson } from './ui-design.js';

describe('ui design artifact', () => {
  it('accepts the compact NewMax-style surface schema', () => {
    const artifact = parseUiDesignJson(`\n\`\`\`design-ui
{"version":1,"type":"ui-design","title":"工作台","sidebar":{"items":[{"label":"概览","active":true}]},"nodes":[{"type":"metric","label":"任务","value":"12"},{"type":"table","columns":["名称","状态"],"rows":[["同步","运行中"]]}]}
\`\`\``);
    expect(artifact?.title).toBe('工作台');
    expect(artifact?.nodes).toHaveLength(2);
  });

  it('rejects malformed and oversized artifacts', () => {
    expect(parseUiDesignArtifact({ version: 1, type: 'ui-design', title: 'x', nodes: [{ type: 'unknown' }] })).toBeUndefined();
    expect(parseUiDesignArtifact({ version: 1, type: 'ui-design', title: 'x', nodes: new Array(41).fill({ type: 'text', text: 'x' }) })).toBeUndefined();
  });
});
