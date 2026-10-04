import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Code2, FileText, Folder, Image, Mic, Play, Presentation, Table2, X } from 'lucide-react';
import type { ComposeAttachment } from './compose-mention.js';

export const ATTACHMENT_EXIT_MS = 220;
export const ATTACHMENT_COLLAPSE_MS = 280;
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const reducedMotion = () =>
  document.documentElement.hasAttribute('data-reduced-motion') ||
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

type Entry = { attachment: ComposeAttachment; exiting: boolean; delay: number };
type Props = {
  attachments: readonly ComposeAttachment[];
  disabled?: boolean;
  onOpen?: (attachment: ComposeAttachment) => void;
  onRemove?: (path: string) => void;
};

export function attachmentTileKind(attachment: ComposeAttachment) {
  if (attachment.kind === 'image' || attachment.kind === 'dir') return attachment.kind;
  const extension = attachment.name.split('.').pop()?.toLowerCase() ?? '';
  if (/^(xlsx?|csv|ods|tsv)$/.test(extension)) return 'spreadsheet';
  if (/^(pptx?|key|odp)$/.test(extension)) return 'presentation';
  if (/^(tsx?|jsx?|json|py|rs|go|java|html|css|sh|sql|ya?ml|toml|vue|svelte)$/.test(extension))
    return 'code';
  if (/^(mp4|mov|webm|avi|mkv)$/.test(extension)) return 'video';
  if (/^(mp3|wav|flac|m4a|aac|ogg|opus|aiff)$/.test(extension)) return 'audio';
  return 'document';
}

function AttachmentTile({
  entry,
  collapsing,
  disabled,
  onOpen,
  onRemove,
  onExited,
}: {
  collapsing: boolean;
  entry: Entry;
  disabled?: boolean;
  onOpen?: Props['onOpen'];
  onRemove?: Props['onRemove'];
  onExited: (path: string) => void;
}) {
  const { attachment, exiting, delay } = entry;
  const kind = attachmentTileKind(attachment);
  const progress = Math.max(0, Math.min(100, attachment.progress ?? 100));
  const pending = attachment.progress !== undefined && progress < 100;
  const image = kind === 'image' && Boolean(attachment.previewUrl);
  const Icon = {
    image: Image,
    dir: Folder,
    document: FileText,
    spreadsheet: Table2,
    presentation: Presentation,
    code: Code2,
    video: Play,
    audio: Mic,
  }[kind];
  useLayoutEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(
      () => onExited(attachment.path),
      reducedMotion() ? 0 : collapsing ? ATTACHMENT_COLLAPSE_MS : ATTACHMENT_EXIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [attachment.path, collapsing, exiting, onExited]);
  const content = (
    <>
      {image ? (
        <img src={attachment.previewUrl} alt={attachment.name} draggable={false} />
      ) : (
        <>
          <span className="shell-attachment-tile__file-icon">
            <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <span className="shell-attachment-tile__name">{attachment.name}</span>
        </>
      )}
    </>
  );
  return (
    <div className="shell-attachment-tile-position" data-attachment-key={attachment.path}>
      <div
        className="shell-attachment-tile"
        data-kind={kind}
        data-image={image || undefined}
        data-exiting={exiting || undefined}
        data-pending={pending || undefined}
        aria-hidden={exiting || undefined}
        title={attachment.name}
        style={{ '--attachment-delay': `${delay}ms` } as CSSProperties}
      >
        {onOpen ? (
          <button
            type="button"
            className="shell-attachment-tile__body"
            aria-label={`打开附件 ${attachment.name}`}
            disabled={disabled || exiting || pending}
            onClick={() => onOpen(attachment)}
          >
            {content}
          </button>
        ) : (
          <span className="shell-attachment-tile__body">{content}</span>
        )}
        <svg className="shell-attachment-tile__ring" viewBox="0 0 56 56" aria-hidden="true">
          <path
            d="M28 1H44A11 11 0 0 1 55 12V44A11 11 0 0 1 44 55H12A11 11 0 0 1 1 44V12A11 11 0 0 1 12 1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${progress} 100`}
          />
        </svg>
        <span
          className="shell-attachment-tile__progress"
          role={pending ? 'progressbar' : undefined}
          aria-label={pending ? `处理附件 ${attachment.name}` : undefined}
          aria-valuemin={pending ? 0 : undefined}
          aria-valuemax={pending ? 100 : undefined}
          aria-valuenow={pending ? Math.round(progress) : undefined}
          aria-valuetext={
            pending ? (attachment.processingLabel ?? `${Math.round(progress)}%`) : undefined
          }
          aria-hidden={!pending || undefined}
        >
          {Math.round(progress)}%
        </span>
        {onRemove ? (
          <button
            type="button"
            className="shell-attachment-tile__remove"
            aria-label={`${pending ? '取消处理附件' : '移除附件'} ${attachment.name}`}
            title={pending ? '取消处理附件' : '移除附件'}
            disabled={disabled || exiting}
            tabIndex={exiting ? -1 : undefined}
            onClick={() => onRemove(attachment.path)}
          >
            <X size={10} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Independent tile presence + measured strip height: never scale the text editor. */
export function ComposerAttachments({ attachments, disabled, onOpen, onRemove }: Props) {
  const [entries, setEntries] = useState<Entry[]>(() =>
    attachments.map((attachment) => ({ attachment, exiting: false, delay: 0 })),
  );
  const regionRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const animations = useRef<Animation[]>([]);
  const height = useRef(0);
  const open = attachments.length > 0;
  const openRef = useRef(open);
  openRef.current = open;

  useLayoutEffect(() => {
    setEntries((current) => {
      const active = new Set(attachments.map((attachment) => attachment.path));
      const old = new Map(current.map((entry) => [entry.attachment.path, entry]));
      let added = 0;
      const next = attachments.map((attachment) => {
        const previous = old.get(attachment.path);
        return previous && !previous.exiting && previous.attachment === attachment
          ? previous
          : { attachment, exiting: false, delay: previous?.delay ?? Math.min(added++ * 70, 210) };
      });
      // Keep departing tiles in flow until their exit ends, then FLIP the survivors.
      current.forEach((entry, index) => {
        if (!active.has(entry.attachment.path))
          next.splice(index, 0, entry.exiting ? entry : { ...entry, exiting: true });
      });
      return next.length === current.length && next.every((entry, i) => entry === current[i])
        ? current
        : next;
    });
  }, [attachments]);

  const onExited = useCallback((path: string) => {
    setEntries((current) =>
      current.filter((entry) => entry.attachment.path !== path || !entry.exiting),
    );
  }, []);

  const measure = useCallback(() => {
    const region = regionRef.current;
    const strip = stripRef.current;
    if (!region || !strip) return;
    const nextHeight = openRef.current ? strip.getBoundingClientRect().height : 0;
    if (nextHeight !== height.current) {
      height.current = nextHeight;
      region.style.height = `${nextHeight}px`;
    }
    const next = new Map<string, { x: number; y: number }>();
    for (const node of strip.children) {
      const element = node as HTMLElement;
      const key = element.dataset.attachmentKey!;
      const position = { x: element.offsetLeft, y: element.offsetTop };
      const previous = positions.current.get(key);
      if (
        previous &&
        (previous.x !== position.x || previous.y !== position.y) &&
        !reducedMotion() &&
        element.animate
      ) {
        animations.current.push(
          element.animate(
            [
              {
                transform: `translate(${previous.x - position.x}px, ${previous.y - position.y}px)`,
              },
              { transform: 'translate(0, 0)' },
            ],
            { duration: 280, easing: EASE },
          ),
        );
      }
      next.set(key, position);
    }
    animations.current = animations.current.filter(
      (animation) => animation.playState !== 'finished',
    );
    positions.current = next;
  }, []);

  useLayoutEffect(measure, [entries, open, measure]);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    if (strip) observer?.observe(strip);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      animations.current.forEach((animation) => animation.cancel());
    };
  }, [measure]);

  return (
    <div
      ref={regionRef}
      className="shell-attachment-region"
      data-open={open}
      data-testid={entries.length ? 'composer-editor-attachments' : undefined}
      aria-hidden={!open || undefined}
    >
      <div ref={stripRef} className="shell-attachment-strip">
        {entries.map((entry) => (
          <AttachmentTile
            key={entry.attachment.path}
            entry={entry}
            collapsing={!open}
            disabled={disabled}
            onOpen={onOpen}
            onRemove={onRemove}
            onExited={onExited}
          />
        ))}
      </div>
    </div>
  );
}
