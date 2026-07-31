/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GlobalAgent } from '@sync-think/shared';
import type { SkillVersionSummary } from '@sync-think/protocol';
import { TurnSkillControl } from './TurnSkillControl.js';

const runtime = {
  listSkills: vi.fn(),
  getSkill: vi.fn(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function skill(skillVersionId: string, version = '1.0.0'): SkillVersionSummary {
  return {
    skillVersionId,
    skillId: `family-${skillVersionId}`,
    name: skillVersionId.startsWith('review') ? 'review' : skillVersionId,
    description: `Description ${skillVersionId}`,
    version,
    allowedTools: [],
    contentFingerprint: `fingerprint-${skillVersionId}`,
    hasScripts: false,
    warnings: [],
    createdAt: '2026-07-29T00:00:00.000Z',
  };
}

function owner(id: string, skillIds: string[]): GlobalAgent {
  return { id, name: id, skillIds } as unknown as GlobalAgent;
}

function Harness(props: { owner?: GlobalAgent }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <TurnSkillControl
      owner={props.owner}
      open={open}
      selectedSkillVersionIds={selected}
      onOpenChange={setOpen}
      onChange={setSelected}
    />
  );
}

beforeEach(() => {
  runtime.listSkills.mockReset();
  runtime.getSkill.mockReset();
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('TurnSkillControl', () => {
  it('loads metadata only after first open and filters exact versions in allowlist order', async () => {
    const pending = deferred<{ skills: SkillVersionSummary[] }>();
    runtime.listSkills.mockReturnValue(pending.promise);
    render(<Harness owner={owner('agent-a', ['review-v2', 'review-v1'])} />);

    expect(runtime.listSkills).not.toHaveBeenCalled();
    expect(runtime.getSkill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    expect(runtime.listSkills).toHaveBeenCalledWith({
      skillVersionIds: ['review-v2', 'review-v1'],
    });
    expect(screen.getByText('当前会话临时设置')).toBeTruthy();
    expect(runtime.getSkill).not.toHaveBeenCalled();
    expect(await screen.findByText('正在加载 Skill…')).toBeTruthy();

    await act(async () => {
      pending.resolve({
        skills: [skill('other'), skill('review-v1', '1.0.0'), skill('review-v2', '2.0.0')],
      });
      await pending.promise;
    });

    const options = await screen.findAllByRole('menuitemcheckbox');
    expect(options.map((option) => option.getAttribute('data-testid'))).toEqual([
      'turn-skill-option-review-v2',
      'turn-skill-option-review-v1',
    ]);
    expect(options[0]?.textContent).toContain('@2.0.0');
    expect(options[1]?.textContent).toContain('@1.0.0');

    fireEvent.click(options[0]!);
    fireEvent.click(options[1]!);
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('2/8');

    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    expect(runtime.listSkills).toHaveBeenCalledTimes(1);
    expect(runtime.getSkill).not.toHaveBeenCalled();
  });

  it('shows errors with retry and then the equipped-empty state', async () => {
    runtime.listSkills
      .mockRejectedValueOnce(new Error('metadata pipe unavailable'))
      .mockResolvedValueOnce({ skills: [skill('not-equipped')] });
    render(<Harness owner={owner('agent-a', ['missing-version'])} />);

    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    expect((await screen.findByRole('alert')).textContent).toContain('metadata pipe unavailable');

    fireEvent.click(screen.getByTestId('turn-skill-retry'));
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('当前智能体未装备 Skill')).toBeTruthy();
    expect(runtime.getSkill).not.toHaveBeenCalled();
  });

  it('caps selection at eight while allowing selected items to be removed and replaced', async () => {
    const ids = Array.from({ length: 9 }, (_, index) => `skill-${index + 1}`);
    runtime.listSkills.mockResolvedValue({ skills: ids.map((id) => skill(id)) });
    render(<Harness owner={owner('agent-a', ids)} />);

    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    await screen.findByTestId('turn-skill-option-skill-9');
    for (const id of ids.slice(0, 8)) {
      fireEvent.click(screen.getByTestId(`turn-skill-option-${id}`));
    }

    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('8/8');
    expect((screen.getByTestId('turn-skill-option-skill-9') as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByTestId('turn-skill-option-skill-1'));
    expect((screen.getByTestId('turn-skill-option-skill-9') as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByTestId('turn-skill-option-skill-9'));
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('8/8');

    fireEvent.click(screen.getByLabelText('清除本轮 Skill'));
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8');
  });

  it('disables model-direct selection with an actionable explanation', () => {
    render(<Harness />);

    const trigger = screen.getByTestId('turn-skill-trigger');
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(trigger.getAttribute('title')).toContain('切换对话对象');
    expect(runtime.listSkills).not.toHaveBeenCalled();
  });

  it('ignores an obsolete catalog response after the owner scope changes', async () => {
    const first = deferred<{ skills: SkillVersionSummary[] }>();
    const second = deferred<{ skills: SkillVersionSummary[] }>();
    runtime.listSkills.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<Harness owner={owner('agent-a', ['skill-a'])} />);
    fireEvent.click(screen.getByTestId('turn-skill-trigger'));

    view.rerender(<Harness owner={owner('agent-b', ['skill-b'])} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve({ skills: [skill('skill-b')] });
      await second.promise;
    });
    expect(await screen.findByTestId('turn-skill-option-skill-b')).toBeTruthy();

    await act(async () => {
      first.resolve({ skills: [skill('skill-a')] });
      await first.promise;
    });
    expect(screen.queryByTestId('turn-skill-option-skill-a')).toBeNull();
    expect(screen.getByTestId('turn-skill-option-skill-b')).toBeTruthy();
  });
});
