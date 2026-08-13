import { CodePreview } from './ExecutionProcessBlock.js';
import { MarkdownContent } from './MarkdownContent.js';

const RENDERED_MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;

export function isRenderedMarkdownPath(path: string): boolean {
  return RENDERED_MARKDOWN_EXTENSION.test(path.trim());
}

export function FileContentPreview({
  text,
  path,
  highlightLine,
}: {
  text: string;
  path: string;
  highlightLine?: number;
}) {
  if (isRenderedMarkdownPath(path)) {
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

  return <CodePreview text={text} path={path} highlightLine={highlightLine} />;
}
