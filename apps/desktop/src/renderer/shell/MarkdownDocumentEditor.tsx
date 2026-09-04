import { useEffect, useRef } from 'react';
import { htmlToMarkdown, markdownToHtml } from './markdown-document.js';

function runFormat(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function MarkdownDocumentEditor({
  text,
  onChange,
}: {
  text: string;
  onChange?(next: string): void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);
  const lastEmittedRef = useRef(text);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || focusedRef.current) return;
    if (text === lastEmittedRef.current && editor.innerHTML) return;
    editor.innerHTML = markdownToHtml(text);
    lastEmittedRef.current = text;
  }, [text]);

  const emit = () => {
    const editor = editorRef.current;
    if (!editor || !onChange) return;
    const next = htmlToMarkdown(editor.innerHTML);
    lastEmittedRef.current = next;
    onChange(next);
  };

  const format = (command: string, value?: string) => {
    runFormat(command, value);
    editorRef.current?.focus();
    emit();
  };

  return (
    <div className="shell-file-document-preview shell-markdown-document" data-preview-kind="markdown">
      {onChange ? (
        <div className="shell-markdown-document__toolbar" role="toolbar" aria-label="富文本编辑">
          <button type="button" aria-label="加粗" title="加粗" onMouseDown={(event) => event.preventDefault()} onClick={() => format('bold')}>
            B
          </button>
          <button type="button" aria-label="斜体" title="斜体" onMouseDown={(event) => event.preventDefault()} onClick={() => format('italic')}>
            I
          </button>
          <button type="button" aria-label="标题" title="标题" onMouseDown={(event) => event.preventDefault()} onClick={() => format('formatBlock', 'H1')}>
            H1
          </button>
          <button type="button" aria-label="列表" title="列表" onMouseDown={(event) => event.preventDefault()} onClick={() => format('insertUnorderedList')}>
            ≡
          </button>
        </div>
      ) : null}
      <div
        ref={editorRef}
        className="shell-file-document-preview__content"
        contentEditable={Boolean(onChange)}
        role="textbox"
        aria-label="文档编辑"
        aria-multiline="true"
        suppressContentEditableWarning
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
        }}
        onInput={emit}
      />
    </div>
  );
}
