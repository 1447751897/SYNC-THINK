import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Check, Download, Moon, Palette, RotateCcw, Sun, Upload } from 'lucide-react';
import { TOKEN_CATALOG } from './catalog.generated.js';
import {
  PRESETS,
  newDraft,
  parseDraft,
  themeValues,
  type DesignDraft,
  type ThemeValues,
} from './theme.js';
import { TokenEditor } from './TokenEditor.js';
const quickTokens = [
  '--color-accent',
  '--color-text',
  '--color-text-secondary',
  '--color-border',
  '--color-page',
  '--color-panel',
];
const quickLabels = ['强调色', '主要文字', '次要文字', '边框', '页面背景', '面板背景'];
export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ThemeInspector({
  draft,
  setDraft,
  values,
  storageStatus,
  onOpenTokens,
  update,
}: {
  draft: DesignDraft;
  setDraft: Dispatch<SetStateAction<DesignDraft>>;
  values: ThemeValues;
  storageStatus: string;
  onOpenTokens: () => void;
  update: (name: string, value: string) => void;
}) {
  const [status, setStatus] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const modified =
    Object.keys(draft.overrides.light).length + Object.keys(draft.overrides.dark).length;
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 200000) throw new Error('文件超过 200 KB');
      setDraft(parseDraft(await file.text()));
      setStatus('主题草稿已导入。');
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : '格式错误'}`);
    }
  };

  return (
    <aside className="ds-inspector" aria-label="主题编辑器">
      <div className="ds-inspector__sticky">
        <header className="ds-inspector__header">
          <div>
            <span className="ds-eyebrow">LIVE INSPECTOR</span>
            <h2>主题工作台</h2>
            <p>隔离预览 · 不影响当前工作区</p>
          </div>
          <Palette size={18} />
        </header>
        <section className="ds-inspector__section">
          <span className="ds-inspector__label">外观模式</span>
          <div className="ds-mode-switch">
            {(['light', 'dark'] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                className={draft.mode === mode ? 'is-active' : ''}
                aria-pressed={draft.mode === mode}
                onClick={() => setDraft((d) => ({ ...d, mode }))}
              >
                {mode === 'light' ? <Sun size={14} /> : <Moon size={14} />}{' '}
                {mode === 'light' ? '浅色' : '深色'}
              </button>
            ))}
          </div>
        </section>
        <section className="ds-inspector__section">
          <span className="ds-inspector__label">主题底色</span>
          <div className="ds-preset-list">
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.id}
                className={draft.preset === p.id ? 'is-active' : ''}
                aria-pressed={draft.preset === p.id}
                onClick={() => setDraft((d) => ({ ...d, preset: p.id }))}
              >
                <span
                  className="ds-preset-swatch"
                  style={{
                    background: themeValues({
                      ...newDraft(),
                      preset: p.id,
                      mode: draft.mode,
                    })['--color-accent'],
                  }}
                />
                <span>
                  <strong>{p.label}</strong>
                  <small>{p.detail}</small>
                </span>
                {draft.preset === p.id && <Check size={14} />}
              </button>
            ))}
          </div>
          <p className="ds-hint">手动覆盖优先于预设；明暗修改分别保留。</p>
        </section>
        <section className="ds-inspector__section">
          <span className="ds-inspector__label">核心颜色 / 输入或取色</span>
          {quickTokens.map((name, i) => (
            <TokenEditor
              key={`${draft.mode}-${name}`}
              token={TOKEN_CATALOG.find((t) => t.name === name)!}
              value={values[name]}
              label={quickLabels[i]}
              onChange={(v) => update(name, v)}
              compact
            />
          ))}
          <button type="button" className="ds-inline-link" onClick={() => onOpenTokens()}>
            编辑全部 {TOKEN_CATALOG.length} 个 token →
          </button>
        </section>
        <section className="ds-inspector__section">
          <span className="ds-inspector__label">几何 / 真实变量</span>
          {['--radius-card', '--radius-row'].map((name) =>
            TOKEN_CATALOG.some((t) => t.name === name) ? (
              <label className="ds-slider-row" key={name}>
                <span>{name === '--radius-card' ? '卡片圆角' : '行圆角'}</span>
                <input
                  aria-label={name}
                  type="range"
                  min="0"
                  max="24"
                  value={parseFloat(values[name]) || 0}
                  onChange={(e) => update(name, `${e.target.value}px`)}
                />
                <output>{values[name]}</output>
              </label>
            ) : null,
          )}
        </section>
        <footer className="ds-inspector__footer">
          <span>
            {modified} 项覆盖 · {storageStatus}
          </span>
          <button
            type="button"
            aria-label="重置主题"
            onClick={() => {
              setDraft(newDraft());
              setStatus('已恢复默认主题，清除全部手动覆盖。');
            }}
          >
            <RotateCcw size={12} />
            重置
          </button>
        </footer>
        <div className="ds-draft-actions">
          <button
            type="button"
            className="ds-button ds-button--secondary"
            onClick={() => {
              download('sync-think-theme.json', JSON.stringify(draft, null, 2), 'application/json');
              setStatus('已导出可再次导入的主题草稿。');
            }}
          >
            <Download size={13} />
            导出 JSON
          </button>
          <button
            type="button"
            className="ds-button ds-button--secondary"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={13} />
            导入
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="导入主题 JSON"
            onChange={(e) => {
              void importFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <p className="ds-notice" role="status">
          {status || '修改会自动保存到此浏览器的独立草稿。'}
        </p>
      </div>
    </aside>
  );
}
