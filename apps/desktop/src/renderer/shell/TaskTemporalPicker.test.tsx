/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { isTaskTime, TaskTimeField } from './TaskTemporalPicker.js';

function TimeField({ disabled = false }: { disabled?: boolean }) {
  const [time, setTime] = useState('18:37');
  return <TaskTimeField label="窗口结束时间" value={time} disabled={disabled} onChange={setTime} />;
}

describe('TaskTemporalPicker', () => {
  afterEach(cleanup);

  it.each(['00:00', '09:00', '12:37', '23:59'])(
    'accepts an exact valid wall-clock value: %s',
    (time) => {
      expect(isTaskTime(time)).toBe(true);
    },
  );
  it.each(['', '9:00', '09:0', '24:00', '12:60', '-1:00', '99:99', '09:00:00'])(
    'rejects malformed or out-of-range values: %s',
    (time) => {
      expect(isTaskTime(time)).toBe(false);
    },
  );
  it('keeps exact manual editing and marks invalid values without silently coercing them', () => {
    render(<TimeField />);
    const input = screen.getByLabelText('窗口结束时间');
    fireEvent.change(input, { target: { value: '10:17' } });
    expect((input as HTMLInputElement).value).toBe('10:17');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    fireEvent.change(input, { target: { value: '99:99' } });
    expect((input as HTMLInputElement).value).toBe('99:99');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
  it('opens with both existing time parts checked and preserves minutes when changing hours', async () => {
    render(<TimeField />);
    const trigger = screen.getByRole('button', { name: '选择窗口结束时间' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByRole('menuitemradio', { name: '18 时', checked: true })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: '37 分', checked: true })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '18 时' })),
    );
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(84);
    expect(screen.getByRole('group', { name: '点选小时' }).getAttribute('data-layout')).toBe(
      'grid',
    );
    expect(screen.getByRole('group', { name: '点选分钟' }).getAttribute('data-layout')).toBe(
      'grid',
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: '23 时' }));
    expect((screen.getByLabelText('窗口结束时间') as HTMLInputElement).value).toBe('23:37');
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitemradio', { name: '59 分' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect((screen.getByLabelText('窗口结束时间') as HTMLInputElement).value).toBe('23:59');
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('Escape closes only the picker and leaves the current value intact', async () => {
    render(<TimeField />);
    const trigger = screen.getByRole('button', { name: '选择窗口结束时间' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const option = await screen.findByRole('menuitemradio', { name: '18 时' });
    fireEvent.keyDown(option, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect((screen.getByLabelText('窗口结束时间') as HTMLInputElement).value).toBe('18:37');
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('all-day fields disable the input and picker without emitting changes', () => {
    const change = vi.fn();
    render(<TaskTimeField label="窗口开始时间" value="09:00" disabled onChange={change} />);
    expect((screen.getByLabelText('窗口开始时间') as HTMLInputElement).disabled).toBe(true);
    const trigger = screen.getByRole('button', { name: '选择窗口开始时间' });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
});
