import type { InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface SecretInputControlProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  containerClassName: string;
  visible: boolean;
  toggleDisabled?: boolean;
  revealLabel?: string;
  concealLabel?: string;
  onToggle(): void;
}

export function SecretInputControl({
  containerClassName,
  visible,
  toggleDisabled = false,
  revealLabel = '显示密钥',
  concealLabel = '隐藏密钥',
  onToggle,
  ...inputProps
}: SecretInputControlProps): JSX.Element {
  const actionLabel = visible ? concealLabel : revealLabel;
  return (
    <div className={containerClassName}>
      <input {...inputProps} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        title={actionLabel}
        aria-label={actionLabel}
        disabled={toggleDisabled}
        onClick={onToggle}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
