// Lazy, client-side mermaid renderer. The mermaid library itself is shipped as
// a separate vendor chunk (see build-shell.mjs + mermaid-vendor-loader) and is
// only fetched on the first ```mermaid block. Charts render in a mounted effect
// so streaming partial blocks never trigger a render (MarkdownContent only
// mounts this once a block is complete and not streaming).
//
// The card chrome (collapse button, 预览/源码 view tabs, source view) reuses
// the shared block-control classes defined for the HTML sandbox
// (shell-html__collapse / shell-html__view-tabs / shell-html__source...).
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  FileCode2,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { loadMermaidVendor } from './mermaid-vendor-loader.js';
import { highlightSource } from './highlight.js';

interface MermaidChartProps {
  code: string;
}

type RenderState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; message: string };

type ViewMode = 'preview' | 'source';

function uniqueId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sync-mermaid-${rand}`;
}

export function MermaidChart({ code }: MermaidChartProps) {
  const [state, setState] = useState<RenderState>({ status: 'loading' });
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<ViewMode>('preview');
  const [copied, setCopied] = useState(false);

  const render = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const vendor = await loadMermaidVendor();
      const dark = document.documentElement.classList.contains('dark');
      vendor.initialize({
        startOnLoad: false,
        theme: dark ? 'dark' : 'default',
        securityLevel: 'strict',
      });
      const { svg } = await vendor.render(uniqueId(), code);
      setState({ status: 'ready', svg });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [code]);

  useEffect(() => {
    void render();
  }, [render]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore clipboard failures */
    }
  }, [code]);

  return (
    <div className="shell-mermaid">
      <div className="shell-mermaid__bar">
        <div className="shell-html__bar-left">
          <button
            type="button"
            className="shell-html__collapse"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? '展开图表预览' : '收起图表预览'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
          <span className="shell-md-code__lang">mermaid</span>
        </div>
        <div className="shell-html__view-tabs">
          <button
            type="button"
            className={`shell-html__view-tab${view === 'preview' ? ' is-active' : ''}`}
            onClick={() => setView('preview')}
            aria-pressed={view === 'preview'}
          >
            <Eye size={12} />
            <span>预览</span>
          </button>
          <button
            type="button"
            className={`shell-html__view-tab${view === 'source' ? ' is-active' : ''}`}
            onClick={() => setView('source')}
            aria-pressed={view === 'source'}
          >
            <FileCode2 size={12} />
            <span>源码</span>
          </button>
        </div>
        <div className="shell-md-code__actions">
          <button
            type="button"
            className="shell-md-code__action"
            onClick={() => void handleCopy()}
            title="复制 mermaid 源码"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? '已复制' : '复制源码'}</span>
          </button>
        </div>
      </div>
      {!collapsed ? (
        view === 'source' ? (
          <div className="shell-html__source">
            <pre className="shell-html__source-pre">
              <code
                className="hljs"
                dangerouslySetInnerHTML={{ __html: highlightSource(code, 'mermaid') }}
              />
            </pre>
          </div>
        ) : state.status === 'loading' ? (
          <div className="shell-mermaid--loading" role="status">
            <Loader2 size={15} aria-hidden="true" className="shell-mermaid__spinner" />
            <span>正在渲染图表…</span>
          </div>
        ) : state.status === 'error' ? (
          <div className="shell-mermaid--error">
            <div className="shell-mermaid__error-head">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>图表渲染失败</span>
              <button
                type="button"
                className="shell-md-code__action"
                onClick={() => void render()}
                title="重试渲染"
              >
                <RotateCcw size={12} />
                <span>重试</span>
              </button>
            </div>
            <div className="shell-mermaid__error-msg">{state.message}</div>
          </div>
        ) : (
          <div
            className="shell-mermaid__canvas"
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
        )
      ) : null}
    </div>
  );
}
