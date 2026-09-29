import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { listenForFrameCoalescedViewportChange } from './viewport-frame.js';
import { Check, ChevronDown, ImagePlus, RotateCcw, X } from 'lucide-react';
import { BrandLogoMark } from './BrandLogoMark.js';
import { PROVIDER_BRAND_LOGOS } from './brand-icons.js';
import { ProviderIdentityMark } from './ProviderIdentityMark.js';
import { prepareProviderIcon } from './provider-icon-image.js';
import {
  saveProviderIcon,
  useProviderIcon,
  type ProviderIconPreference,
} from './provider-icons.js';

const brands = Object.entries(PROVIDER_BRAND_LOGOS).filter(
  ([, logo], index, all) => all.findIndex(([, candidate]) => candidate.src === logo.src) === index,
);

export function ProviderIconEditor({ providerId, name }: { providerId: string; name: string }) {
  const icon = useProviderIcon(providerId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(310, window.innerWidth - 16);
      const desiredHeight = panel.current?.scrollHeight ?? 350;
      const below = window.innerHeight - rect.bottom - 15;
      const above = rect.top - 15;
      const opensBelow = below >= desiredHeight || below >= above;
      const maxHeight = Math.max(100, opensBelow ? below : above);
      setPanelStyle({
        position: 'fixed',
        zIndex: 10050,
        width,
        maxHeight,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: opensBelow
          ? rect.bottom + 7
          : Math.max(8, rect.top - Math.min(desiredHeight, maxHeight) - 7),
      });
    };
    update();
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const unlisten = listenForFrameCoalescedViewportChange(update);
    const observer = new ResizeObserver(update);
    if (panel.current) observer.observe(panel.current);
    return () => {
      unlisten();
      observer.disconnect();
    };
  }, [open]);
  useEffect(() => {
    generation.current += 1;
    setOpen(false);
    setBusy(false);
    setError('');
    setSaved(false);
    return () => {
      generation.current += 1;
    };
  }, [providerId]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const save = (next?: ProviderIconPreference) => {
    try {
      saveProviderIcon(providerId, next);
      setError('');
      setSaved(true);
    } catch {
      setError('图标保存失败，请检查本机存储空间后重试');
    }
  };
  const upload = async (file: File) => {
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const dataUrl = await prepareProviderIcon(file);
      if (generation.current === request) save({ kind: 'image', dataUrl });
    } catch (error) {
      if (generation.current === request)
        setError(error instanceof Error ? error.message : '图片处理失败');
    } finally {
      if (generation.current === request) setBusy(false);
    }
  };
  return (
    <div
      className="provider-icon-editor"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="provider-icon-editor__trigger"
        aria-label="更改供应商图标"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <ProviderIdentityMark providerId={providerId} name={name} size={22} />
        <span>更改图标</span>
        <ChevronDown size={13} />
      </button>
      {saved && !open ? (
        <span className="provider-icon-editor__saved" role="status">
          已保存
        </span>
      ) : null}
      {open
        ? createPortal(
            <div
              ref={panel}
              id={panelId}
              style={panelStyle}
              className="provider-icon-editor__panel"
              role="dialog"
              aria-label="供应商图标"
            >
              <header>
                <strong>供应商图标</strong>
                <button type="button" aria-label="关闭图标设置" onClick={() => setOpen(false)}>
                  <X size={15} />
                </button>
              </header>
              <p>为 {name} 选择图标，应用到所有工作区。</p>
              <div className="provider-icon-editor__brands" role="group" aria-label="品牌图标">
                {brands.map(([id, logo]) => (
                  <button
                    type="button"
                    key={id}
                    title={logo.label}
                    aria-label={'使用 ' + logo.label + ' 图标'}
                    aria-pressed={icon?.kind === 'brand' && icon.brandId === id}
                    disabled={busy}
                    onClick={() => save({ kind: 'brand', brandId: id })}
                  >
                    <BrandLogoMark logo={logo} size={23} />
                    {icon?.kind === 'brand' && icon.brandId === id ? (
                      <Check className="provider-icon-editor__check" size={10} />
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="provider-icon-editor__actions">
                <button type="button" disabled={busy} onClick={() => input.current?.click()}>
                  <ImagePlus size={15} />
                  {busy ? '处理图片…' : '上传图片'}
                </button>
                <button type="button" disabled={busy || !icon} onClick={() => save()}>
                  <RotateCcw size={14} />
                  恢复默认
                </button>
              </div>
              <input
                ref={input}
                type="file"
                hidden
                aria-label="上传供应商图标"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void upload(file);
                }}
              />
              <small>PNG / JPG / WebP / SVG，最大 4 MB</small>
              {error ? (
                <p className="provider-icon-editor__error" role="alert">
                  {error}
                </p>
              ) : saved ? (
                <p className="provider-icon-editor__saved" role="status">
                  图标已保存
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
