import { ChevronDown, LoaderCircle, UserRound } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { GitIdentity, GitIdentityResult, GitIdentityScope } from '../../git-contract.js';
import { gitIdentityAvatarUrl } from './git-identity-avatar.js';

const EMPTY: GitIdentity = { name: '', email: '' };

function IdentityAvatar({ identity }: { identity: GitIdentity }) {
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSource(undefined);
    setFailed(false);
    void gitIdentityAvatarUrl(identity.email).then(
      (url) => {
        if (active) setSource(url);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [identity.email]);
  return (
    <span className="shell-git-identity__avatar">
      {source && !failed ? (
        <img
          src={source}
          alt={(identity.name || '提交者') + '的头像'}
          referrerPolicy="no-referrer"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <UserRound size={18} aria-hidden="true" />
      )}
    </span>
  );
}

export function GitIdentityMenu({ root, disabled = false }: { root: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState<GitIdentityScope>('local');
  const [result, setResult] = useState<GitIdentityResult>();
  const [draft, setDraft] = useState<GitIdentity>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const [reload, setReload] = useState(0);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const settingsId = useId();
  const panelId = useId();
  const identity = result?.effectiveIdentity ?? result?.identity ?? EMPTY;

  useEffect(() => {
    const version = ++generation.current;
    setLoading(true);
    setError('');
    const api = window.syncThink?.runtime;
    void (async () => {
      try {
        if (!api?.gitReadIdentity) throw new Error('Git 身份接口未就绪，请重新启动应用');
        const next = await api.gitReadIdentity({ root, scope });
        if (version !== generation.current) return;
        if (!next.ok) throw new Error(next.error || '读取 Git 身份失败');
        setResult(next);
        setDraft(next.identity);
      } catch (caught) {
        if (version === generation.current)
          setError(caught instanceof Error ? caught.message : '读取 Git 身份失败');
      } finally {
        if (version === generation.current) setLoading(false);
      }
    })();
    return () => {
      generation.current += 1;
    };
  }, [root, scope, open, reload]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!anchor.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const width = Math.min(292, window.innerWidth - 16);
      const above = rect.top >= window.innerHeight - rect.bottom;
      setPosition({
        width,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
        maxHeight: Math.max(80, above ? rect.top - 16 : window.innerHeight - rect.bottom - 16),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (
        !saving &&
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !anchor.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!saving) {
        setOpen(false);
        anchor.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, saving]);

  async function save() {
    if (!expanded || loading || saving) return;
    const version = generation.current;
    setSaving(true);
    setError('');
    try {
      const api = window.syncThink?.runtime;
      if (!api?.gitWriteIdentity) throw new Error('Git 身份接口未就绪，请重新启动应用');
      const next = await api.gitWriteIdentity({
        root,
        scope,
        identity: { name: draft.name.trim(), email: draft.email.trim() },
      });
      if (version !== generation.current) return;
      if (!next.ok) throw new Error(next.error || '保存 Git 身份失败');
      setResult(next);
      setDraft(next.identity);
      setExpanded(false);
      setNotice(scope === 'local' ? '当前仓库身份已保存' : '全局身份已保存');
    } catch (caught) {
      if (version === generation.current)
        setError(caught instanceof Error ? caught.message : '保存 Git 身份失败');
    } finally {
      if (version === generation.current) setSaving(false);
    }
  }

  const changed =
    draft.name.trim() !== (result?.identity.name ?? '') ||
    draft.email.trim() !== (result?.identity.email ?? '');
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="shell-git-identity__trigger"
        aria-label="Git 提交身份"
        title={
          identity.name
            ? identity.name + (identity.email ? ' <' + identity.email + '>' : '')
            : '设置 Git 提交身份'
        }
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        disabled={disabled || saving}
        onClick={() => {
          setExpanded(false);
          setScope('local');
          setNotice('');
          setOpen((value) => !value);
        }}
      >
        <IdentityAvatar key={identity.email} identity={identity} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            className="shell-git-identity"
            style={position}
            role="dialog"
            aria-label="Git 提交身份设置"
            tabIndex={-1}
          >
            <header className="shell-git-identity__header">
              <IdentityAvatar key={identity.email} identity={identity} />
              <div>
                <strong>{identity.name || (loading ? '正在读取身份…' : '尚未设置姓名')}</strong>
                <span>{identity.email || '在 Git 设置中填写提交邮箱'}</span>
              </div>
            </header>
            <section className="shell-git-identity__settings">
              <button
                type="button"
                className="shell-git-identity__toggle"
                aria-expanded={expanded}
                aria-controls={settingsId}
                disabled={saving}
                onClick={() => {
                  setExpanded(!expanded);
                  setNotice('');
                }}
              >
                <span>
                  <strong>Git 设置</strong>
                  <span
                    className="shell-git-identity__subtitle"
                    data-collapsed={expanded}
                    aria-hidden={expanded}
                  >
                    <small>
                      <span>管理仓库或全局提交身份</span>
                    </small>
                  </span>
                </span>
                <ChevronDown
                  size={14}
                  className={expanded ? 'is-expanded' : undefined}
                  aria-hidden="true"
                />
              </button>
              <div
                id={settingsId}
                className="shell-git-identity__collapse"
                data-expanded={expanded}
                aria-hidden={!expanded}
                ref={(element) => {
                  if (element) element.inert = !expanded;
                }}
              >
                <div className="shell-git-identity__clip">
                  <form
                    className="shell-git-identity__form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void save();
                    }}
                  >
                    <div
                      className="shell-git-identity__scopes"
                      role="group"
                      aria-label="Git 身份配置范围"
                    >
                      {(['local', 'global'] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={scope === value}
                          disabled={saving}
                          onClick={() => {
                            setScope(value);
                            setNotice('');
                          }}
                        >
                          {value === 'local' ? '当前仓库' : '全局'}
                        </button>
                      ))}
                    </div>
                    <p className="shell-git-identity__hint">
                      {scope === 'local'
                        ? '只影响当前仓库，优先于全局配置。留空并保存可移除此项设置，恢复继承。'
                        : '作为所有仓库的默认提交身份。仓库内单独设置的姓名或邮箱优先使用。'}
                    </p>
                    <label>
                      姓名
                      <input
                        name="git-author-name"
                        aria-label="提交者姓名"
                        value={draft.name}
                        disabled={loading || saving}
                        autoComplete="off"
                        placeholder="此范围未设置"
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </label>
                    <label>
                      邮箱
                      <input
                        name="git-author-email"
                        aria-label="提交者邮箱"
                        value={draft.email}
                        disabled={loading || saving}
                        autoComplete="off"
                        inputMode="email"
                        placeholder="此范围未设置"
                        onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                      />
                    </label>
                    <div className="shell-git-identity__actions">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          setDraft(result?.identity ?? EMPTY);
                          setExpanded(false);
                          setError('');
                        }}
                      >
                        取消
                      </button>
                      <button
                        type="submit"
                        className="is-primary"
                        disabled={loading || saving || !changed || result?.scope !== scope}
                      >
                        {saving && <LoaderCircle size={12} className="shell-process-spin" />}
                        {saving ? '保存中…' : '保存'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </section>
            {error && (
              <div className="shell-git-identity__error" role="alert">
                {error}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setReload((value) => value + 1)}
                >
                  重新读取
                </button>
              </div>
            )}
            {notice && (
              <p className="shell-git-identity__notice" role="status">
                {notice}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
