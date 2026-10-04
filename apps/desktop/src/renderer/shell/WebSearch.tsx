import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type HTMLAttributes,
} from 'react';
import { Globe } from 'lucide-react';
import { WEB_SITE_MARKS } from './web-site-marks.js';
import { ExternalSourceIcon } from './ExternalSourceIcon.js';
import {
  projectResearchTool,
  researchUrl,
  type ResearchSource,
  type ResearchStep,
  type ResearchTool,
} from './web-research.js';
import { ConversationContentScope, DeferredToolContent } from './DeferredToolContent.js';
import { parseContentReference, type ConversationId } from '@sync-think/shared';
import { deferredContentReader } from './deferred-content-reader.js';
import { useAutoDisclosure } from './auto-disclosure.js';
const glyphPaths = [
  'M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748Z',
  'M9.97308 18H11V13H13V18H14.0269C14.1589 16.7984 14.7721 15.8065 15.7676 14.7226C15.8797 14.6006 16.5988 13.8564 16.6841 13.7501C17.5318 12.6931 18 11.385 18 10C18 6.68629 15.3137 4 12 4C8.68629 4 6 6.68629 6 10C6 11.3843 6.46774 12.6917 7.31462 13.7484C7.40004 13.855 8.12081 14.6012 8.23154 14.7218C9.22766 15.8064 9.84103 16.7984 9.97308 18ZM10 20V21H14V20H10ZM5.75395 14.9992C4.65645 13.6297 4 11.8915 4 10C4 5.58172 7.58172 2 12 2C16.4183 2 20 5.58172 20 10C20 11.8925 19.3428 13.6315 18.2443 15.0014C17.624 15.7748 16 17 16 18.5V21C16 22.1046 15.1046 23 14 23H10C8.89543 23 8 22.1046 8 21V18.5C8 17 6.37458 15.7736 5.75395 14.9992Z',
  'M11.9999 13.1714L16.9497 8.22168L18.3639 9.63589L11.9999 15.9999L5.63599 9.63589L7.0502 8.22168L11.9999 13.1714Z',
];
function Glyph({ kind, className, open }: { kind: number; className?: string; open?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      data-open={open}
    >
      <path d={glyphPaths[kind]} />
    </svg>
  );
}
const c = (s: string) => 'shell-web-search' + (s ? '__' + s : '');
const detailLabel = '查看执行详情';
function brand(domain: string) {
  const host = domain.toLowerCase().replace(/^www\./, '');
  return host === 'notion.so'
    ? 'notion'
    : (['reddit', 'linkedin', 'github', 'figma'].find(
        (b) => host === b + '.com' || host.endsWith('.' + b + '.com'),
      ) ?? (host === 'x.com' || host === 'twitter.com' ? 'x' : undefined));
}
function Mark({ domain, size = 12 }: { domain: string; size?: number }) {
  const b = brand(domain);
  const glyph = b ? WEB_SITE_MARKS[b] : undefined;
  const color =
    b === 'reddit'
      ? '#ff4500'
      : b === 'linkedin'
        ? '#0a66c2'
        : b === 'figma'
          ? '#f24e1e'
          : undefined;
  return glyph ? (
    <svg aria-hidden="true" width={size} height={size} viewBox={glyph.viewBox} style={{ color }}>
      <path d={glyph.path} fill="currentColor" />
    </svg>
  ) : b === 'x' ? (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ color: 'var(--research-ink)' }}
    >
      <path
        fill="currentColor"
        d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"
      />
    </svg>
  ) : (
    <ExternalSourceIcon url={`https://${domain}/`} size={size} />
  );
}
function Guide({ tail = false }: { tail?: boolean }) {
  return (
    <span className={c('guide')} aria-hidden="true">
      <svg width="12" height="15" viewBox="0 0 12 15" fill="none">
        <path d="M.5 0V8Q.5 14 6.5 14H11.5" stroke="currentColor" strokeWidth="1" />
      </svg>
      {!tail ? <span /> : null}
    </span>
  );
}
function SourceMark({ source }: { source: ResearchSource }) {
  return (
    <span className={c('site-mark')}>
      <Mark domain={source.domain} />
      <span className={c('tooltip')} role="tooltip">
        <strong>{source.title}</strong>
        <small>{source.domain}</small>
      </span>
    </span>
  );
}
function Sources({
  sources,
  onOpenUrl,
  label,
}: {
  sources: ResearchSource[];
  onOpenUrl?: (url: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={c('sources')}>
      <span className={c('stem')} />
      <div className={c('source-branch')}>
        <Guide tail />
        <div className={c('source-body')}>
          <button
            type="button"
            className={c('source-toggle')}
            aria-label={label}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            <span>{label}</span>
            <span className={c('marks')}>
              {(!open ? sources.slice(0, 6) : []).map((s, i) => (
                <span key={s.href ?? s.domain + ':' + i} style={{ zIndex: 6 - i }}>
                  <SourceMark source={s} />
                </span>
              ))}
            </span>
            {!open && sources.length > 6 ? (
              <span className={c('overflow')}>+{sources.length - 6}</span>
            ) : null}
            <Glyph kind={2} className={c('chevron')} open={open} />
          </button>
          <div
            id={id}
            className={c('disclosure')}
            data-open={open}
            aria-hidden={!open}
            {...(!open ? { inert: '' } : {})}
          >
            <div>
              <ul className={c('links')}>
                {sources.map((s, i) => {
                  const href = researchUrl(s.href);
                  const contents = (
                    <>
                      <span className={c('source-icon')}>
                        <Mark domain={s.domain} />
                      </span>
                      <span className={c('source-title')}>{s.title}</span>
                      <span className={c('domain')}>{s.domain}</span>
                    </>
                  );
                  return (
                    <li key={href ?? s.domain + ':' + i}>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={c('link')}
                          title={s.title + ' · ' + s.domain}
                          tabIndex={open ? 0 : -1}
                          onClick={
                            onOpenUrl
                              ? (e) => {
                                  e.preventDefault();
                                  onOpenUrl(href);
                                }
                              : undefined
                          }
                        >
                          {contents}
                        </a>
                      ) : (
                        <span className={c('link')}>{contents}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function ResearchReveal({
  children,
  ...props
}: HTMLAttributes<HTMLLIElement> & { 'data-status'?: string; 'data-branch'?: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (
      !node?.animate ||
      document.documentElement.hasAttribute('data-reduced-motion') ||
      document.documentElement.dataset.animation === 'off' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const animation = node.animate(
      [
        { height: '0px', opacity: 0, filter: 'blur(4px)', transform: 'translateY(4px)' },
        {
          height: node.getBoundingClientRect().height + 'px',
          opacity: 1,
          filter: 'blur(0px)',
          transform: 'translateY(0)',
        },
      ],
      { duration: 300, easing: 'cubic-bezier(0.22,1,0.36,1)' },
    );
    return () => animation.cancel();
  }, []);
  return (
    <li {...props} ref={ref}>
      {children}
    </li>
  );
}
/** Event-controlled research surface: no timer and no simulated completion. */
export function WebSearch({
  steps,
  heading,
  working = false,
  onOpenUrl,
  sourcesLabel = 'Sources',
  renderDetail,
  collapsible = false,
  settled = false,
  collapseKey,
}: {
  steps: readonly ResearchStep[];
  heading?: string;
  working?: boolean | string;
  onOpenUrl?: (url: string) => void;
  sourcesLabel?: string;
  renderDetail?: (step: ResearchStep) => ReactNode;
  collapsible?: boolean;
  /** The parent execution has ended, including failure, pause or cancellation. */
  settled?: boolean;
  collapseKey?: string;
}) {
  const treeId = useId();
  const canCollapse = collapsible && Boolean(heading);
  const active = !settled && (Boolean(working) || steps.some(step => step.status === 'running'));
  const { open: expanded, toggle } = useAutoDisclosure({
    autoOpen: active,
    resetKey: JSON.stringify([collapseKey ?? steps[0]?.id, active, settled]),
  });
  const showTree = !canCollapse || expanded;
  const failures = steps.filter(step => step.status === 'failed').length;
  const Heading = canCollapse ? 'button' : 'div';
  return (
    <section className={c('')} data-testid="web-search-trail" aria-label="网页搜索过程">
      {heading ? (
        <Heading
          type={canCollapse ? 'button' : undefined}
          className={canCollapse ? c('heading') + ' ' + c('heading-toggle') : c('heading')}
          aria-expanded={canCollapse ? expanded : undefined}
          aria-controls={canCollapse ? treeId : undefined}
          onClick={canCollapse ? toggle : undefined}
        >
          <Glyph kind={0} />
          <span className={c('heading-title')}>{heading}</span>
          {canCollapse && failures > 0 ? <span className={c('failure-count')}>{failures} 项失败</span> : null}
          {canCollapse ? <Glyph kind={2} className={c('chevron')} open={expanded} /> : null}
        </Heading>
      ) : null}
      <div className={c('tree')} data-heading={Boolean(heading)} id={treeId} hidden={!showTree}>
        {showTree ? <>

        {heading ? <span className={c('stem')} /> : null}
        <ul className={c('steps')} aria-live="polite">
          {steps.map((step, i) => (
            <ResearchReveal
              key={step.id}
              className={c('step')}
              data-status={settled && step.status === 'running' ? undefined : step.status}
              data-branch={Boolean(heading)}
            >
              {heading ? <Guide tail={i === steps.length - 1 && !working} /> : null}
              <div className={c('step-body')}>
                <div className={c('row')}>
                  <span className={c('step-icon')}>
                    {step.url || step.query?.startsWith('http') ? (
                      <Globe size={16} aria-hidden="true" />
                    ) : step.label.startsWith('Searched X') ? (
                      <Mark domain="x.com" size={13} />
                    ) : step.label.startsWith('Searched Reddit') ? (
                      <Mark domain="reddit.com" size={13} />
                    ) : (
                      <Glyph kind={1} />
                    )}
                  </span>
                  <p>
                    <span>{step.label}</span>
                    {step.query ? <code>{step.query}</code> : null}
                  </p>
                  {step.meta ? <span className={c('meta')}>{step.meta}</span> : null}
                </div>
                {step.sources?.length ? (
                  <Sources sources={step.sources} label={sourcesLabel} onOpenUrl={onOpenUrl} />
                ) : null}
                {step.detail ? (
                  <p className={c('error')} role="status">
                    {step.detail}
                  </p>
                ) : null}
                {renderDetail?.(step)}
              </div>
            </ResearchReveal>
          ))}
          {working && !settled ? (
            <ResearchReveal className={c('step')} data-branch={Boolean(heading)}>
              <Guide tail />
              <div className={c('working')} role="status">
                <span className={c('dots')} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>{typeof working === 'string' ? working : 'Searching the web'}</span>
              </div>
            </ResearchReveal>
          ) : null}
        </ul>
        </> : null}
      </div>
    </section>
  );
}
export function WebSearchToolTrail({
  items,
  conversationId,
  settled = false,
}: {
  items: readonly ResearchTool[];
  conversationId?: string;
  settled?: boolean;
}) {
  const [details, setDetails] = useState<ReadonlySet<string>>(() => new Set());
  const [loaded, setLoaded] = useState<ReadonlyMap<string, { identity: string; text: string }>>(
    () => new Map(),
  );
  const readKey = JSON.stringify(
    items.map((i) => [i.toolCallId, i.id, i.status, i.resultRef, i.result]),
  );
  useEffect(() => {
    if (!conversationId) return;
    const abort = new AbortController();
    for (const item of items) {
      const ref = item.resultRef && parseContentReference(item.resultRef.reference);
      if (!ref || item.status === 'running') continue;
      void (async () => {
        let text = '',
          offset = 0,
          version: string | undefined;
        for (let page = 0; page < 4; page++) {
          const response = await deferredContentReader.read(
            {
              conversationId: conversationId as ConversationId,
              reference: ref,
              offset,
              limit: 32768,
              ...(version ? { version } : {}),
            },
            abort.signal,
          );
          text += response.content.text;
          version = response.content.version;
          if (response.content.nextOffset === undefined) {
            if (!abort.signal.aborted)
              setLoaded((old) =>
                new Map(old).set(item.toolCallId ?? item.id ?? '', {
                  identity: JSON.stringify([conversationId, item.resultRef]),
                  text,
                }),
              );
            return;
          }
          offset = response.content.nextOffset;
        }
      })().catch(() => {
        /* The existing detail reader keeps retry/paging available. No fabricated source count. */
      });
    }
    return () => abort.abort();
  }, [conversationId, readKey]);
  const steps = items.map((i, n) => {
    const value = loaded.get(i.toolCallId ?? i.id ?? '');
    return projectResearchTool(
      {
        ...i,
        result:
          value?.identity === JSON.stringify([conversationId, i.resultRef]) ? value.text : i.result,
      },
      n,
    );
  });
  const running = steps.some((s) => s.status === 'running');
  return (
    <ConversationContentScope.Provider value={conversationId}>
      <WebSearch
        steps={steps}
        heading={`${items.length} 次网页检索`}
        collapsible
        settled={settled}
        collapseKey={JSON.stringify([conversationId, items[0]?.toolCallId ?? items[0]?.id])}
        sourcesLabel="来源"
        working={running ? '正在检索网页' : false}
        onOpenUrl={(url) => void window.syncThink?.runtime?.openExternalUrl?.(url)}
        renderDetail={(step) => {
          const item = items[steps.indexOf(step)]!;
          const open = details.has(step.id);
          return (
            <div className={c('detail')}>
              <button
                type="button"
                aria-expanded={open}
                aria-label={detailLabel}
                title={detailLabel}
                onClick={() =>
                  setDetails((old) => {
                    const next = new Set(old);
                    if (open) next.delete(step.id);
                    else next.add(step.id);
                    return next;
                  })
                }
              >
                <span className="sr-only">{detailLabel}</span>
              </button>
              {open ? (
                <div>
                  {item.argumentsRef ? (
                    <DeferredToolContent
                      deferred={item.argumentsRef}
                      preview={item.argumentsJson}
                      label="参数"
                    />
                  ) : (
                    <pre>{item.argumentsJson}</pre>
                  )}
                  {item.resultRef ? (
                    <DeferredToolContent
                      deferred={item.resultRef}
                      preview={item.result ?? ''}
                      label="输出"
                    />
                  ) : (
                    <pre>{item.result ?? ''}</pre>
                  )}
                  {item.detailsRef ? (
                    <DeferredToolContent deferred={item.detailsRef} preview="" label="详情" />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        }}
      />
    </ConversationContentScope.Provider>
  );
}
