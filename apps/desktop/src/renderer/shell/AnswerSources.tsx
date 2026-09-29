/** Be UI Citations adaptation (MIT). See third-party/beui-citations.md. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import type { AnswerSource } from './answer-sources.js';
import { ExternalSourceIcon } from './ExternalSourceIcon.js';
import { FileTypeIcon } from './FileTypeIcon.js';
import { useCitations } from './CitationContext.js';

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
  onOpenUrl,
}: {
  sources: readonly AnswerSource[];
  actions?: ReactNode;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const scope = useCitations();
  const [localOpen, setLocalOpen] = useState(false);
  const open = scope?.open ?? localOpen;
  const setOpen = scope?.setOpen ?? setLocalOpen;
  const sourcesId = useId();
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const selected = scope?.selection;
  useEffect(() => {
    if (!open || !selected) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(
      () => {
        const row = rows.current.get(selected.key);
        row?.focus({ preventScroll: true });
        row?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
      },
      reduced ? 0 : 220,
    );
    return () => clearTimeout(timer);
  }, [open, selected]);
  if (sources.length === 0 && !actions) return null;
  const citations = sources.filter((source) => source.origin === 'citation');
  const references = sources.filter((source) => source.origin !== 'citation');
  const groups = [
    { label: '引用来源', items: citations, cited: true },
    { label: '参考资料', items: references, cited: false },
  ];
  return (
    <div className="shell-msg-sources" data-testid="msg-sources">
      {actions ? <div className="shell-msg-sources__actions">{actions}</div> : null}
      {sources.length > 0 ? (
        <div className="shell-msg-sources__anchor">
          <button
            type="button"
            className="shell-msg-sources__summary"
            aria-label={'查看 ' + sources.length + ' 个来源'}
            aria-expanded={open}
            aria-controls={sourcesId}
            onClick={() => setOpen(!open)}
          >
            <span className="shell-msg-sources__stack" aria-hidden="true">
              {sources.slice(0, 3).map((source) => (
                <span className="shell-msg-sources__stack-item" key={source.key}>
                  <SourceMark source={source} />
                </span>
              ))}
            </span>
            <span>{sources.length} 个来源</span>
            <ChevronDown size={13} aria-hidden="true" className="shell-msg-sources__chevron" />
          </button>
          <div
            id={sourcesId}
            className={'shell-msg-sources__reveal' + (open ? ' is-open' : '')}
            aria-hidden={!open}
            {...(!open ? { inert: '' } : {})}
          >
            <div className="shell-msg-sources__clip">
              <div className="shell-msg-sources__panel">
                {groups
                  .filter((group) => group.items.length)
                  .map((group) => (
                    <div key={group.label} className="shell-msg-sources__group">
                      <div className="shell-msg-sources__group-title">
                        {group.label}
                        <span>{group.items.length}</span>
                      </div>
                      <div role="list" aria-label={group.label}>
                        {group.items.map((source, index) => (
                          <div role="listitem" key={source.key}>
                            <button
                              type="button"
                              id={
                                scope?.targetId(source.key) ??
                                sourcesId + '-' + encodeURIComponent(source.key)
                              }
                              ref={(node) => {
                                if (node) rows.current.set(source.key, node);
                                else rows.current.delete(source.key);
                              }}
                              className="shell-msg-sources__item"
                              data-selected={
                                open && selected?.key === source.key ? 'true' : undefined
                              }
                              title={
                                source.kind === 'external'
                                  ? source.url
                                  : source.path +
                                    (source.location ? ':' + source.location.line : '')
                              }
                              aria-label={'打开来源 ' + source.label}
                              tabIndex={open ? 0 : -1}
                              onClick={() => {
                                if (source.kind === 'external') {
                                  if (onOpenUrl) onOpenUrl(source.url);
                                  else
                                    void window.syncThink?.runtime?.openExternalUrl?.(source.url);
                                } else if (source.location)
                                  onOpenFile?.(source.path, source.location);
                                else onOpenFile?.(source.path);
                              }}
                            >
                              <SourceMark source={source} size={16} />
                              <span className="shell-msg-sources__item-copy">
                                <strong>{source.label}</strong>
                                <small>
                                  {source.kind === 'external' ? source.host : source.path}
                                  {source.kind === 'file' && source.location
                                    ? ' · 第 ' + source.location.line + ' 行'
                                    : ''}
                                </small>
                              </span>
                              {group.cited ? (
                                <span className="shell-msg-sources__number">{index + 1}</span>
                              ) : (
                                <span className="shell-msg-sources__kind">
                                  {source.origin === 'read' ? '已读取' : '参考链接'}
                                </span>
                              )}
                              {source.kind === 'external' ? (
                                <ExternalLink
                                  size={12}
                                  aria-hidden="true"
                                  className="shell-msg-sources__external"
                                />
                              ) : null}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
