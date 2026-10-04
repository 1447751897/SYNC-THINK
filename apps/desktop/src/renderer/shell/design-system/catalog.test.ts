import { describe, expect, it } from 'vitest';
import {
  COMPONENT_SECTIONS,
  DOCUMENTED_COMPONENTS,
  filterComponents,
  readLibraryRoute,
  routeHash,
  type LibraryRoute,
} from './catalog.js';
import { COMPONENT_CATALOG } from './catalog.generated.js';
describe('component documentation taxonomy', () => {
  it('classifies every current source once, without duplicate or stale metadata', () => {
    const names = COMPONENT_SECTIONS.flatMap((s) => s.members.map((m) => m[0]));
    const current = COMPONENT_CATALOG.filter((c) => !c.legacy);
    expect(current.every(c => c.live)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(current.map((c) => c.name).sort());
    expect(DOCUMENTED_COMPONENTS.filter((c) => c.section === 'unsorted')).toEqual([]);
    expect(new Set(DOCUMENTED_COMPONENTS.map((c) => c.id)).size).toBe(COMPONENT_CATALOG.length);
    expect(DOCUMENTED_COMPONENTS.filter((c) => c.section === 'legacy').every((c) => c.legacy)).toBe(
      true,
    );
  });
  it('searches descriptions, display names, file paths and scopes live examples', () => {
    expect(filterComponents('多行编辑').map((c) => c.name)).toEqual(['ComposerEditor']);
    expect(filterComponents('prompt input').map((c) => c.name)).toEqual(['ComposerEditor']);
    expect(filterComponents('shell/CodeBlockButton.tsx').map((c) => c.name)).toEqual([
      'CodeBlockButton',
    ]);
    expect(filterComponents('', 'conversation')[0].name).toBe('ComposerEditor');
    expect(filterComponents('', undefined, true)).toHaveLength(125);
    expect(filterComponents('', 'legacy')).toHaveLength(23);
  });
  it('round-trips every category and component deep link and rejects malformed routes', () => {
    const routes: LibraryRoute[] = [
      { view: 'overview' },
      { view: 'tokens' },
      { view: 'live' },
      ...COMPONENT_SECTIONS.filter((s) => s.id !== 'unsorted').map((s) => ({
        view: 'category' as const,
        section: s.id,
      })),
      ...DOCUMENTED_COMPONENTS.map((c) => ({ view: 'component' as const, id: c.id })),
    ];
    for (const route of routes) expect(readLibraryRoute(routeHash(route))).toEqual(route);
    for (const hash of [
      '',
      '#outside',
      '#ds/component/%ZZ',
      '#ds/component/nope',
      '#ds/category/nope',
    ])
      expect(readLibraryRoute(hash)).toEqual({ view: 'overview' });
  });
});
