import {
  Component,
  Suspense,
  lazy,
  useState,
  type ComponentType,
  type PropsWithRef,
  type ReactNode,
} from 'react';
import { loadShellPanel } from './shell-chunk-retry.js';

class PanelLoadBoundary extends Component<
  { label: string; onRetry: () => void; children: ReactNode },
  { failed: boolean; moduleLoadFailed: boolean }
> {
  state = { failed: false, moduleLoadFailed: false };

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      failed: true,
      moduleLoadFailed:
        /dynamically imported module|importing a module script|failed to load module|ERR_FILE_NOT_FOUND/i.test(
          message,
        ),
    };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="shell-panel-load-state" role="alert">
        <span>{this.props.label}加载失败</span>
        <button type="button" onClick={this.props.onRetry}>
          重试加载
        </button>
        {this.state.moduleLoadFailed && (
          <>
            <span>页面资源加载失败；更新后请重新加载应用。</span>
            <button type="button" onClick={() => window.location.reload()}>
              重新加载应用
            </button>
          </>
        )}
      </div>
    );
  }
}

export function lazyPanel<Props extends object>(
  load: () => Promise<{ default: (props: Props) => ReactNode }>,
  label: string,
  entry?: string,
): ComponentType<Props> {
  return function DeferredPanel(props: Props) {
    const [state, setState] = useState(() => ({ Panel: lazy(load), attempt: 0 }));
    const { Panel, attempt } = state;
    return (
      <PanelLoadBoundary
        key={attempt}
        label={label}
        onRetry={() =>
          setState({
            Panel: lazy(() => loadShellPanel(load, entry, attempt + 1)),
            attempt: attempt + 1,
          })
        }
      >
        <Suspense
          fallback={
            <div className="shell-panel-load-state" role="status" aria-busy="true">
              正在加载{label}…
            </div>
          }
        >
          <Panel key="page" {...(props as PropsWithRef<Props>)} />
        </Suspense>
      </PanelLoadBoundary>
    );
  };
}
