import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
export const PreviewTheme = createContext<{ values: Record<string, string>; mode: string }>({
  values: {},
  mode: 'light',
});
/** Only visible thumbnails mount documents. Off-screen previews are unmounted,
 * preventing a full catalog from creating 100+ active business component trees. */
export function PreviewFrame({
  name,
  thumbnail = false,
  variant = 'default',
  wide = false,
}: {
  name: string;
  thumbnail?: boolean;
  variant?: string;
  wide?: boolean;
}) {
  const theme = useContext(PreviewTheme);
  const initialMode = useRef(theme.mode);
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(!thumbnail);
  const [width, setWidth] = useState(600);
  const [status, setStatus] = useState('loading');
  const compact = [
    'CodeBlockButton',
    'CopyTextButton',
    'AgentAvatarView',
    'FileTypeIcon',
    'SlidingTabs',
    'LoadingPixelGrid',
    'ToggleControl',
    'SecretInputControl',
    'DsTabBar',
    'BrandLogoMark',
    'BotAvatarCanvas',
  ].includes(name);
  const naturalWidth = variant === 'hero' ? 480 : wide ? 1060 : compact ? 480 : 640;
  const naturalHeight = wide ? 660 : compact ? 270 : name === 'ComposerEditor' ? 280 : 360;
  const sendTheme = () =>
    frame.current?.contentWindow?.postMessage(
      { type: 'sync-design-theme', ...theme },
      location.origin === 'null' ? '*' : location.origin,
    );
  useEffect(() => {
    sendTheme();
  }, [theme, visible]);
  useEffect(() => {
    if (!host.current) return;
    const size = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    size.observe(host.current);
    const visibility = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '100px',
    });
    if (thumbnail) visibility.observe(host.current);
    return () => {
      size.disconnect();
      visibility.disconnect();
    };
  }, [thumbnail]);
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== 'sync-design-preview'
      )
        return;
      setStatus(event.data.status);
      sendTheme();
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [theme]);
  const scale = thumbnail
    ? Math.min(1, width / naturalWidth)
    : wide
      ? Math.min(1, width / naturalWidth)
      : 1;
  const style = thumbnail
    ? {
        width: naturalWidth,
        height: naturalHeight,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }
    : wide
      ? {
          width: naturalWidth,
          height: 660,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }
      : { width: '100%', height: 480 };
  return (
    <div
      className={`ds-visual-frame${thumbnail ? ' is-thumbnail' : ''}`}
      ref={host}
      data-preview-state={status}
      style={
        {
          height: thumbnail
            ? Math.round(naturalHeight * scale)
            : wide
              ? Math.round(660 * scale)
              : 480,
        } as CSSProperties
      }
    >
      {visible && (
        <iframe
          ref={frame}
          title={`${name} 设计预览`}
          src={`./design-preview.html?component=${encodeURIComponent(name)}&variant=${variant}&mode=${initialMode.current}`}
          style={style}
          onLoad={sendTheme}
          sandbox="allow-scripts allow-same-origin"
          tabIndex={thumbnail ? -1 : 0}
        />
      )}
      {status === 'error' && <span className="ds-preview-error">此预览出现异常，请重新打开</span>}
    </div>
  );
}
