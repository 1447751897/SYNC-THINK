import { describe, expect, it, vi } from 'vitest';
import {
  canCloseSettings,
  decideSettingsPageAction,
  SETTINGS_CLOSE_DISCARD_MESSAGE,
  SETTINGS_SECTION_DISCARD_MESSAGE,
} from './settings-unsaved.js';

describe('settings unsaved-change guards', () => {
  it('keeps the current category when discarding a dirty model form is cancelled', () => {
    const confirmDiscard = vi.fn(() => false);

    const decision = decideSettingsPageAction(
      {
        kind: 'select-section',
        currentSection: 'models',
        nextSection: 'theme',
      },
      true,
      confirmDiscard,
    );

    expect(decision).toEqual({ kind: 'stay' });
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(confirmDiscard).toHaveBeenCalledWith(SETTINGS_SECTION_DISCARD_MESSAGE);
  });

  it('switches category and clears dirty state after discard is confirmed', () => {
    const confirmDiscard = vi.fn(() => true);

    const decision = decideSettingsPageAction(
      {
        kind: 'select-section',
        currentSection: 'models',
        nextSection: 'theme',
      },
      true,
      confirmDiscard,
    );

    expect(decision).toEqual({
      kind: 'select-section',
      section: 'theme',
      discardChanges: true,
    });
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
  });

  it('does not confirm when selecting the current category or switching a clean page', () => {
    const confirmDiscard = vi.fn(() => true);

    expect(
      decideSettingsPageAction(
        {
          kind: 'select-section',
          currentSection: 'models',
          nextSection: 'models',
        },
        true,
        confirmDiscard,
      ),
    ).toEqual({ kind: 'stay' });
    expect(
      decideSettingsPageAction(
        {
          kind: 'select-section',
          currentSection: 'models',
          nextSection: 'theme',
        },
        false,
        confirmDiscard,
      ),
    ).toEqual({
      kind: 'select-section',
      section: 'theme',
      discardChanges: false,
    });
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it('delegates dirty completion without confirming at page level', () => {
    const confirmDiscard = vi.fn(() => true);

    expect(decideSettingsPageAction({ kind: 'done' }, true, confirmDiscard)).toEqual({
      kind: 'request-close',
    });
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it('keeps a dirty modal open when close confirmation is cancelled', () => {
    const confirmDiscard = vi.fn(() => false);

    expect(canCloseSettings(true, confirmDiscard)).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(confirmDiscard).toHaveBeenCalledWith(SETTINGS_CLOSE_DISCARD_MESSAGE);
  });

  it('closes a dirty modal after one confirmation and closes a clean modal silently', () => {
    const confirmDiscard = vi.fn(() => true);

    expect(canCloseSettings(true, confirmDiscard)).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledTimes(1);

    confirmDiscard.mockClear();
    expect(canCloseSettings(false, confirmDiscard)).toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it('asks exactly once across the dirty completion flow', () => {
    const confirmDiscard = vi.fn(() => true);
    const pageDecision = decideSettingsPageAction({ kind: 'done' }, true, confirmDiscard);

    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(pageDecision.kind).toBe('request-close');
    expect(canCloseSettings(true, confirmDiscard)).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
  });
});
