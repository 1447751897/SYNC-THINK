import { useEffect, useRef, useState, type CSSProperties } from 'react';

const READING_BLUR_LAYERS = ['feather', 'soft', 'medium', 'strong'] as const;
const CROSSFADE_ANIMATION = 'shell-wallpaper-crossfade-out';

interface WallpaperSnapshot {
  image: string;
  position: string;
  key: number;
}

type WallpaperSnapshotStyle = CSSProperties & {
  '--shell-wallpaper-image': string;
  '--shell-wallpaper-position': string;
};

function readWallpaperImage(element: HTMLElement): string {
  return getComputedStyle(element).getPropertyValue('--shell-wallpaper-image').trim();
}

function readWallpaperPosition(element: HTMLElement): string {
  return (
    getComputedStyle(element).getPropertyValue('--shell-wallpaper-position').trim() || 'center'
  );
}

function BlurStackLayers() {
  return READING_BLUR_LAYERS.map((layer) => (
    <div key={layer} data-wallpaper-reading-blur-layer={layer} />
  ));
}

/** Keeps NewMax's progressive reading blur and old-wallpaper crossfade out of chat logic. */
export function WallpaperReadingLayers() {
  const stackRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<WallpaperSnapshot | null>(null);

  useEffect(() => {
    const node = snapshotRef.current;
    if (!node || !snapshot) return;
    const clear = (event?: AnimationEvent) => {
      if (event && (event.target !== node || event.animationName !== CROSSFADE_ANIMATION)) return;
      setSnapshot(null);
    };
    node.addEventListener('animationend', clear);
    node.addEventListener('animationcancel', clear);
    const fallback = window.setTimeout(() => clear(), 480);
    return () => {
      node.removeEventListener('animationend', clear);
      node.removeEventListener('animationcancel', clear);
      window.clearTimeout(fallback);
    };
  }, [snapshot]);

  useEffect(() => {
    const node = stackRef.current;
    if (!node) return;
    const root = document.documentElement;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let previousImage = readWallpaperImage(node);
    let previousPosition = readWallpaperPosition(node);
    let previousThemeActive = root.dataset.imageTheme === 'active';

    const observer = new MutationObserver(() => {
      const image = readWallpaperImage(node);
      const position = readWallpaperPosition(node);
      const themeActive = root.dataset.imageTheme === 'active';
      const stackVisible = getComputedStyle(node).display !== 'none';
      const shouldReduceMotion = root.hasAttribute('data-reduced-motion') || reducedMotion?.matches;

      if (
        !shouldReduceMotion &&
        stackVisible &&
        previousThemeActive &&
        themeActive &&
        previousImage &&
        image &&
        previousImage !== image
      ) {
        setSnapshot((current) => ({
          image: previousImage,
          position: previousPosition,
          key: (current?.key ?? 0) + 1,
        }));
      } else if (!themeActive || shouldReduceMotion || !stackVisible) {
        setSnapshot(null);
      }

      previousImage = image;
      previousPosition = position;
      previousThemeActive = themeActive;
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'data-image-theme',
        'data-image-theme-effect',
        'data-reduced-motion',
      ],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={stackRef} data-wallpaper-reading-blur-stack="true" aria-hidden="true">
        <BlurStackLayers />
      </div>
      {snapshot ? (
        <div
          ref={snapshotRef}
          key={snapshot.key}
          data-wallpaper-crossfade-snapshot="true"
          aria-hidden="true"
          style={
            {
              '--shell-wallpaper-image': snapshot.image,
              '--shell-wallpaper-position': snapshot.position,
            } as WallpaperSnapshotStyle
          }
        >
          <div data-wallpaper-crossfade-clear="true" />
          <div data-wallpaper-crossfade-base-blur="true" />
          <div data-wallpaper-reading-blur-stack="true" aria-hidden="true">
            <BlurStackLayers />
          </div>
        </div>
      ) : null}
    </>
  );
}
