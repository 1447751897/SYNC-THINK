import { Component, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { installPreviewRuntime } from './runtime.js';
import { installVisualizationGuestPreview } from './visualization-guest.js';
import { newDraft, themeValues } from '../theme.js';
import { DOCUMENTED_COMPONENTS } from '../catalog.js';
installPreviewRuntime();
installVisualizationGuestPreview();
const params = new URLSearchParams(location.search);
let previewName = params.get('component') ?? 'ComposerEditor';
document.body.dataset.fixture = previewName;
const variant = params.get('variant') ?? 'default';
const root = document.getElementById('root')!;
function applyTheme(values: Record<string, string>, mode: string) {
  for (const [key, value] of Object.entries(values))
    if (key.startsWith('--')) document.documentElement.style.setProperty(key, value);
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.documentElement.style.colorScheme = mode;
}
applyTheme(
  themeValues({ ...newDraft(), mode: params.get('mode') === 'dark' ? 'dark' : 'light' }),
  params.get('mode') ?? 'light',
);
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (event.data?.type === 'sync-design-theme') applyTheme(event.data.values, event.data.mode);
});
function report(status: string, detail = '') {
  document.body.dataset.previewStatus = status;
  parent.postMessage(
    { type: 'sync-design-preview', name: previewName, status, detail },
    location.origin === 'null' ? '*' : location.origin,
  );
}
window.addEventListener('error', (event) => report('error', event.message));
window.addEventListener('unhandledrejection', (event) => report('error', String(event.reason)));
class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error) {
    report('error', error.message);
  }
  render() {
    return this.state.error ? (
      <div role="alert" className="sf-failure">
        预览异常：{this.state.error}
      </div>
    ) : (
      this.props.children
    );
  }
}
async function renderPreview() {
  const archived = DOCUMENTED_COMPONENTS.some((c) => c.legacy && c.name === previewName);
  const { Showcase } = await import('./Showcase.js');
  const { LegacyShowcase } = await import('./LegacyShowcase.js');
  createRoot(root).render(
    <Boundary>
      {archived ? (
        <LegacyShowcase name={previewName} />
      ) : (
        <Showcase name={previewName} variant={variant} />
      )}
    </Boundary>,
  );
  window.setTimeout(() => {
    if (document.body.dataset.previewStatus !== 'error')
      report('ready', document.body.innerText.slice(0, 1500));
  }, 650);
}
function Audit() {
  const names = DOCUMENTED_COMPONENTS.filter(
    (c) =>
      (!params.has('legacy') || c.legacy) &&
      (!params.get('names') || params.get('names')!.split(',').includes(c.name)),
  ).map((c) => c.name);
  const [index, setIndex] = useState(-1);
  const [observations, setObservations] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  useEffect(() => {
    if (index < 0 || index >= names.length) return;
    let finished = false;
    const finish = (status: string) => {
      if (finished) return;
      finished = true;
      setResults((r) => ({ ...r, [names[index]]: status }));
      setIndex((i) => i + 1);
    };
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'sync-design-preview' && event.data.name === names[index]) {
        setObservations((r) => ({ ...r, [names[index]]: event.data.detail }));
        finish(event.data.status === 'ready' ? 'OK' : event.data.detail);
      }
    };
    window.addEventListener('message', handler);
    const timer = setTimeout(() => finish('TIMEOUT'), 6000);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('message', handler);
    };
  }, [index]);
  return (
    <div style={{ padding: 20, height: '100%', overflow: 'auto' }}>
      <h1>组件渲染检查</h1>
      <button
        onClick={() => {
          setResults({});
          setIndex(0);
        }}
      >
        检查全部组件预览
      </button>
      <p role="status">
        {Object.keys(results).length} / {names.length} ·{' '}
        {index >= names.length ? '完成' : '待检查 / 检查中'}
      </p>
      {index >= 0 && index < names.length && (
        <iframe
          key={names[index]}
          title="被测组件"
          width="1000"
          height="620"
          src={`./design-preview.html?component=${encodeURIComponent(names[index])}`}
        />
      )}
      <pre id="audit-results">{JSON.stringify(results, null, 2)}</pre>
      <pre id="audit-observations">{JSON.stringify(observations, null, 2)}</pre>
    </div>
  );
}
if (params.has('audit')) createRoot(root).render(<Audit />);
else void renderPreview().catch((error) => report('error', String(error)));
