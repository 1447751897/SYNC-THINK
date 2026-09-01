import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, LoaderCircle, PanelsTopLeft, Save } from 'lucide-react';
import { HtmlSandbox } from './HtmlSandbox.js';
import { deriveDesignDraftPath, parseDesignHtml } from './design-draft.js';

interface DesignDraftPreviewProps {
  code: string;
  projectFolder?: string;
}

type DraftNotice = {
  tone: 'error' | 'warning' | 'success';
  message: string;
};

function designDraftBridge(): NonNullable<Window['syncThink']>['runtime'] | undefined {
  return window.syncThink?.runtime;
}

export function DesignDraftPreview({ code, projectFolder }: DesignDraftPreviewProps) {
  const parsed = useMemo(() => parseDesignHtml(code), [code]);
  const [lastValidHtml, setLastValidHtml] = useState<string | null>(
    parsed.ok ? parsed.html : null,
  );
  const [notice, setNotice] = useState<DraftNotice | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!parsed.ok) return;
    setLastValidHtml(parsed.html);
    setNotice(null);
  }, [parsed]);

  const activeHtml = parsed.ok ? parsed.html : lastValidHtml;
  const projectPath = useMemo(
    () => (activeHtml ? deriveDesignDraftPath(activeHtml) : 'designs/ai-design.html'),
    [activeHtml],
  );

  const handleDownload = useCallback(() => {
    if (!activeHtml) return;
    setNotice(null);
    let url: string | null = null;
    try {
      const blob = new Blob([activeHtml], { type: 'text/html;charset=utf-8' });
      url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = projectPath.split('/').at(-1) ?? 'ai-design.html';
      anchor.click();
      setNotice({ tone: 'success', message: `已下载 ${anchor.download}` });
    } catch {
      setNotice({ tone: 'error', message: '下载失败，请重试' });
    } finally {
      if (url) {
        const objectUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }
    }
  }, [activeHtml, projectPath]);

  const handleSave = useCallback(async () => {
    if (!activeHtml || !projectFolder || saving) return;
    const bridge = designDraftBridge();
    if (!bridge?.readProjectFile || !bridge.writeProjectFile) {
      setNotice({ tone: 'error', message: '当前环境不支持保存项目文件' });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const current = await bridge.readProjectFile({ root: projectFolder, path: projectPath });
      const hasUsableMetadata =
        current.errorCode === 'file_too_large' && current.mtimeMs !== null && current.size !== null;
      if (current.error && current.errorCode !== 'file_not_found' && !hasUsableMetadata) {
        setNotice({ tone: 'error', message: current.error });
        return;
      }
      const result = await bridge.writeProjectFile({
        root: projectFolder,
        path: projectPath,
        content: activeHtml,
        expectedMtimeMs: current.errorCode === 'file_not_found' ? null : current.mtimeMs,
        expectedSize: current.errorCode === 'file_not_found' ? null : current.size,
      });
      if (result.conflict) {
        setNotice({ tone: 'error', message: '目标文件刚刚发生变化，请再次保存' });
      } else if (!result.ok) {
        setNotice({ tone: 'error', message: result.error ?? '保存失败，请重试' });
      } else {
        setNotice({ tone: 'success', message: `已保存到 ${result.path}` });
      }
    } catch {
      setNotice({ tone: 'error', message: '保存失败，请重试' });
    } finally {
      setSaving(false);
    }
  }, [activeHtml, projectFolder, projectPath, saving]);

  if (!activeHtml) {
    return (
      <section className="shell-design-draft-invalid" role="alert">
        <div className="shell-design-draft-invalid__title">
          <PanelsTopLeft size={14} aria-hidden="true" />
          <span>设计稿</span>
        </div>
        <div className="shell-design-draft-invalid__message">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{parsed.ok ? '设计稿内容为空' : parsed.error}</span>
        </div>
      </section>
    );
  }

  const visibleNotice: DraftNotice | null = !parsed.ok
    ? { tone: 'warning', message: `新版本未通过校验，已保留上一版：${parsed.error}` }
    : notice;

  return (
    <HtmlSandbox
      code={activeHtml}
      appearance="design"
      notice={visibleNotice}
      actions={
        <>
          <button
            type="button"
            className="shell-md-code__action"
            onClick={handleDownload}
            title="下载 HTML 设计稿"
          >
            <Download size={12} aria-hidden="true" />
            <span>下载</span>
          </button>
          <button
            type="button"
            className="shell-md-code__action shell-design-draft__save"
            onClick={() => void handleSave()}
            title={projectFolder ? `保存到 ${projectPath}` : '打开项目后可保存设计稿'}
            disabled={!projectFolder || saving}
            aria-busy={saving}
          >
            {saving ? (
              <LoaderCircle className="shell-design-draft__spinner" size={12} aria-hidden="true" />
            ) : (
              <Save size={12} aria-hidden="true" />
            )}
            <span>{saving ? '保存中' : '保存到项目'}</span>
          </button>
        </>
      }
    />
  );
}
