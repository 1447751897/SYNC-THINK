/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToggleControl } from './ToggleControl.js';

afterEach(cleanup);

describe('ToggleControl', () => {
  it('projects switch state and requests the inverse value', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ToggleControl
        checked={false}
        label="界面动画"
        onChange={onChange}
        className="settings-toggle"
      />,
    );

    const control = screen.getByRole('switch', { name: '界面动画' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(control.getAttribute('data-state')).toBe('unchecked');
    expect(control.getAttribute('data-enabled')).toBe('0');
    expect(control.classList.contains('is-checked')).toBe(false);
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <ToggleControl
        checked
        label="界面动画"
        onChange={onChange}
        className="settings-toggle"
      />,
    );
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(control.getAttribute('data-state')).toBe('checked');
    expect(control.getAttribute('data-enabled')).toBe('1');
    expect(control.classList.contains('is-checked')).toBe(true);
  });

  it('keeps host thumb styling and native disabled behavior', () => {
    const onChange = vi.fn();
    render(
      <ToggleControl
        checked={false}
        disabled
        label="启用模型"
        onChange={onChange}
        className="model-toggle"
        thumbClassName="model-toggle__thumb"
      />,
    );

    const control = screen.getByRole('switch', { name: '启用模型' });
    expect(control.hasAttribute('disabled')).toBe(true);
    expect(control.querySelector('span')?.className).toBe('model-toggle__thumb');
    fireEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });
});
