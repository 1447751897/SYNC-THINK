/**
 * Renders a vendored brand logo (see brand-icons.ts).
 *
 * Mono logos are authored with `fill="currentColor"`; inside a data-URL <img>
 * that resolves to black, so they are painted as a CSS mask filled with the
 * inherited text color instead. Full-color logos render as a plain <img>.
 */
import type { BrandLogo } from './brand-icons.js';

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
  if (logo.mono) {
    return (
      <span
        className={`${classes} shell-brand-logo--mono`}
        role="img"
        aria-label={logo.label}
        style={{
          width: size,
          height: size,
          maskImage: `url("${logo.src}")`,
          WebkitMaskImage: `url("${logo.src}")`,
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
    />
  );
}
