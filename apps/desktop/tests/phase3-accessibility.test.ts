import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/renderer/shell/shell.css', import.meta.url), 'utf8');
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

describe('Phase 3 accessibility contract', () => {
  it('keeps trace disclosure, diagnostics announcements, and current-step semantics explicit', () => {
    expect(trace).toContain('aria-expanded={open}');
    expect(diagnostics).toContain('aria-live="polite"');
    expect(diagnostics).toContain("role={status?.role}");
    expect(diagnostics).toContain("role: 'alert' as const");
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
    expect(css).toContain('.dark {');
    expect(css).toContain('--color-text:');
    expect(css).toContain('--color-accent:');
  });

  it('isolates visual evidence behind an explicit query route and disables motion', () => {
    expect(entry).toContain("resolvePhase3VisualCase(window.location.search)");
    expect(entry).toContain("document.documentElement.setAttribute('data-reduced-motion', '')");
    expect(entry).toContain("fixtureTheme === 'dark'");
  });
});
