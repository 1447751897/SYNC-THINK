import { useState } from 'react';
import { BrandLogoMark } from './BrandLogoMark.js';
import {
  PROVIDER_BRAND_LOGOS,
  resolveProviderBrandLogo,
  resolveProviderBrandLogoByName,
} from './brand-icons.js';
import { useProviderIcon } from './provider-icons.js';

export function ProviderIdentityMark({
  providerId,
  name,
  size = 18,
  fallbackLetter,
}: {
  providerId?: string;
  name: string;
  size?: number;
  fallbackLetter?: string;
}) {
  const icon = useProviderIcon(providerId);
  const [failedImage, setFailedImage] = useState<string>();
  if (icon?.kind === 'image' && failedImage !== icon.dataUrl)
    return (
      <img
        className="provider-identity-mark__image"
        src={icon.dataUrl}
        alt={name}
        width={size}
        height={size}
        draggable={false}
        onError={() => setFailedImage(icon.dataUrl)}
      />
    );
  const logo =
    (icon?.kind === 'brand' ? PROVIDER_BRAND_LOGOS[icon.brandId] : undefined) ??
    (providerId ? resolveProviderBrandLogo(providerId) : undefined) ??
    resolveProviderBrandLogoByName(name);
  if (logo) return <BrandLogoMark logo={logo} size={size} />;
  return (
    <span
      className="provider-identity-mark__letter"
      role="img"
      aria-label={name}
      style={{ width: size, height: size }}
    >
      {fallbackLetter ?? (name.trim().slice(0, 1).toLocaleUpperCase() || '?')}
    </span>
  );
}
