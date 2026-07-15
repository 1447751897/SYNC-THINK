import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModeSwitch, projectModeReadiness } from '../src/components/ModeSwitch.js';

describe('ModeSwitch', () => {
  it('keeps conversation and collaboration available while automatic needs both readiness signals', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModeSwitch value="conversation" onChange={onChange} approvedPlan={false} applicablePolicy={false} />,
    );

    for (const mode of ['conversation', 'collaboration'] as const) {
      expect(screen.getByTestId(`mode-switch-${mode}`)).toHaveProperty('disabled', false);
    }
    expect(screen.getByTestId('mode-switch-automatic')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('mode-switch-collaboration'));
    rerender(
      <ModeSwitch value="conversation" onChange={onChange} approvedPlan applicablePolicy />,
    );
    fireEvent.click(screen.getByTestId('mode-switch-automatic'));
    expect(onChange.mock.calls.map(([mode]) => mode)).toEqual(['collaboration', 'automatic']);
  });

  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [true, true, true],
  ])('projects both automatic readiness conditions (%s, %s)', (approvedPlan, applicablePolicy, automaticOpen) => {
    const readiness = projectModeReadiness({ value: 'conversation', approvedPlan, applicablePolicy });
    expect(readiness.collaborationOpen).toBe(true);
    expect(readiness.automaticOpen).toBe(automaticOpen);
    expect(readiness.m2Locked).toBe(!automaticOpen);
  });

  it('removes the legacy disabled props from the public component source', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/ModeSwitch.tsx'), 'utf8');
    expect(source).not.toContain('collaborationDisabled');
    expect(source).not.toContain('automaticDisabled');
  });
});
