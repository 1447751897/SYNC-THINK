import type { CSSProperties } from 'react';

/** Beautiful UI Drive: (column + |row - 1|) × 90ms so two wavefronts stay in flight. */
export const LOADING_PIXEL_DRIVE_DELAYS_MS = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

export function LoadingPixelGrid({ className }: { className?: string }) {
  return (
    <span
      className={`shell-loading-pixel-grid${className ? ` ${className}` : ''}`}
      data-testid="loading-pixel-grid"
      aria-hidden="true"
    >
      {LOADING_PIXEL_DRIVE_DELAYS_MS.map((delay, index) => (
        <span
          key={index}
          className="shell-loading-pixel-grid__cell"
          style={{ '--shell-pixel-delay': `${delay}ms` } as CSSProperties}
        />
      ))}
    </span>
  );
}
