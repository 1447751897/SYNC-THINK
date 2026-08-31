/**
 * Renders a vendored brand logo (see brand-icons.ts).
 *
 * Mono logos are authored with `fill="currentColor"`; inside a data-URL <img>
 * that resolves to black, so they are painted as a CSS mask filled with the
 * inherited text color instead. Full-color logos render as a plain <img>.
 */
import type { CSSProperties } from 'react';
import type { BrandLogo } from './brand-icons.js';

/**
 * The esbuild `dataurl` loader keeps SVG attribute quotes as literal `"`, which
 * terminates the CSS `url("...")` string and silently drops the mask (renders a
 * solid color box with no shape). Percent-encode quotes (and #) so the mask
 * URL is parseable.
 */
function cssMaskUrl(src: string): string {
  return `url("${src.replace(/"/g, '%22').replace(/#/g, '%23')}")`;
}

function logoBoxStyle(logo: BrandLogo, size: number): CSSProperties {
  const scale = logo.opticalScale ?? 1;
  return {
    width: size,
    height: size,
    ...(scale !== 1 ? { transform: `scale(${scale})` } : {}),
  };
}

export function BrandLogoMark({
  logo,
  size = 18,
  className,
}: {
  logo: BrandLogo;
  size?: number;
  className?: string;
}) {
  const classes = ['shell-brand-logo', className].filter(Boolean).join(' ');
  const boxStyle = logoBoxStyle(logo, size);
  if (logo.mono) {
    const mask = cssMaskUrl(logo.src);
    return (
      <span
        className={`${classes} shell-brand-logo--mono`}
        role="img"
        aria-label={logo.label}
        style={{
          ...boxStyle,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
    );
  }
  return (
    <img
      className={classes}
      src={logo.src}
      alt={logo.label}
      width={size}
      height={size}
      draggable={false}
      style={boxStyle}
    />
  );
}
