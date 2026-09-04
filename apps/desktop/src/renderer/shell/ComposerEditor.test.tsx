/**
 * @vitest-environment jsdom
 */
import { createRef, useState, type Ref } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ComposerEditor,
  type ComposerEditorHandle,
  type ComposerEditorProps,
} from './ComposerEditor.js';

afterEach(cleanup);

function ControlledEditor(
  props: Omit<ComposerEditorProps, 'value' | 'onChange'> & {
    initialValue?: string;
    editorRef?: Ref<ComposerEditorHandle>;
    onValueChange?: ComposerEditorProps['onChange'];
  },
) {
  const { initialValue = '', editorRef, onValueChange, ...editorProps } = props;
  const [value, setValue] = useState(initialValue);
  return (
    <ComposerEditor
      {...editorProps}
      ref={editorRef}
      value={value}
      onChange={(nextValue, selection) => {
        setValue(nextValue);
        onValueChange?.(nextValue, selection);
      }}
    />
  );
}

describe('ComposerEditor', () => {
  it('keeps one CodeMirror textbox while controlled values change', () => {
    const { rerender } = render(
      <ComposerEditor value="first" onChange={() => undefined} ariaLabel="消息" />,
    );

    const textbox = screen.getByRole('textbox', { name: '消息' });
    const editor = textbox.closest('.cm-editor');

    expect(editor).not.toBeNull();
    expect(textbox.textContent).toBe('first');

    rerender(<ComposerEditor value="second" onChange={() => undefined} ariaLabel="消息" />);

    expect(screen.getByRole('textbox', { name: '消息' }).closest('.cm-editor')).toBe(editor);
    expect(textbox.textContent).toBe('second');
  });

  it('returns to the minimum height after a tall draft is cleared', () => {
    const { rerender } = render(
      <ComposerEditor
        value=""
        onChange={() => undefined}
        ariaLabel="消息"
        inputTestId="compat-input"
        minHeight={36}
        maxHeight={200}
      />,
    );

    const host = screen
      .getByTestId('composer-editor')
      .querySelector('.shell-composer-editor__surface') as HTMLElement;
    const content = host.querySelector('.cm-content') as HTMLElement;
    const input = screen.getByTestId('compat-input') as HTMLTextAreaElement;
    const contentHeight = { current: 36 };
    const installStyledScrollHeight = (element: HTMLElement) => {
      Object.defineProperty(element, 'scrollHeight', {
        configurable: true,
        get() {
          const styled = Number.parseFloat(this.style.height || '');
          return Math.max(contentHeight.current, Number.isFinite(styled) ? styled : 0);
        },
      });
    };
    installStyledScrollHeight(host);
    installStyledScrollHeight(content);
    installStyledScrollHeight(input);

    contentHeight.current = 180;
    rerender(
      <ComposerEditor
        value={`${'很长的一行文字，用来把输入框撑高。\n'.repeat(8)}结尾`}
        onChange={() => undefined}
        ariaLabel="消息"
        inputTestId="compat-input"
        minHeight={36}
        maxHeight={200}
      />,
    );
    expect(host.style.height).toBe('180px');

    contentHeight.current = 36;
    rerender(
      <ComposerEditor
        value=""
        onChange={() => undefined}
        ariaLabel="消息"
        inputTestId="compat-input"
        minHeight={36}
        maxHeight={200}
      />,
    );
    expect(host.style.height).toBe('36px');
  });

  it('publishes controlled text changes within the NewMax height and type metrics', () => {
    render(
      <ControlledEditor
        initialValue="开始"
        ariaLabel="消息"
        inputTestId="compat-input"
        minHeight={36}
        maxHeight={200}
        chatFontSize={17}
        serifFontFamily="Noto Serif SC"
      />,
    );

    const input = screen.getByRole('textbox', { name: '消息' });
    const compatibilityInput = screen.getByTestId('compat-input') as HTMLTextAreaElement;
    fireEvent.change(compatibilityInput, { target: { value: '开始\n继续' } });

    const editor = input.closest('.cm-editor') as HTMLElement;
    const scroller = editor.querySelector('.cm-scroller') as HTMLElement;
    expect(compatibilityInput.value).toBe('开始\n继续');
    expect(input.textContent).toBe('开始继续');
    expect(getComputedStyle(editor).minHeight).toBe('56px');
    expect(getComputedStyle(scroller).maxHeight).toBe('200px');
    expect(getComputedStyle(input).fontSize).toBe('17px');
    expect(getComputedStyle(input).fontFamily).toBe('Noto Serif SC');
  });

  it('submits on Enter, keeps Shift+Enter for a newline, and ignores IME confirmation', () => {
    const onSubmit = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <ControlledEditor
        initialValue="请规划"
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        ariaLabel="消息"
      />,
    );

    const input = screen.getByRole('textbox', { name: '消息' });
    input.focus();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith('请规划', { start: 0, end: 0 });

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSubmit).toHaveBeenCalledOnce();

    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
    fireEvent.compositionEnd(input);

    for (const key of ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape']) {
      fireEvent.keyDown(input, { key });
    }
    expect(onKeyDown.mock.calls.map(([event]) => event.key)).toEqual([
      'Enter',
      'Enter',
      'Enter',
      'Tab',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Escape',
    ]);
  });

  it('exposes focus, selection, containment, and root element APIs', () => {
    const editorRef = createRef<ComposerEditorHandle>();
    const inputElementRef = createRef<HTMLTextAreaElement>();
    render(
      <ComposerEditor
        ref={editorRef}
        inputElementRef={inputElementRef}
        value="abcdef"
        onChange={() => undefined}
        ariaLabel="消息"
      />,
    );

    const input = screen.getByRole('textbox', { name: '消息' });
    editorRef.current?.focus();
    editorRef.current?.setSelectionRange(2, 5);

    expect(document.activeElement).toBe(input);
    expect(editorRef.current?.getSelection()).toEqual({ start: 2, end: 5 });
    expect(editorRef.current?.getInputElement()).toBe(inputElementRef.current);
    expect(inputElementRef.current?.value).toBe('abcdef');
    expect(inputElementRef.current?.selectionStart).toBe(2);
    expect(inputElementRef.current?.selectionEnd).toBe(5);
    expect(editorRef.current?.containsEventTarget(input)).toBe(true);
    expect(editorRef.current?.containsEventTarget(inputElementRef.current ?? null)).toBe(true);
    expect(editorRef.current?.getRootElement()?.contains(input)).toBe(true);
  });

  it('locks while Goal is running and explains how to resume typing', () => {
    const onDrop = vi.fn();
    const { rerender } = render(
      <ComposerEditor
        value=""
        onChange={() => undefined}
        goalRunning
        onDrop={onDrop}
        inputTestId="compat-input"
        placeholder="输入消息"
        goalRunningPlaceholder="暂停目标后输入"
        ariaLabel="消息"
      />,
    );

    const input = screen.getByRole('textbox', { name: '消息' });
    const compatibilityInput = screen.getByTestId('compat-input') as HTMLTextAreaElement;
    expect(input.getAttribute('contenteditable')).toBe('false');
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(compatibilityInput.disabled).toBe(true);
    expect(compatibilityInput.placeholder).toBe('暂停目标后输入');
    expect(input.parentElement?.querySelector('.cm-placeholder')?.textContent).toBe(
      '暂停目标后输入',
    );
    expect(
      fireEvent.drop(screen.getByTestId('composer-editor'), {
        dataTransfer: { files: [new File(['x'], 'x.png')], types: ['Files'] },
      }),
    ).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();

    rerender(
      <ComposerEditor
        value=""
        onChange={() => undefined}
        disabled
        inputTestId="compat-input"
        placeholder="输入消息"
        ariaLabel="消息"
      />,
    );
    expect(input.getAttribute('contenteditable')).toBe('false');
    expect(compatibilityInput.disabled).toBe(true);
    expect(compatibilityInput.placeholder).toBe('输入消息');
  });

  it('renders Skill, file, image, and pasted-reference tokens with their actions', () => {
    const onRemoveSkill = vi.fn();
    const onRemoveAttachment = vi.fn();
    const onOpenAttachment = vi.fn();
    const onOpenPastedReference = vi.fn();
    const onRemovePastedReference = vi.fn();

    render(
      <ComposerEditor
        value=""
        onChange={() => undefined}
        selectedSkills={[
          {
            skillVersionId: 'skill-v1',
            name: '界面审查',
            version: '1.0.0',
            description: '检查界面一致性',
          },
        ]}
        attachments={[
          { path: 'D:/work/spec.md', name: 'spec.md', kind: 'file' },
          {
            path: 'image:hero',
            name: 'hero.png',
            kind: 'image',
            previewUrl: 'data:image/png;base64,AAAA',
          },
        ]}
        pastedReferences={[{ id: 'paste-1', label: '粘贴的文本', preview: '第一行' }]}
        onRemoveSkill={onRemoveSkill}
        onRemoveAttachment={onRemoveAttachment}
        onOpenAttachment={onOpenAttachment}
        onOpenPastedReference={onOpenPastedReference}
        onRemovePastedReference={onRemovePastedReference}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '移除 Skill 界面审查' }));
    fireEvent.click(screen.getByRole('button', { name: '打开附件 spec.md' }));
    fireEvent.click(screen.getByRole('button', { name: '移除附件 hero.png' }));
    fireEvent.click(screen.getByRole('button', { name: '打开粘贴引用 粘贴的文本' }));
    fireEvent.click(screen.getByRole('button', { name: '移除粘贴引用 粘贴的文本' }));

    expect(screen.getByRole('img', { name: 'hero.png' }).getAttribute('src')).toBe(
      'data:image/png;base64,AAAA',
    );
    expect(onRemoveSkill).toHaveBeenCalledWith('skill-v1');
    expect(onOpenAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'D:/work/spec.md' }),
    );
    expect(onRemoveAttachment).toHaveBeenCalledWith('image:hero');
    expect(onOpenPastedReference).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'paste-1' }),
    );
    expect(onRemovePastedReference).toHaveBeenCalledWith('paste-1');
  });

  it('renders NewMax references as atomic tokens and deletes their adjacent space', () => {
    const reference =
      '[界面审查](newmax-skill:%E7%95%8C%E9%9D%A2%E5%AE%A1%E6%9F%A5)';
    const editorRef = createRef<ComposerEditorHandle>();
    const onValueChange = vi.fn();
    render(
      <ControlledEditor
        editorRef={editorRef}
        initialValue={`${reference} 继续`}
        inputTestId="compat-input"
        ariaLabel="消息"
        selectedSkills={[
          {
            skillVersionId: 'skill-v1',
            name: '界面审查',
            version: '1.0.0',
            description: '检查界面一致性',
          },
        ]}
        onValueChange={onValueChange}
      />,
    );

    const textbox = screen.getByRole('textbox', { name: '消息' });
    const token = textbox.querySelector('.shell-composer-editor__atomic-token');
    expect(token?.textContent).toBe('界面审查');
    expect(textbox.textContent).toBe('界面审查 继续');

    editorRef.current?.setSelectionRange(reference.length + 1, reference.length + 1);
    fireEvent.keyDown(textbox, { key: 'Backspace' });

    expect(onValueChange).toHaveBeenLastCalledWith('继续', { start: 0, end: 0 });
    expect((screen.getByTestId('compat-input') as HTMLTextAreaElement).value).toBe('继续');
  });

  it('keeps file and pasted references atomic without duplicating the attachment rows', () => {
    const fileReference = '[spec.md](newmax-file:D%3A%2Fwork%2Fspec.md)';
    const pastedReference = '[粘贴的文本](newmax-pasted:paste-1)';
    const editorRef = createRef<ComposerEditorHandle>();
    const onValueChange = vi.fn();
    const onOpenAttachment = vi.fn();
    const onRemoveAttachment = vi.fn();
    const onOpenPastedReference = vi.fn();
    const onRemovePastedReference = vi.fn();
    render(
      <ControlledEditor
        editorRef={editorRef}
        initialValue={`${fileReference} ${pastedReference} 结尾`}
        ariaLabel="消息"
        attachments={[{ path: 'D:/work/spec.md', name: 'spec.md', kind: 'file' }]}
        pastedReferences={[{ id: 'paste-1', label: '粘贴的文本', preview: '第一行' }]}
        onValueChange={onValueChange}
        onOpenAttachment={onOpenAttachment}
        onRemoveAttachment={onRemoveAttachment}
        onOpenPastedReference={onOpenPastedReference}
        onRemovePastedReference={onRemovePastedReference}
      />,
    );

    const textbox = screen.getByRole('textbox', { name: '消息' });
    const tokens = textbox.querySelectorAll<HTMLButtonElement>(
      '.shell-composer-editor__atomic-token',
    );
    expect(Array.from(tokens, (token) => token.textContent)).toEqual(['spec.md', '粘贴的文本']);
    expect(screen.queryByTestId('composer-editor-attachments')).toBeNull();
    expect(screen.queryByTestId('composer-editor-inline-tokens')).toBeNull();

    fireEvent.click(tokens[0]!);
    fireEvent.click(tokens[1]!);
    expect(onOpenAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'D:/work/spec.md' }),
    );
    expect(onOpenPastedReference).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'paste-1' }),
    );

    editorRef.current?.setSelectionRange(0, 0);
    fireEvent.keyDown(textbox, { key: 'Delete' });
    expect(onRemoveAttachment).toHaveBeenCalledWith('D:/work/spec.md');
    expect(onValueChange).toHaveBeenLastCalledWith(`${pastedReference} 结尾`, {
      start: 0,
      end: 0,
    });

    editorRef.current?.setSelectionRange(0, 0);
    fireEvent.keyDown(textbox, { key: 'Delete' });
    expect(onRemovePastedReference).toHaveBeenCalledWith('paste-1');
    expect(onValueChange).toHaveBeenLastCalledWith('结尾', { start: 0, end: 0 });
  });

  it('keeps the trailing action in the editor after the last draft character', () => {
    render(
      <ControlledEditor
        initialValue="你现在能随便给个设计搞吗？"
        ariaLabel="消息"
        trailingAction={
          <button type="button" data-testid="trailing-action">
            优化
          </button>
        }
      />,
    );

    const editor = screen.getByTestId('composer-editor');
    expect(editor.className).toContain('has-trailing-action');
    expect(within(editor).getByTestId('trailing-action')).toBeTruthy();
    expect(editor.querySelector('.shell-composer-editor__trailing-action-slot')).not.toBeNull();
  });

  it('blurs draft text while the trailing action is enhancing', () => {
    render(
      <ControlledEditor
        initialValue="写一个发布计划"
        ariaLabel="消息"
        enhancing
        trailingAction={
          <button type="button" data-testid="trailing-action">
            优化
          </button>
        }
      />,
    );

    const editor = screen.getByTestId('composer-editor');
    expect(editor.getAttribute('data-enhancing')).toBe('true');
    expect(editor.className).toContain('is-enhancing');
  });

  it('forwards paste, drop, host key, and selection events at the editor boundary', () => {
    const editorRef = createRef<ComposerEditorHandle>();
    const onPaste = vi.fn();
    const onDrop = vi.fn();
    const onKeyDown = vi.fn();
    const onSelectionChange = vi.fn();
    const onFocusChange = vi.fn();
    render(
      <ControlledEditor
        editorRef={editorRef}
        initialValue="abc"
        onPaste={onPaste}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
        onSelectionChange={onSelectionChange}
        onFocusChange={onFocusChange}
        ariaLabel="消息"
      />,
    );

    const input = screen.getByRole('textbox', { name: '消息' });
    input.focus();
    fireEvent.paste(input, { clipboardData: { items: [], getData: () => '' } });
    fireEvent.drop(screen.getByTestId('composer-editor'), {
      dataTransfer: { files: [], types: ['Files'] },
    });
    editorRef.current?.setSelectionRange(1, 2);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    input.blur();

    expect(onPaste).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledOnce();
    expect(onSelectionChange).toHaveBeenCalledWith({ start: 1, end: 2 });
    expect(onSelectionChange).toHaveBeenLastCalledWith({ start: 2, end: 2 });
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(onFocusChange.mock.calls.map(([focused]) => focused)).toEqual([true, false]);
  });
});
