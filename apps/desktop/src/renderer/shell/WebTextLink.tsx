import { describeExternalSource, ExternalSourceIcon } from './ExternalSourceIcon.js';
import { webLinkVisibleLabel } from './user-message-links.js';

/** Inline web link: icon + short title, dashed underline only on hover, full URL in title. */
export function WebTextLink({
  url,
  label,
  onOpen,
}: {
  url: string;
  label?: string;
  onOpen?: (url: string) => void;
}) {
  const source = describeExternalSource(url);
  const text = webLinkVisibleLabel(url, label);
  return (
    <a
      href={url}
      className="shell-web-link"
      title={url}
      aria-label={`打开网页 ${text}`}
      data-resource-kind="external"
      data-source-host={source.host}
      data-source-connector={source.connectorId ?? 'web'}
      onClick={(event) => {
        event.preventDefault();
        if (onOpen) onOpen(url);
        else void window.syncThink?.runtime?.openExternalUrl?.(url);
      }}
    >
      <ExternalSourceIcon url={url} size={13} />
      <span>{text}</span>
    </a>
  );
}
