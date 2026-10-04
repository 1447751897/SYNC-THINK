import { describe, expect, it } from 'vitest';
import { parseScheduledTaskAutomation } from './types/scheduled-task.js';
describe('scheduled business acceptance wire contract', () => {
  it('retains normalized checks only with their declared output formats', () => {
    expect(
      parseScheduledTaskAutomation({
        outputs: ['spreadsheet', 'presentation'],
        acceptanceChecks: {
          minimumRows: 3,
          requiredColumns: [' date '],
          dateColumn: 'date',
          sourceUrlColumn: 'source',
          minimumSlides: 2,
        },
      }),
    ).toMatchObject({
      acceptanceChecks: {
        minimumRows: 3,
        requiredColumns: ['date'],
        dateColumn: 'date',
        sourceUrlColumn: 'source',
        minimumSlides: 2,
      },
    });
  });
  it.each([
    { minimumRows: 1 },
    { requiredColumns: ['date'] },
    { dateColumn: 'date' },
    { sourceUrlColumn: 'source' },
    { minimumSlides: 1 },
  ])('rejects orphan checks %j', (acceptanceChecks) => {
    expect(parseScheduledTaskAutomation({ acceptanceChecks })).toBeUndefined();
  });
  it('rejects empty or unsupported checks', () => {
    expect(
      parseScheduledTaskAutomation({ outputs: ['spreadsheet'], acceptanceChecks: {} }),
    ).toBeUndefined();
    expect(
      parseScheduledTaskAutomation({
        outputs: ['spreadsheet'],
        acceptanceChecks: { minimumSlides: 1 },
      }),
    ).toBeUndefined();
  });
});
