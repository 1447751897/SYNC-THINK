/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AbilitiesPage } from './AbilitiesPage.js';

const runtime = {
  listSkills: vi.fn(),
  importSkill: vi.fn(),
  deleteSkill: vi.fn(),
};

beforeEach(() => {
  runtime.listSkills.mockReset().mockResolvedValue({ skills: [] });
  runtime.importSkill.mockReset();
  runtime.deleteSkill.mockReset().mockResolvedValue({ deleted: true, skillVersionId: 'sv-1' });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AbilitiesPage', () => {
  it('imports pasted SKILL.md and refreshes the catalog', async () => {
    const source = '---\nname: review\nversion: 0.1.0\n---\n\nReview carefully.';
    runtime.importSkill.mockResolvedValue({
      skill: {
        skillVersionId: 'sv-1',
        skillId: 'skill-review',
        name: 'review',
        description: 'Review carefully',
        version: '0.1.0',
        allowedTools: [],
        contentFingerprint: 'abc12345',
        hasScripts: false,
        warnings: [],
        createdAt: '2026-07-26T00:00:00.000Z',
      },
      deduped: false,
    });
    runtime.listSkills
      .mockResolvedValueOnce({ skills: [] })
      .mockResolvedValueOnce({
        skills: [
          {
            skillVersionId: 'sv-1',
            skillId: 'skill-review',
            name: 'review',
            description: 'Review carefully',
            version: '0.1.0',
            allowedTools: [],
            contentFingerprint: 'abc12345',
            hasScripts: false,
            warnings: [],
            createdAt: '2026-07-26T00:00:00.000Z',
          },
        ],
      });
    const changed = vi.fn();

    render(<AbilitiesPage onGoToAgents={vi.fn()} onCatalogChanged={changed} />);
    await waitFor(() => expect(screen.getByText('能力库还是空的')).toBeTruthy());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.change(screen.getByTestId('skill-md-input'), { target: { value: source } });
    fireEvent.click(screen.getByTestId('import-skill-submit'));

    await waitFor(() => expect(runtime.importSkill).toHaveBeenCalledWith({ skillMd: source }));
    await waitFor(() => expect(screen.getAllByText('review').length).toBeGreaterThan(0));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('shows an actionable error instead of an empty library when list fails', async () => {
    runtime.listSkills.mockRejectedValue(new Error('pipe unavailable'));
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('能力库加载失败')).toBeTruthy());
    expect(screen.getByText('pipe unavailable')).toBeTruthy();
  });
});
