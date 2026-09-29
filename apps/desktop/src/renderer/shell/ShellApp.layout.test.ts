import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shellCss = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('./ShellApp.tsx', import.meta.url), 'utf8');

describe('shell workspace viewport containment', () => {
  it.each(['shell-normal-workspace', 'shell-agent-chat-mode'])(
    'keeps %s in the viewport flex chain using the core shell stylesheet',
    (className) => {
      expect(shellSource).toContain('className="' + className + '"');
      const rule = shellCss.match(new RegExp('\\.' + className + '\\b[^{}]*\\{([^}]+)\\}'))?.[1];
      expect(rule).toBeDefined();
      expect(rule).toMatch(/display:\s*flex\s*;/);
      expect(rule).toMatch(/flex:\s*1(?:\s+1\s+0(?:%|px)?)?\s*;/);
      expect(rule).toMatch(/min-height:\s*0\s*;/);
      expect(rule).toMatch(/min-width:\s*0\s*;/);
      expect(rule).toMatch(/overflow:\s*hidden\s*;/);
    },
  );

  it.each(['shell-normal-workspace', 'shell-agent-chat-mode'])(
    'removes inactive %s from layout when switching workspaces',
    (className) => {
      const rule = shellCss.match(new RegExp('\\.' + className + '\\[hidden\\][^{}]*\\{([^}]+)\\}'))?.[1];
      expect(rule).toMatch(/display:\s*none(?:\s*!important)?\s*;/);
    },
  );
});
