/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTACHMENT_COLLAPSE_MS,
  ATTACHMENT_EXIT_MS,
  ComposerAttachments,
  attachmentTileKind,
} from './ComposerAttachments.js';
import type { ComposeAttachment } from './compose-mention.js';

const file: ComposeAttachment = { path: '/report.pdf', name: 'report.pdf', kind: 'file' };
const image: ComposeAttachment = {
  path: 'image:1',
  name: 'photo.png',
  kind: 'image',
  previewUrl: 'data:image/png;base64,AAAA',
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-reduced-motion');
});

describe('ComposerAttachments', () => {
  it('opens the measured strip instead of scaling the editor, and retains the last tile during collapse', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return { height: this.classList.contains('shell-attachment-strip') ? 60 : 20 } as DOMRect;
    });
    const { container, rerender } = render(<ComposerAttachments attachments={[]} />);
    const region = container.querySelector<HTMLElement>('.shell-attachment-region')!;
    expect(region.style.height).toBe('');
    rerender(<ComposerAttachments attachments={[image]} />);
    expect(region.style.height).toBe('60px');
    expect(region.dataset.open).toBe('true');
    rerender(<ComposerAttachments attachments={[]} />);
    expect(region.dataset.open).toBe('false');
    expect(region.style.height).toBe('0px');
    expect(container.querySelector('[data-exiting="true"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(ATTACHMENT_COLLAPSE_MS));
    expect(screen.queryByTestId('composer-editor-attachments')).toBeNull();
    expect(container.querySelector('.shell-attachment-tile')).toBeNull();
  });
  it('removes only the departing tile and preserves the remaining strip', () => {
    const remove = vi.fn();
    const { container, rerender } = render(
      <ComposerAttachments attachments={[file, image]} onRemove={remove} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '移除附件 report.pdf' }));
    expect(remove).toHaveBeenCalledWith('/report.pdf');
    rerender(<ComposerAttachments attachments={[image]} onRemove={remove} />);
    expect(container.querySelector('.shell-attachment-region')?.getAttribute('data-open')).toBe(
      'true',
    );
    expect(container.querySelectorAll('.shell-attachment-tile')).toHaveLength(2);
    act(() => vi.advanceTimersByTime(ATTACHMENT_EXIT_MS));
    expect(container.querySelectorAll('.shell-attachment-tile')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'photo.png' })).toBeTruthy();
  });
  it('cancels an exit when an attachment is restored before the timer finishes', () => {
    const { container, rerender } = render(<ComposerAttachments attachments={[file]} />);
    rerender(<ComposerAttachments attachments={[]} />);
    act(() => vi.advanceTimersByTime(100));
    rerender(<ComposerAttachments attachments={[file]} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector('[data-exiting]')).toBeNull();
    expect(screen.getByText('report.pdf')).toBeTruthy();
  });
  it('does not let rerenders or changing callbacks restart the exit', () => {
    const { container, rerender } = render(
      <ComposerAttachments attachments={[file]} onRemove={() => {}} />,
    );
    rerender(<ComposerAttachments attachments={[]} onRemove={() => {}} />);
    act(() => vi.advanceTimersByTime(100));
    rerender(<ComposerAttachments attachments={[]} onRemove={() => {}} />);
    act(() => vi.advanceTimersByTime(ATTACHMENT_COLLAPSE_MS - 100));
    expect(container.querySelector('.shell-attachment-tile')).toBeNull();
  });
  it('shows real preparation progress, preserves cancellation, then switches to the dismiss button', () => {
    const remove = vi.fn();
    const open = vi.fn();
    const { container, rerender } = render(
      <ComposerAttachments
        attachments={[{ ...image, progress: 37 }]}
        onRemove={remove}
        onOpen={open}
      />,
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('37');
    expect(
      (screen.getByRole('button', { name: '打开附件 photo.png' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('button', { name: '取消处理附件 photo.png' }).title).toBe('取消处理附件');
    fireEvent.click(screen.getByRole('button', { name: '取消处理附件 photo.png' }));
    expect(remove).toHaveBeenCalledWith('image:1');
    rerender(<ComposerAttachments attachments={[image]} onRemove={remove} onOpen={open} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(
      container
        .querySelector('.shell-attachment-tile__ring path')
        ?.getAttribute('stroke-dasharray'),
    ).toBe('100 100');
    fireEvent.click(screen.getByRole('button', { name: '打开附件 photo.png' }));
    expect(open).toHaveBeenCalledWith(image);
    expect(screen.getByRole('button', { name: '移除附件 photo.png' }).title).toBe('移除附件');
    const close = screen.getByRole('button', { name: '移除附件 photo.png' });
    expect(close.querySelector('svg')?.getAttribute('width')).toBe('10');
    fireEvent.click(close);
    expect(remove).toHaveBeenLastCalledWith('image:1');
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('disables open/remove actions for a locked composer', () => {
    render(
      <ComposerAttachments attachments={[image]} disabled onOpen={() => {}} onRemove={() => {}} />,
    );
    for (const button of screen.getAllByRole('button'))
      expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it('finishes removal immediately for reduced motion', () => {
    document.documentElement.setAttribute('data-reduced-motion', '');
    const { container, rerender } = render(<ComposerAttachments attachments={[file]} />);
    rerender(<ComposerAttachments attachments={[]} />);
    act(() => vi.advanceTimersByTime(0));
    expect(container.querySelector('.shell-attachment-tile')).toBeNull();
  });
  it.each([
    ['payroll.docx', 'document'],
    ['table.xlsx', 'spreadsheet'],
    ['launch.key', 'presentation'],
    ['types.tsx', 'code'],
    ['movie.mp4', 'video'],
    ['song.mp3', 'audio'],
    ['voice.wav', 'audio'],
    ['data.csv', 'spreadsheet'],
  ])('classifies %s without changing its outbound file reference', (name, kind) => {
    expect(attachmentTileKind({ ...file, name })).toBe(kind);
  });
});
