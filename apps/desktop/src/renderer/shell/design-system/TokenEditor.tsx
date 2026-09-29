import { useEffect, useState } from 'react';
import { CopyTextButton } from '../CopyTextButton.js';
import { TOKEN_CATALOG } from './catalog.generated.js';
import { validTokenValue } from './theme.js';
type Token = (typeof TOKEN_CATALOG)[number];
export function TokenEditor({
  token,
  value,
  onChange,
  label,
  compact = false,
}: {
  token: Token;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(value);
    setError('');
  }, [value]);
  const commit = () => {
    if (!validTokenValue(token.name, draft)) {
      setError('请输入有效的 CSS 值');
      return;
    }
    if (draft.trim() !== value) onChange(draft.trim());
    setError('');
  };
  const isColor = /^(#|rgb|hsl|oklch|color-mix)/.test(value) && !/shadow/.test(token.name);
  return (
    <div className={`ds-token-editor ${compact ? 'is-compact' : ''}`}>
      <div className="ds-token-identity">
        {isColor ? (
          /^#[\da-f]{6}$/i.test(value) ? (
            <input
              type="color"
              className="ds-color-input"
              aria-label={`${token.name} 取色`}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                setDraft(e.target.value);
              }}
            />
          ) : (
            <span className="ds-value-swatch" style={{ background: value }} />
          )
        ) : (
          <span className="ds-value-mark">Aa</span>
        )}
        <div>
          <strong>{label ?? token.name}</strong>
          {compact && <code>{token.name}</code>}
        </div>
        {!compact && <span className="ds-token-group">{token.group}</span>}
      </div>
      <div className="ds-token-input-row">
        <input
          aria-label={token.name}
          aria-invalid={!!error}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(value);
              setError('');
            }
          }}
        />
        <CopyTextButton text={`${token.name}: ${value};`} label={`复制 ${token.name}`} compact />
      </div>
      {error && (
        <small role="alert" className="ds-input-error">
          {error}
        </small>
      )}
    </div>
  );
}
