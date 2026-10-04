/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { automationFormError } from './AutomationBindings.js';
describe('editor follows the host acceptance contract', () => {
  it.each([
    { minimumRows: 10001 },
    { minimumSlides: 101 },
    { requiredColumns: ['date', ' date '] },
    { requiredColumns: new Array(129).fill('column') },
  ])('blocks out-of-range or duplicate checks %j', (acceptanceChecks) => {
    expect(
      automationFormError({ outputs: ['spreadsheet', 'presentation'], acceptanceChecks }),
    ).toBeTruthy();
  });
  it('allows supported limits and clearing the optional checks', () => {
    expect(
      automationFormError({
        outputs: ['spreadsheet', 'presentation'],
        acceptanceChecks: { minimumRows: 10000, minimumSlides: 100 },
      }),
    ).toBeNull();
    expect(automationFormError({ outputs: ['spreadsheet'] })).toBeNull();
  });
});
