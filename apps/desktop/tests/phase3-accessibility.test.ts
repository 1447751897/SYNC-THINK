import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/renderer/shell/shell.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../src/renderer/shell/tokens.css', import.meta.url), 'utf8');
const trace = readFileSync(
  new URL('../src/renderer/shell/ExecutionProcessBlock.tsx', import.meta.url),
  'utf8',
);
const diagnostics = readFileSync(
  new URL('../src/renderer/shell/SettingsPage.tsx', import.meta.url),
  'utf8',
);
const onboarding = readFileSync(
  new URL('../src/renderer/shell/FirstLaunchGuide.tsx', import.meta.url),
  'utf8',
);
const entry = readFileSync(
  new URL('../src/renderer/shell/shell-entry.tsx', import.meta.url),
  'utf8',
);
const qaEntry = readFileSync(
  new URL('../src/renderer/shell/qa-entry.tsx', import.meta.url),
  'utf8',
);

describe('Phase 3 accessibility contract', () => {
  it('keeps trace disclosure, diagnostics announcements, and current-step semantics explicit', () => {
    expect(trace).toContain('aria-expanded={open}');
    expect(diagnostics).toContain('aria-live="polite"');
    expect(diagnostics).toContain("role={feedback.tone === 'error' ? 'alert' : 'status'}");
    expect(diagnostics).toContain("tone: 'working' | 'success' | 'error'");
    expect(onboarding).toContain('className="sr-only"');
    expect(onboarding).toContain('aria-label=');
  });

  it('has keyboard focus, reduced-motion, responsive, and light/dark contracts', () => {
    expect((css.match(/:focus-visible/g) ?? []).length).toBeGreaterThanOrEqual(12);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('[data-reduced-motion] *');
    expect(css).toContain('@media (max-width: 820px)');
    expect(css).toContain('@media (max-width: 560px)');
    expect(css).toContain(':root {');
    // The palette lives in the generated tokens.css that shell.css imports, so the
    // light/dark contract is asserted there — shell.css only consumes the vars.
    expect(css).toContain("@import './tokens.css';");
    expect(tokens).toContain('@theme {');
    expect(tokens).toContain('.dark {');
    expect(tokens).toContain('--color-text:');
    expect(tokens).toContain('--color-accent:');
  });

  it('isolates visual evidence behind an explicit query route and disables motion', () => {
    expect(entry).not.toContain('Phase3VisualFixture');
    expect(qaEntry).toContain('resolvePhase3VisualCase(window.location.search)');
    expect(qaEntry).toMatch(
      /document\.documentElement\.toggleAttribute\(\s*'data-reduced-motion',\s*params\.get\('motion'\) !== 'full'/,
    );
    expect(qaEntry).toContain("theme === 'dark'");
  });
});
