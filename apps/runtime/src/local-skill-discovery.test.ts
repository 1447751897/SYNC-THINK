import { describe, expect, it } from 'vitest';
import { frontmatterOf } from './local-skill-discovery.js';

describe('local Skill frontmatter discovery', () => {
  it('reads folded descriptions as text instead of the YAML marker', () => {
    const metadata = frontmatterOf(`---
name: folded-local-skill
description: >
  第一行说明
  第二行说明
---
# Body
`);

    expect(metadata.name).toBe('folded-local-skill');
    expect(metadata.description).toBe('第一行说明 第二行说明');
    expect(metadata.description).not.toBe('>');
  });

  it('normalizes quoted description values', () => {
    const metadata = frontmatterOf(`---
name: quoted-local-skill
description: "Quoted description"
---
# Body
`);

    expect(metadata.description).toBe('Quoted description');
  });
});
