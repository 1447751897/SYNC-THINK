import { expect, it } from 'vitest';
import { skillApprovalTools } from './skill-approval-tools.js';
it.each([
  ['allowed-tools: ["read_file", "write_file"]', ['read_file', 'write_file']],
  [`allowed-tools: '["read_file", "write_file"]'`,  ['read_file', 'write_file']],
  ['allowedtools: read_file', ['read_file']],
  ['allowedtools: ["write_file"]\nallowed-tools: ["read_file"]', ['read_file']],
  ['allowed-tools: ["read_file"]\nallowedtools: ["write_file"]', ['read_file']],
  ['allowed-tools: []', []],
])('previews the core parser inline declaration form %s', (declaration, expected) => {
  expect(skillApprovalTools({ approvalId: 'skill', toolName: 'update_skill', title: '', detail: '', arguments: { skillMd: '---\nname: skill\nversion: 1.0.0\n' + declaration + '\n---\nbody' } })).toEqual(expected);
});
