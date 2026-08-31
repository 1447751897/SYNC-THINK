import { useState, type ReactNode } from 'react';
import type { AnswerSource } from './answer-sources.js';
import { ExternalSourceIcon } from './ExternalSourceIcon.js';
import { FileTypeIcon } from './FileTypeIcon.js';

function SourceMark({ source, size = 14 }: { source: AnswerSource; size?: number }) {
  return source.kind === 'external' ? (
    <ExternalSourceIcon url={source.url} size={size} />
  ) : (
    <FileTypeIcon path={source.path} size={size} />
  );
}

export function AnswerSources({
  sources,
  actions,
  onOpenFile,
}: {
  sources: readonly AnswerSource[];
  actions?: ReactNode;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0 && !actions) return null;

  return (
    <div className="shell-msg-sources" data-testid="msg-sources">
      <div className="shell-msg-sources__actions">
        {actions}
        {sources.length > 0 ? (
          <button
            type="button"
            className="shell-msg-sources__summary"
            aria-label={`查看 ${sources.length} 个来源`}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <span className="shell-msg-sources__stack" aria-hidden="true">
              {sources.slice(0, 4).map((source) => (
                <span className="shell-msg-sources__stack-item" key={source.key}>
                  <SourceMark source={source} />
                </span>
              ))}
            </span>
            <span>{sources.length} 个来源</span>
          </button>
        ) : null}
      </div>
      {sources.length > 0 ? (
        <div className={`shell-msg-sources__reveal${open ? ' is-open' : ''}`} aria-hidden={!open}>
          <div className="shell-msg-sources__clip">
            <div className="shell-msg-sources__panel" role="list" aria-label="回答来源">
              {sources.map((source) => (
                <div role="listitem" key={source.key}>
                  <button
                    type="button"
                    className="shell-msg-sources__item"
                    title={source.kind === 'external' ? source.url : source.path}
                    aria-label={`打开来源 ${source.label}`}
                    tabIndex={open ? 0 : -1}
                    onClick={() => {
                      if (source.kind === 'external') {
                        void window.syncThink?.runtime?.openExternalUrl?.(source.url);
                      } else {
                        onOpenFile?.(source.path);
                      }
                    }}
                  >
                    <SourceMark source={source} size={16} />
                    <span className="shell-msg-sources__item-copy">
                      <strong>{source.label}</strong>
                      <small>{source.kind === 'external' ? source.host : source.path}</small>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
