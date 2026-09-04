import { CodePreview } from './ExecutionProcessBlock.js';
import { MarkdownContent } from './MarkdownContent.js';
import { MarkdownDocumentEditor } from './MarkdownDocumentEditor.js';
import { ExcalidrawPreview } from './ExcalidrawPreview.js';
import { isExcalidrawPath, parseExcalidrawDocument } from './excalidraw-document.js';

const RENDERED_MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;

export function isRenderedMarkdownPath(path: string): boolean {
  return RENDERED_MARKDOWN_EXTENSION.test(path.trim());
}

export function FileContentPreview({
  text,
  path,
  highlightLine,
  onChange,
}: {
  text: string;
  path: string;
  highlightLine?: number;
  onChange?: (content: string) => void;
}) {
  if (isRenderedMarkdownPath(path)) {
    if (onChange) {
      return <MarkdownDocumentEditor text={text} onChange={onChange} />;
    }
    return (
      <div className="shell-file-document-preview" data-preview-kind="markdown">
        <MarkdownContent
          text={text}
          interactiveEmbeds={false}
          className="shell-file-document-preview__content"
        />
      </div>
    );
  }

  if (isExcalidrawPath(path)) {
    const parsed = parseExcalidrawDocument(text);
    if (!parsed.ok) {
      return (
        <div className="shell-file-document-preview shell-excalidraw-error" role="alert">
          <strong>设计稿</strong>
          <span>{parsed.error}</span>
        </div>
      );
    }
    return (
      <div className="shell-file-document-preview shell-file-document-preview--excalidraw">
        <ExcalidrawPreview content={text} filePath={path} onChange={onChange} />
      </div>
    );
  }

  return <CodePreview text={text} path={path} highlightLine={highlightLine} />;
}
