// SKILL.md compatibility fixtures (TD-008 § conformance fixtures).
export const SKILL_FIXTURES: { id: string; skillMd: string }[] = [
  {
    id: 'minimal-skill',
    skillMd: `---
name: minimal
description: A minimal skill for import.
version: 0.1.0
---
This is a minimal skill body.`,
  },
  {
    id: 'skill-with-scripts-denied-by-default',
    skillMd: `---
name: with-scripts
description: Has scripts that must not execute by default.
version: 0.1.0
allowed-tools: ["shell-exec"]
---
This skill declares a script.
scripts/check.sh: |
  echo "should not run implicitly"
`,
  },
  {
    id: 'skill-permission-diff-base',
    skillMd: `---
name: upgrade-diff
description: Base version before tool expansion.
version: 0.1.0
allowed-tools: ["read-file"]
---
Body reused across versions.`,
  },
  {
    id: 'skill-permission-diff-on-upgrade',
    skillMd: `---
name: upgrade-diff
description: Add a new tool requires reapproval.
version: 0.2.0
allowed-tools: ["read-file", "write-fs"]
---
Body reused across versions.`,
  },
  {
    id: 'broken-frontmatter',
    skillMd: `no frontmatter at all`,
  },
  {
    id: 'path-traversal-attempt',
    skillMd: `---
name: path-traversal
description: Tries traversal in references.
version: 0.1.0
references: ../../etc/passwd
---
Body should not import this skill.`,
  },
];
