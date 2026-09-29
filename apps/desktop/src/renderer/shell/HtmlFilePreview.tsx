import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { projectResourcePath } from './project-resource-path.js';

export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path.trim());
}

/** Source remains separate from the app DOM and receives no desktop bridge. */
export function htmlPreviewDocument(text: string, baseUrl?: string): string {
  if (!baseUrl) return text;
  const document = new DOMParser().parseFromString(text, 'text/html');
  // Keep relative styles, images and scripts relative to the original document.
  if (!document.querySelector('base[href]')) {
    const base = document.createElement('base');
    base.href = baseUrl;
    document.head.prepend(base);
  }
  return '<!doctype html>\n' + document.documentElement.outerHTML;
}

export function HtmlFilePreview({
  text,
  path,
  projectFolder,
  persisted = true,
}: {
  text: string;
  path: string;
  projectFolder?: string;
  persisted?: boolean;
}) {
  const [partition] = useState(() => `file-preview-${crypto.randomUUID()}`);
  const [localPage, setLocalPage] = useState<{ path: string; root: string; url: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const guest = useRef<HTMLElement>(null);
  const navigationSequence = useRef(0);
  const native = Boolean(window.syncThink?.runtime?.createLocalPageUrl && projectFolder);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLocalPage(null);
    const api = window.syncThink?.runtime;
    if (!native || !api?.createLocalPageUrl || !projectFolder) return;
    const relative = projectResourcePath(projectFolder, path);
    const filePath = projectFolder.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + relative;
    void api
      .createLocalPageUrl({ filePath, partition })
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.url) setLocalPage({ path, root: projectFolder, url: result.url });
        else setError(result.error || '网页预览加载失败');
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '网页预览加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [native, partition, path, projectFolder, revision]);

  const url = localPage?.path === path && localPage.root === projectFolder ? localPage.url : null;
  const source = useMemo(() => htmlPreviewDocument(text, url ?? undefined), [text, url]);
  // Use the original local origin for saved documents, including module scripts.
  // Unsaved edits render from memory; previewing never writes the file to disk.
  const src = url && persisted ? url : `data:text/html;charset=utf-8,${encodeURIComponent(source)}`;
  useEffect(() => {
    const element = guest.current;
    if (!element || !native || !url) return;
    const failed = (event: Event) => {
      const detail = event as Event & { errorCode?: number; isMainFrame?: boolean };
      if (detail.errorCode !== -3 && detail.isMainFrame !== false) setError('网页预览加载失败');
    };
    element.addEventListener('did-fail-load', failed);
    setError(null);
    // A fresh query reloads external saves without calling webview methods before dom-ready.
    element.setAttribute('src', persisted ? `${src}?preview=${++navigationSequence.current}` : src);
    return () => {
      element.removeEventListener('did-fail-load', failed);
    };
  }, [native, url, src, text, persisted, revision]);

  return (
    <section className="shell-html-preview" data-preview-kind="html" aria-label={`网页 ${path}`}>
      {error ? (
        <div role="alert" className="shell-file-pane-error">
          <span>{error}</span>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw size={14} />
            重试预览
          </button>
        </div>
      ) : null}
      {native ? (
        url ? (
          <webview
            ref={guest as never}
            partition={partition}
            webpreferences="sandbox=yes,contextIsolation=yes,nodeIntegration=no,webSecurity=yes"
            className="shell-html-preview__surface"
            title={`网页预览 ${path}`}
            data-testid="html-file-webview"
          />
        ) : !error ? (
          <p>正在载入网页…</p>
        ) : null
      ) : (
        <iframe
          title={`网页预览 ${path}`}
          className="shell-html-preview__surface"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={source}
          key={revision}
        />
      )}
    </section>
  );
}
