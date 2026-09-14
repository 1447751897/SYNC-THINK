import { useEffect, useRef, useState } from 'react';
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';
import { htmlToMarkdown, markdownToHtml } from './markdown-document.js';

function runFormat(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function commandState(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

function headingState(level: 1 | 2 | 3): boolean {
  try {
    return document.queryCommandValue('formatBlock').toLowerCase() === `h${level}`;
  } catch {
    return false;
  }
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
  const [, setToolbarEpoch] = useState(0);

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
    setToolbarEpoch((epoch) => epoch + 1);
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
          <button
            type="button"
            aria-label="撤销"
            title="撤销 (⌘Z)"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('undo')}
          >
            <Undo2 size={20} />
          </button>
          <button
            type="button"
            aria-label="重做"
            title="重做 (⌘⇧Z)"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('redo')}
          >
            <Redo2 size={20} />
          </button>
          <span className="shell-markdown-document__divider" aria-hidden="true" />
          <button
            type="button"
            aria-label="粗体"
            title="粗体 (⌘B)"
            aria-pressed={commandState('bold')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('bold')}
          >
            <Bold size={20} />
          </button>
          <button
            type="button"
            aria-label="斜体"
            title="斜体 (⌘I)"
            aria-pressed={commandState('italic')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('italic')}
          >
            <Italic size={20} />
          </button>
          <button
            type="button"
            aria-label="下划线"
            title="下划线 (⌘U)"
            aria-pressed={commandState('underline')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('underline')}
          >
            <Underline size={20} />
          </button>
          <button
            type="button"
            aria-label="删除线"
            title="删除线"
            aria-pressed={commandState('strikeThrough')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('strikeThrough')}
          >
            <Strikethrough size={20} />
          </button>
          <span className="shell-markdown-document__divider" aria-hidden="true" />
          <button
            type="button"
            aria-label="标题 1"
            title="标题 1"
            aria-pressed={headingState(1)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('formatBlock', 'H1')}
          >
            <Heading1 size={20} />
          </button>
          <button
            type="button"
            aria-label="标题 2"
            title="标题 2"
            aria-pressed={headingState(2)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('formatBlock', 'H2')}
          >
            <Heading2 size={20} />
          </button>
          <button
            type="button"
            aria-label="标题 3"
            title="标题 3"
            aria-pressed={headingState(3)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('formatBlock', 'H3')}
          >
            <Heading3 size={20} />
          </button>
          <span className="shell-markdown-document__divider" aria-hidden="true" />
          <button
            type="button"
            aria-label="无序列表"
            title="无序列表"
            aria-pressed={commandState('insertUnorderedList')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('insertUnorderedList')}
          >
            <List size={20} />
          </button>
          <button
            type="button"
            aria-label="有序列表"
            title="有序列表"
            aria-pressed={commandState('insertOrderedList')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('insertOrderedList')}
          >
            <ListOrdered size={20} />
          </button>
          <span className="shell-markdown-document__divider" aria-hidden="true" />
          <button
            type="button"
            aria-label="引用块"
            title="引用块"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('formatBlock', 'BLOCKQUOTE')}
          >
            <Quote size={20} />
          </button>
          <button
            type="button"
            aria-label="水平线"
            title="水平线"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format('insertHorizontalRule')}
          >
            <Minus size={20} />
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
        onKeyUp={() => setToolbarEpoch((epoch) => epoch + 1)}
        onMouseUp={() => setToolbarEpoch((epoch) => epoch + 1)}
      />
    </div>
  );
}
