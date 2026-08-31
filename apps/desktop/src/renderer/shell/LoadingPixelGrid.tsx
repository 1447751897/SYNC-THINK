import type { CSSProperties } from 'react';

const DRIVE_DELAYS = Array.from({ length: 9 }, (_, index) => {
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
      {DRIVE_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="shell-loading-pixel-grid__cell"
          style={{ '--shell-pixel-delay': `${delay}ms` } as CSSProperties}
        />
      ))}
    </span>
  );
}
