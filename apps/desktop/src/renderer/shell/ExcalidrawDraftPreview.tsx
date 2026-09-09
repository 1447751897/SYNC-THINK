import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  ExternalLink,
  FileImage,
  Image,
  LoaderCircle,
  Save,
  Shapes,
  Sparkles,
} from 'lucide-react';
import { ExcalidrawPreview } from './ExcalidrawPreview.js';
import {
  parseExcalidrawDocument,
  serializeExcalidrawDocument,
} from './excalidraw-document.js';
import type { ExcalidrawVendorHandle } from './excalidraw-vendor-loader.js';
import type { OpenHtmlInBrowser } from './html-browser.js';
import { HtmlSandbox } from './HtmlSandbox.js';

interface ExcalidrawDraftPreviewProps {
  code: string;
  projectFolder?: string;
  modelId?: string;
  onOpenInBrowser?: OpenHtmlInBrowser;
}

function designDraftBridge(): NonNullable<Window['syncThink']>['runtime'] | undefined {
  return window.syncThink?.runtime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

interface DesignGenerationSelection {
  frame: Record<string, unknown>;
  children: Record<string, unknown>[];
  targetId?: string;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Mirrors NewMax's magicframe selection semantics without depending on its plugin. */
function sceneSelection(document: {
  elements: unknown[];
  appState: Record<string, unknown>;
}): DesignGenerationSelection | null {
  const elements = document.elements.filter(
    (element): element is Record<string, unknown> =>
      isRecord(element) && element.isDeleted !== true,
  );
  if (elements.length === 0) return null;
  const selectedElementIds = isRecord(document.appState.selectedElementIds)
    ? document.appState.selectedElementIds
    : {};
  const selected = elements.filter(
    (element) => typeof element.id === 'string' && selectedElementIds[element.id] === true,
  );
  const selectedFrame = selected.find(
    (element) => element.type === 'magicframe' || element.type === 'frame',
  );
  const selectedChild = selected.find(
    (element) => element.type !== 'magicframe' && element.type !== 'frame',
  );
  const parentFrameId =
    selectedChild && typeof selectedChild.frameId === 'string' ? selectedChild.frameId : undefined;
  const parentFrame = parentFrameId
    ? elements.find(
        (element) =>
          element.id === parentFrameId &&
          (element.type === 'frame' || element.type === 'magicframe'),
      )
    : undefined;
  const frame =
    selectedFrame ??
    parentFrame ??
    elements.find(
      (element) =>
        (element.type === 'frame' || element.type === 'magicframe') &&
        elements.some(
          (child) =>
            child.frameId === element.id && child.type !== 'frame' && child.type !== 'magicframe',
        ),
    );

  let children =
    frame && typeof frame.id === 'string'
      ? elements.filter(
          (element) =>
            element.id !== frame.id &&
            element.frameId === frame.id &&
            element.type !== 'frame' &&
            element.type !== 'magicframe',
        )
      : [];
  if (children.length === 0) {
    if (frame) {
      // An explicitly selected frame follows NewMax's empty-frame behavior:
      // never pull unrelated scene elements into the generation request.
      children = selected.filter(
        (element) => element.type !== 'frame' && element.type !== 'magicframe',
      );
    } else {
      children = elements.filter(
        (element) => element.type !== 'frame' && element.type !== 'magicframe',
      );
    }
  }
  if (children.length === 0) return null;

  const frameBounds = frame
    ? {
        x: numberValue(frame.x),
        y: numberValue(frame.y),
        width: Math.max(1, numberValue(frame.width, 1)),
        height: Math.max(1, numberValue(frame.height, 1)),
      }
    : undefined;
  const bounds = children.reduce<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>(
    (result, child) => {
      const x = numberValue(child.x);
      const y = numberValue(child.y);
      const right = x + Math.max(0, numberValue(child.width));
      const bottom = y + Math.max(0, numberValue(child.height));
      return {
        minX: Math.min(result.minX, x),
        minY: Math.min(result.minY, y),
        maxX: Math.max(result.maxX, right),
        maxY: Math.max(result.maxY, bottom),
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
  const generatedFrame = frameBounds ?? {
    type: 'magicframe',
    x: Number.isFinite(bounds.minX) ? bounds.minX : 0,
    y: Number.isFinite(bounds.minY) ? bounds.minY : 0,
    width: Math.max(1, bounds.maxX - bounds.minX),
    height: Math.max(1, bounds.maxY - bounds.minY),
    name: 'AI design',
  };
  return {
    frame: frame ?? generatedFrame,
    children,
    ...(typeof frame?.id === 'string' ? { targetId: frame.id } : {}),
  };
}

function generationHtmlFromDocument(document: { elements: unknown[] }): string | null {
  for (const element of document.elements) {
    if (!isRecord(element) || element.isDeleted === true) continue;
    const customData = isRecord(element.customData) ? element.customData : undefined;
    const generationData =
      customData && isRecord(customData.generationData) ? customData.generationData : undefined;
    if (
      generationData?.status === 'done' &&
      typeof generationData.html === 'string' &&
      generationData.html.trim()
    ) {
      return generationData.html;
    }
  }
  return null;
}

function withGenerationHtml(
  document: {
    type: 'excalidraw';
    version: 2;
    elements: unknown[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  },
  selection: DesignGenerationSelection,
  html: string,
): string {
  const targetId =
    selection.targetId ??
    (typeof selection.children[0]?.id === 'string' ? selection.children[0].id : undefined);
  if (!targetId) return JSON.stringify(document, null, 2);
  const elements = document.elements.map((element) => {
    if (!isRecord(element) || element.id !== targetId) return element;
    const customData = isRecord(element.customData) ? element.customData : {};
    return {
      ...element,
      customData: {
        ...customData,
        generationData: { status: 'done', html },
      },
    };
  });
  return JSON.stringify({ ...document, elements }, null, 2);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

function browserViewerHtml(content: string, svg?: string): string {
  const pretty = JSON.stringify(JSON.parse(content), null, 2);
  const visual = svg?.trim()
    ? `<figure><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="Excalidraw 设计稿预览"></figure>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Excalidraw 设计稿</title><style>body{margin:0;padding:32px;background:Canvas;color:CanvasText;font:14px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}main{max-width:1100px;margin:0 auto;background:Canvas;border:1px solid ButtonBorder;border-radius:12px;padding:24px;box-shadow:0 12px 30px color-mix(in srgb, CanvasText 8%, transparent)}h1{font:600 20px/1.3 system-ui,sans-serif;margin:0 0 18px}figure{margin:0 0 24px;padding:16px;border:1px solid ButtonBorder;border-radius:8px;background:ButtonFace;text-align:center}figure img{display:block;max-width:100%;height:auto;margin:0 auto}pre{margin:0;white-space:pre-wrap;overflow:auto}</style></head><body><main><h1>Excalidraw 设计稿</h1>${visual}<details><summary>查看场景数据</summary><pre>${escapeHtml(pretty)}</pre></details></main></body></html>`;
}

export function ExcalidrawDraftPreview({
  code,
  projectFolder,
  modelId,
  onOpenInBrowser,
}: ExcalidrawDraftPreviewProps) {
  const parsed = useMemo(() => parseExcalidrawDocument(code), [code]);
  const [draft, setDraft] = useState(code);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<'png' | 'svg' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const handleRef = useRef<ExcalidrawVendorHandle | null>(null);
  const [editorReady, setEditorReady] = useState(false);

  useEffect(() => {
    if (dirty || !parsed.ok) return;
    setDraft(code);
  }, [code, dirty, parsed.ok]);

  const draftParsed = useMemo(() => parseExcalidrawDocument(draft), [draft]);
  const generationSelection = useMemo(
    () => (draftParsed.ok ? sceneSelection(draftParsed.document) : null),
    [draftParsed],
  );
  useEffect(() => {
    if (!dirty && parsed.ok) setGeneratedHtml(generationHtmlFromDocument(parsed.document));
  }, [dirty, parsed]);

  const projectPath = 'designs/ai-drawing.excalidraw';
  const browserProjectPath = 'designs/ai-drawing.html';
  const generatedProjectPath = 'designs/ai-generated-design.html';

  const handleEditorHandle = useCallback((handle: ExcalidrawVendorHandle | null) => {
    handleRef.current = handle;
    setEditorReady(Boolean(handle));
  }, []);

  const handleDownload = useCallback(() => {
    if (!parseExcalidrawDocument(draft).ok) return;
    const url = URL.createObjectURL(new Blob([draft], { type: 'application/vnd.excalidraw+json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = projectPath.split('/').at(-1) ?? 'ai-drawing.excalidraw';
    try {
      anchor.click();
      setNotice(`已下载 ${anchor.download}`);
    } catch {
      setNotice('下载失败，请重试');
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }, [draft]);

  const handleExport = useCallback(
    async (format: 'png' | 'svg') => {
      if (!handleRef.current || exporting) return;
      setExporting(format);
      setNotice(null);
      try {
        const blob =
          format === 'png'
            ? await handleRef.current.exportPng()
            : await handleRef.current.exportSvg();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `ai-drawing.${format}`;
        anchor.click();
        setNotice(`已导出 ${anchor.download}`);
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : `${format.toUpperCase()} 导出失败`);
      } finally {
        setExporting(null);
      }
    },
    [exporting],
  );

  const handleSave = useCallback(async () => {
    if (!projectFolder || saving || !parseExcalidrawDocument(draft).ok) return;
    const bridge = designDraftBridge();
    if (!bridge?.readProjectFile || !bridge.writeProjectFile) {
      setNotice('当前环境不支持保存项目文件');
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const current = await bridge.readProjectFile({ root: projectFolder, path: projectPath });
      if (
        current.error &&
        current.errorCode !== 'file_not_found' &&
        current.errorCode !== 'file_too_large'
      ) {
        setNotice(current.error);
        return;
      }
      const result = await bridge.writeProjectFile({
        root: projectFolder,
        path: projectPath,
        content: draft,
        expectedMtimeMs: current.errorCode === 'file_not_found' ? null : current.mtimeMs,
        expectedSize: current.errorCode === 'file_not_found' ? null : current.size,
      });
      if (result.conflict) setNotice('目标文件刚刚发生变化，请再次保存');
      else if (!result.ok) setNotice(result.error ?? '保存失败，请重试');
      else {
        setDirty(false);
        setNotice(`已保存到 ${result.path}`);
      }
    } catch {
      setNotice('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [draft, projectFolder, saving]);

  const handleGenerate = useCallback(async () => {
    if (generating) return;
    const liveDocument = handleRef.current?.getCurrentDocument();
    const liveSelection = liveDocument ? sceneSelection(liveDocument) : generationSelection;
    if (!liveSelection) {
      setNotice('请先在画布中选择一个框架或至少一个图形');
      return;
    }
    const bridge = designDraftBridge();
    if (!bridge?.generateDesign) {
      setNotice('当前环境不支持 AI 设计稿生成');
      return;
    }
    setGenerating(true);
    setNotice(null);
    const randomId =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `design-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const response = await bridge.generateDesign({
        requestId: randomId,
        ...(modelId
          ? { modelId: modelId as Parameters<typeof bridge.generateDesign>[0]['modelId'] }
          : {}),
        frame: liveSelection.frame,
        children: liveSelection.children,
      });
      if (!response || typeof response.html !== 'string' || !response.html.trim()) {
        throw new Error('模型没有返回有效的设计稿');
      }
      setGeneratedHtml(response.html);
      const currentDocument = liveDocument
        ? parseExcalidrawDocument(
            serializeExcalidrawDocument(
              liveDocument.elements,
              liveDocument.appState,
              liveDocument.files,
            ),
          )
        : draftParsed;
      if (currentDocument.ok) {
        const nextDraft = withGenerationHtml(
          currentDocument.document,
          liveSelection,
          response.html,
        );
        setDraft(nextDraft);
        setDirty(true);
      }
      setNotice('设计稿已生成，可预览、保存或在浏览器中打开');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '设计稿生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  }, [draftParsed, generationSelection, generating, modelId]);

  const handleSaveGenerated = useCallback(async () => {
    if (!generatedHtml || !projectFolder) return;
    const bridge = designDraftBridge();
    if (!bridge?.readProjectFile || !bridge.writeProjectFile) {
      setNotice('当前环境不支持保存项目文件');
      return;
    }
    try {
      const current = await bridge.readProjectFile({
        root: projectFolder,
        path: generatedProjectPath,
      });
      const metadataOnlyError =
        current.errorCode === 'file_too_large' && current.mtimeMs !== null && current.size !== null;
      if (current.error && current.errorCode !== 'file_not_found' && !metadataOnlyError) {
        setNotice(current.error);
        return;
      }
      const result = await bridge.writeProjectFile({
        root: projectFolder,
        path: generatedProjectPath,
        content: generatedHtml,
        expectedMtimeMs: current.errorCode === 'file_not_found' ? null : current.mtimeMs,
        expectedSize: current.errorCode === 'file_not_found' ? null : current.size,
      });
      if (result.conflict) setNotice('目标设计稿刚刚发生变化，请再次保存');
      else if (!result.ok) setNotice(result.error ?? '设计稿保存失败，请重试');
      else setNotice(`已保存到 ${result.path}`);
    } catch {
      setNotice('设计稿保存失败，请重试');
    }
  }, [generatedHtml, generatedProjectPath, projectFolder]);

  const handleDownloadGenerated = useCallback(() => {
    if (!generatedHtml) return;
    const url = URL.createObjectURL(new Blob([generatedHtml], { type: 'text/html;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = generatedProjectPath.split('/').at(-1) ?? 'ai-generated-design.html';
    anchor.click();
    setNotice(`已下载 ${anchor.download}`);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [generatedHtml, generatedProjectPath]);

  const handleOpenGeneratedInBrowser = useCallback<OpenHtmlInBrowser>(
    async (html, options) => {
      if (!onOpenInBrowser) {
        const bridge = designDraftBridge();
        if (!bridge?.openHtmlInBrowser) {
          setNotice('当前环境不支持在浏览器中打开');
          return;
        }
        const result = await bridge.openHtmlInBrowser(html);
        if (!result.ok) setNotice(result.error ?? '打开失败');
        return;
      }
      await onOpenInBrowser(html, {
        relativePath: generatedProjectPath,
        persist: true,
        ...options,
      });
    },
    [generatedProjectPath, onOpenInBrowser],
  );

  const handleOpenInBrowser = useCallback(async () => {
    if (!parseExcalidrawDocument(draft).ok) return;
    let svg: string | undefined;
    try {
      // Export the same live scene the user sees. The browser tab is a
      // read-only handoff, while the editable source remains the .excalidraw
      // project file saved by the action beside it.
      const exported = await handleRef.current?.exportSvg();
      if (exported) svg = await exported.text();
    } catch {
      // A JSON fallback still gives the user a useful, deterministic handoff
      // when the lazy vendor is not ready or export is unavailable.
    }
    const html = browserViewerHtml(draft, svg);
    try {
      if (onOpenInBrowser) {
        await onOpenInBrowser(html, { relativePath: browserProjectPath, persist: true });
        return;
      }
      const bridge = window.syncThink?.runtime;
      if (!bridge?.openHtmlInBrowser) {
        setNotice('当前环境不支持在浏览器中打开');
        return;
      }
      const result = await bridge.openHtmlInBrowser(html);
      if (!result.ok) setNotice(result.error ?? '打开失败');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '打开失败');
    }
  }, [browserProjectPath, draft, onOpenInBrowser]);

  if (!parsed.ok) {
    return (
      <section className="shell-excalidraw-draft shell-excalidraw-error" role="alert">
        <strong>设计稿</strong>
        <span>{parsed.error}</span>
      </section>
    );
  }

  return (
    <section className="shell-excalidraw-draft" data-testid="excalidraw-draft-preview">
      <header className="shell-excalidraw-draft__bar">
        <span className="shell-excalidraw-draft__identity">
          <Shapes size={14} aria-hidden="true" />
          <span>设计稿</span>
        </span>
        <div className="shell-excalidraw-draft__actions">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating || !generationSelection}
            title={generationSelection ? '将选中的框架转换为可运行网页' : '请先选择框架或图形'}
            aria-busy={generating}
          >
            {generating ? (
              <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles size={13} aria-hidden="true" />
            )}
            <span>{generating ? '生成中' : '生成网页'}</span>
          </button>
          <button type="button" onClick={handleDownload} title="下载 Excalidraw 文件">
            <Download size={13} aria-hidden="true" />
            <span>下载</span>
          </button>
          <button
            type="button"
            onClick={() => void handleExport('png')}
            disabled={!editorReady || Boolean(exporting)}
            title="导出 PNG 图片"
          >
            {exporting === 'png' ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <Image size={13} />
            )}
            <span>{exporting === 'png' ? '导出中' : 'PNG'}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleExport('svg')}
            disabled={!editorReady || Boolean(exporting)}
            title="导出 SVG 图片"
          >
            {exporting === 'svg' ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <FileImage size={13} />
            )}
            <span>{exporting === 'svg' ? '导出中' : 'SVG'}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleOpenInBrowser()}
            title="在浏览器中查看设计稿"
          >
            <ExternalLink size={13} aria-hidden="true" />
            <span>浏览器打开</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!projectFolder || saving}
            title={projectFolder ? `保存到 ${projectPath}` : '打开项目后可保存设计稿'}
          >
            {saving ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />}
            <span>{saving ? '保存中' : '保存到项目'}</span>
          </button>
        </div>
      </header>
      {notice ? (
        <div className="shell-excalidraw-draft__notice" role="status">
          {notice}
        </div>
      ) : null}
      <div className="shell-excalidraw-draft__canvas">
        <ExcalidrawPreview
          content={draft}
          onHandle={handleEditorHandle}
          onChange={(next) => {
            setDraft(next);
            setDirty(true);
          }}
        />
      </div>
      {generatedHtml ? (
        <div
          className="shell-excalidraw-draft__generated"
          data-testid="excalidraw-generated-design"
        >
          <HtmlSandbox
            code={generatedHtml}
            onOpenInBrowser={handleOpenGeneratedInBrowser}
            actions={
              <>
                <button
                  type="button"
                  className="shell-md-code__action"
                  onClick={handleDownloadGenerated}
                  title="下载生成的 HTML 设计稿"
                >
                  <Download size={12} aria-hidden="true" />
                  <span>下载</span>
                </button>
                <button
                  type="button"
                  className="shell-md-code__action"
                  onClick={() => void handleSaveGenerated()}
                  disabled={!projectFolder}
                  title={
                    projectFolder ? `保存到 ${generatedProjectPath}` : '打开项目后可保存设计稿'
                  }
                >
                  <Save size={12} aria-hidden="true" />
                  <span>保存到项目</span>
                </button>
              </>
            }
          />
        </div>
      ) : null}
    </section>
  );
}
